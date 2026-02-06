// evostitch Zarr Cache - Caching and network optimization for zarr chunk fetching
// Provides priority-aware fetching, LRU cache eviction, request deduplication,
// and concurrency control for OME-Zarr data loading.
(function() {
    'use strict';

    // ========== Constants ==========

    var CACHE_NAME = 'zarr-chunks-v1';

    var PRIORITY = {
        CRITICAL: 1,   // Current viewport chunks
        HIGH: 2,       // Adjacent Z-plane chunks
        NORMAL: 3,     // Prefetch chunks
        LOW: 4         // Background warming
    };

    // ========== Configuration ==========

    var CONFIG = {
        maxCacheBytes: 500 * 1024 * 1024,  // 500 MB default
        maxConcurrent: 8,                    // Concurrent fetch limit
        debug: false,
        baseUrl: ''                          // R2 CDN base URL
    };

    // ========== State ==========

    var initialized = false;
    var cacheHandle = null;           // Cache API handle
    var accessOrder = [];             // LRU tracking: array of {url, size} ordered by last access
    var totalCacheBytes = 0;          // Estimated total cached bytes
    var inflightRequests = new Map(); // url -> {promise, abortController, priority}
    var fetchQueue = [];              // Pending fetches: {url, priority, resolve, reject, abortController}
    var activeCount = 0;              // Currently active fetch count

    // Telemetry
    var stats = {
        hits: 0,
        misses: 0,
        bytesTransferred: 0,
        fetchDurations: [],           // Last N fetch durations in ms
        maxDurationSamples: 200
    };

    // ========== Logging ==========

    function log(message) {
        if (CONFIG.debug) {
            console.log('[evostitch] zarrCache: ' + message);
        }
    }

    // ========== Public API ==========

    /**
     * Initialize the zarr cache module.
     * @param {Object} config - Configuration options
     * @param {string} config.baseUrl - R2 CDN base URL
     * @param {number} [config.maxCacheBytes] - Maximum cache size in bytes (default 500MB)
     * @param {number} [config.maxConcurrent] - Max concurrent fetches (default 8)
     * @param {boolean} [config.debug] - Enable debug logging
     */
    function init(config) {
        if (initialized) {
            log('Already initialized, skipping');
            return Promise.resolve();
        }

        if (config) {
            if (config.baseUrl !== undefined) CONFIG.baseUrl = config.baseUrl;
            if (config.maxCacheBytes !== undefined) CONFIG.maxCacheBytes = config.maxCacheBytes;
            if (config.maxConcurrent !== undefined) CONFIG.maxConcurrent = config.maxConcurrent;
            if (config.debug !== undefined) CONFIG.debug = config.debug;
        }

        log('Initializing with maxCacheBytes=' + CONFIG.maxCacheBytes + ', maxConcurrent=' + CONFIG.maxConcurrent);

        // Open Cache API storage
        return openCache().then(function() {
            initialized = true;
            log('Initialized successfully');
        }).catch(function(err) {
            console.warn('[evostitch] zarrCache: Cache API unavailable, falling back to fetch-only mode:', err);
            initialized = true;
        });
    }

    /**
     * Fetch a URL with caching and priority.
     * Returns cached response if available, otherwise fetches from network.
     * Deduplicates concurrent requests for the same URL.
     * @param {string} url - URL to fetch
     * @param {number} [priority] - Priority level (PRIORITY.CRITICAL to PRIORITY.LOW)
     * @returns {Promise<Response>} The response
     */
    function fetchWithCache(url, priority) {
        if (!initialized) {
            return fetch(url);
        }

        priority = priority || PRIORITY.NORMAL;

        // Check for in-flight request (deduplication)
        var inflight = inflightRequests.get(url);
        if (inflight) {
            log('Dedup hit for ' + url);
            // Upgrade priority if new request is higher
            if (priority < inflight.priority) {
                inflight.priority = priority;
            }
            return inflight.promise;
        }

        // Check cache first
        return checkCache(url).then(function(cachedResponse) {
            if (cachedResponse) {
                stats.hits++;
                touchAccessOrder(url);
                log('Cache hit: ' + url);
                return cachedResponse;
            }

            stats.misses++;
            log('Cache miss: ' + url + ' (priority=' + priority + ')');

            // Enqueue the fetch
            return enqueueFetch(url, priority);
        });
    }

    /**
     * Prefetch a list of URLs at a given priority.
     * Returns an object with a cancel() method.
     * @param {string[]} urls - URLs to prefetch
     * @param {number} [priority] - Priority level (default NORMAL)
     * @returns {{ cancel: Function, promise: Promise }}
     */
    function prefetchUrls(urls, priority) {
        priority = priority || PRIORITY.NORMAL;
        var abortController = new AbortController();
        var cancelled = false;

        var promises = urls.map(function(url) {
            if (cancelled) return Promise.resolve();
            return fetchWithCache(url, priority).catch(function(err) {
                // Swallow errors for prefetch - they're best-effort
                if (err.name !== 'AbortError') {
                    log('Prefetch failed for ' + url + ': ' + err.message);
                }
            });
        });

        return {
            cancel: function() {
                cancelled = true;
                cancelPrefetch(urls);
            },
            promise: Promise.all(promises)
        };
    }

    /**
     * Cancel pending prefetch requests for the given URLs.
     * Only cancels requests that are still queued (not actively fetching at CRITICAL priority).
     * @param {string[]} urls - URLs to cancel
     */
    function cancelPrefetch(urls) {
        if (!urls || urls.length === 0) return;

        var urlSet = new Set(urls);
        var cancelledCount = 0;

        // Remove from fetch queue
        fetchQueue = fetchQueue.filter(function(item) {
            if (urlSet.has(item.url)) {
                item.abortController.abort();
                item.reject(new DOMException('Prefetch cancelled', 'AbortError'));
                cancelledCount++;
                return false;
            }
            return true;
        });

        // Abort in-flight requests that are lower priority
        urlSet.forEach(function(url) {
            var inflight = inflightRequests.get(url);
            if (inflight && inflight.priority > PRIORITY.HIGH) {
                inflight.abortController.abort();
                inflightRequests.delete(url);
                cancelledCount++;
            }
        });

        if (cancelledCount > 0) {
            log('Cancelled ' + cancelledCount + ' prefetch requests');
        }
    }

    /**
     * Get cache and fetch statistics.
     * @returns {Object} Statistics object
     */
    function getStats() {
        var total = stats.hits + stats.misses;
        var durations = stats.fetchDurations;
        var avgDuration = 0;
        if (durations.length > 0) {
            var sum = 0;
            for (var i = 0; i < durations.length; i++) sum += durations[i];
            avgDuration = Math.round(sum / durations.length);
        }

        return {
            hits: stats.hits,
            misses: stats.misses,
            hitRate: total > 0 ? (stats.hits / total * 100).toFixed(1) + '%' : '0%',
            cacheSize: formatBytes(totalCacheBytes),
            cacheSizeBytes: totalCacheBytes,
            pendingRequests: fetchQueue.length,
            activeRequests: activeCount,
            inflightCount: inflightRequests.size,
            bytesTransferred: formatBytes(stats.bytesTransferred),
            avgFetchMs: avgDuration,
            accessOrderLength: accessOrder.length
        };
    }

    /**
     * Clear all cached zarr chunks.
     * @returns {Promise}
     */
    function clearCache() {
        log('Clearing cache');
        accessOrder = [];
        totalCacheBytes = 0;
        stats.hits = 0;
        stats.misses = 0;
        stats.bytesTransferred = 0;
        stats.fetchDurations = [];

        return caches.delete(CACHE_NAME).then(function() {
            return openCache();
        }).then(function() {
            log('Cache cleared');
        });
    }

    /**
     * Set debug mode.
     * @param {boolean} enabled
     */
    function setDebug(enabled) {
        CONFIG.debug = !!enabled;
        log('Debug ' + (enabled ? 'enabled' : 'disabled'));
    }

    /**
     * Destroy the cache module, cancelling all pending requests.
     */
    function destroy() {
        log('Destroying');

        // Cancel all queued fetches
        fetchQueue.forEach(function(item) {
            item.abortController.abort();
            item.reject(new DOMException('Cache destroyed', 'AbortError'));
        });
        fetchQueue = [];

        // Abort all in-flight requests
        inflightRequests.forEach(function(inflight) {
            inflight.abortController.abort();
        });
        inflightRequests.clear();

        accessOrder = [];
        totalCacheBytes = 0;
        activeCount = 0;
        cacheHandle = null;
        initialized = false;

        log('Destroyed');
    }

    // ========== Internal: Cache API ==========

    /**
     * Open or re-open the Cache API handle.
     * @returns {Promise}
     */
    function openCache() {
        if (typeof caches === 'undefined') {
            return Promise.resolve();
        }
        return caches.open(CACHE_NAME).then(function(cache) {
            cacheHandle = cache;
            return rebuildAccessOrder();
        });
    }

    /**
     * Check the cache for a URL.
     * @param {string} url
     * @returns {Promise<Response|null>}
     */
    function checkCache(url) {
        if (!cacheHandle) {
            return Promise.resolve(null);
        }
        return cacheHandle.match(url).catch(function() {
            return null;
        });
    }

    /**
     * Store a response in the cache and track it for LRU.
     * @param {string} url
     * @param {Response} response - The response to cache (will be cloned)
     * @param {number} size - Response size in bytes
     * @returns {Promise}
     */
    function storeInCache(url, response, size) {
        if (!cacheHandle) {
            return Promise.resolve();
        }

        return cacheHandle.put(url, response.clone()).then(function() {
            addToAccessOrder(url, size);
            evictIfNeeded();
            log('Stored in cache: ' + url + ' (' + formatBytes(size) + ')');
        }).catch(function(err) {
            log('Failed to store in cache: ' + err.message);
        });
    }

    // ========== Internal: LRU Tracking ==========

    /**
     * Rebuild access order from the cache contents.
     * Called once at init to restore LRU state.
     * @returns {Promise}
     */
    function rebuildAccessOrder() {
        if (!cacheHandle) {
            return Promise.resolve();
        }

        return cacheHandle.keys().then(function(requests) {
            accessOrder = [];
            totalCacheBytes = 0;

            // We can't easily get sizes from Cache API keys alone,
            // so we estimate based on typical chunk sizes
            requests.forEach(function(request) {
                var estimatedSize = 50 * 1024; // 50KB default estimate
                accessOrder.push({ url: request.url, size: estimatedSize });
                totalCacheBytes += estimatedSize;
            });

            log('Rebuilt access order: ' + accessOrder.length + ' entries, ~' + formatBytes(totalCacheBytes));
        }).catch(function(err) {
            log('Failed to rebuild access order: ' + err.message);
        });
    }

    /**
     * Touch (move to end) an entry in the access order.
     * @param {string} url
     */
    function touchAccessOrder(url) {
        for (var i = 0; i < accessOrder.length; i++) {
            if (accessOrder[i].url === url) {
                var entry = accessOrder.splice(i, 1)[0];
                accessOrder.push(entry);
                return;
            }
        }
    }

    /**
     * Add a new entry to the access order.
     * @param {string} url
     * @param {number} size
     */
    function addToAccessOrder(url, size) {
        // Remove existing entry if present (update)
        for (var i = 0; i < accessOrder.length; i++) {
            if (accessOrder[i].url === url) {
                totalCacheBytes -= accessOrder[i].size;
                accessOrder.splice(i, 1);
                break;
            }
        }
        accessOrder.push({ url: url, size: size });
        totalCacheBytes += size;
    }

    /**
     * Evict oldest entries until cache is within size limit.
     */
    function evictIfNeeded() {
        if (totalCacheBytes <= CONFIG.maxCacheBytes || !cacheHandle) {
            return;
        }

        var evictedCount = 0;
        while (totalCacheBytes > CONFIG.maxCacheBytes && accessOrder.length > 0) {
            var oldest = accessOrder.shift();
            totalCacheBytes -= oldest.size;
            cacheHandle.delete(oldest.url).catch(function() {
                // Ignore delete errors
            });
            evictedCount++;
        }

        if (evictedCount > 0) {
            log('Evicted ' + evictedCount + ' entries, cache now ~' + formatBytes(totalCacheBytes));
        }
    }

    // ========== Internal: Fetch Queue ==========

    /**
     * Enqueue a fetch with priority.
     * @param {string} url
     * @param {number} priority
     * @returns {Promise<Response>}
     */
    function enqueueFetch(url, priority) {
        var abortController = new AbortController();

        var promise = new Promise(function(resolve, reject) {
            var item = {
                url: url,
                priority: priority,
                resolve: resolve,
                reject: reject,
                abortController: abortController
            };

            // Insert into queue sorted by priority (lower number = higher priority)
            var inserted = false;
            for (var i = 0; i < fetchQueue.length; i++) {
                if (priority < fetchQueue[i].priority) {
                    fetchQueue.splice(i, 0, item);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                fetchQueue.push(item);
            }

            // Track as in-flight for deduplication
            inflightRequests.set(url, {
                promise: promise,
                abortController: abortController,
                priority: priority
            });

            // Try to process the queue
            processQueue();
        });

        // When promise settles, clean up inflight tracking
        promise.then(function() {
            inflightRequests.delete(url);
        }).catch(function() {
            inflightRequests.delete(url);
        });

        return promise;
    }

    /**
     * Process the fetch queue, starting fetches up to the concurrency limit.
     * Higher-priority items (lower number) are fetched first.
     */
    function processQueue() {
        while (activeCount < CONFIG.maxConcurrent && fetchQueue.length > 0) {
            var item = fetchQueue.shift();

            // Check if this request was already cancelled
            if (item.abortController.signal.aborted) {
                continue;
            }

            executeFetch(item);
        }
    }

    /**
     * Execute a single fetch request.
     * @param {Object} item - Queue item
     */
    function executeFetch(item) {
        activeCount++;
        var startTime = performance.now();

        fetch(item.url, { signal: item.abortController.signal }).then(function(response) {
            activeCount--;
            var duration = performance.now() - startTime;
            recordFetchDuration(duration);

            if (!response.ok) {
                item.reject(new Error('HTTP ' + response.status + ' for ' + item.url));
                processQueue();
                return;
            }

            // Get content length for LRU tracking
            var contentLength = parseInt(response.headers.get('content-length') || '0', 10);
            var size = contentLength || 50 * 1024; // Default 50KB estimate
            stats.bytesTransferred += size;

            // Cache the response
            storeInCache(item.url, response, size);

            item.resolve(response);
            processQueue();
        }).catch(function(err) {
            activeCount--;

            if (err.name === 'AbortError') {
                item.reject(err);
            } else {
                log('Fetch failed for ' + item.url + ': ' + err.message);
                item.reject(err);
            }

            processQueue();
        });
    }

    /**
     * Record a fetch duration for telemetry.
     * @param {number} ms
     */
    function recordFetchDuration(ms) {
        stats.fetchDurations.push(ms);
        if (stats.fetchDurations.length > stats.maxDurationSamples) {
            stats.fetchDurations.shift();
        }
    }

    // ========== Internal: Utilities ==========

    /**
     * Format bytes as human-readable string.
     * @param {number} bytes
     * @returns {string}
     */
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        i = Math.min(i, units.length - 1);
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
    }

    // ========== Public API Registration ==========

    window.evostitch = window.evostitch || {};
    window.evostitch.zarrCache = {
        init: init,
        fetchWithCache: fetchWithCache,
        prefetchUrls: prefetchUrls,
        cancelPrefetch: cancelPrefetch,
        getStats: getStats,
        clearCache: clearCache,
        setDebug: setDebug,
        destroy: destroy,
        // Expose constants for consumers
        PRIORITY: PRIORITY
    };

})();
