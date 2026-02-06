// evostitch Service Worker - Tile caching for improved 3D performance
// W1: Service Worker Caching

const SW_VERSION = '1.3.0';
const TILE_CACHE_NAME = `evostitch-tiles-v${SW_VERSION}`;
const STATIC_CACHE_NAME = `evostitch-static-v${SW_VERSION}`;
const ZARR_CACHE_NAME = `evostitch-zarr-v${SW_VERSION}`;

// Cache size limits
const MAX_TILE_CACHE_ENTRIES = 5000;
const MAX_ZARR_CACHE_ENTRIES = 10000;
const CACHE_TRIM_BATCH_SIZE = 500; // Number of entries to evict when trimming

// R2 CDN domain for evostitch data
const R2_DOMAIN = 'pub-db7ffa4b7df04b76aaae379c13562977.r2.dev';

// Zarr metadata file names
const ZARR_META_FILES = ['.zarray', '.zattrs', '.zgroup'];

// Pattern to identify tile requests (DZI format: {name}_files/{level}/{x}_{y}.{ext})
// Tiles come from R2 CDN and have _files/ in their path
const TILE_URL_PATTERN = /_files\/\d+\/\d+_\d+\.(jpg|jpeg|png|webp)$/i;

// Pattern to identify DZI descriptor files
const DZI_URL_PATTERN = /\.dzi$/i;

// Determine if a URL is a tile request
function isTileRequest(url) {
    return TILE_URL_PATTERN.test(url);
}

// Determine if a URL is a DZI descriptor
function isDziRequest(url) {
    return DZI_URL_PATTERN.test(url);
}

// Determine if a URL is a zarr chunk request from R2
// Zarr chunks use paths like: /{dataset}/0/{level}/{t}/{c}/{z}/{y}/{x}
// or with dot separator: /{dataset}/0/{level}/{t}.{c}.{z}.{y}.{x}
function isZarrChunkRequest(url) {
    try {
        var parsed = new URL(url);
        if (parsed.hostname !== R2_DOMAIN) return false;
        // Zarr chunk paths: after the resolution level, segments are all numeric
        // e.g., /mosaic_3d_zarr/0/3/0/0/0/0/0 or /mosaic_3d_zarr/0/3/0.0.0.0.0
        var path = parsed.pathname;
        // Must have at least a dataset name and resolution level
        var segments = path.split('/').filter(function(s) { return s.length > 0; });
        // Minimum: dataset/0/level/chunk_indices (at least 4 segments)
        if (segments.length < 4) return false;
        // Skip if it's a metadata file
        for (var i = 0; i < ZARR_META_FILES.length; i++) {
            if (path.endsWith(ZARR_META_FILES[i])) return false;
        }
        // Skip if it's a DZI tile (_files/ pattern)
        if (TILE_URL_PATTERN.test(url)) return false;
        if (DZI_URL_PATTERN.test(url)) return false;
        // The last segment(s) should be numeric or dot-separated numerics
        var lastSeg = segments[segments.length - 1];
        // Check for dot-separated chunk indices (e.g., "0.0.0.0.0")
        if (/^\d+(\.\d+)+$/.test(lastSeg)) return true;
        // Check for slash-separated: last several segments are all numeric
        // Resolution level (segments[2] for dataset/0/level/...) and beyond should be numeric
        var numericStart = 2; // After dataset name and bioformats2raw "0"
        for (var j = numericStart; j < segments.length; j++) {
            if (!/^\d+$/.test(segments[j])) return false;
        }
        return segments.length > numericStart;
    } catch (e) {
        return false;
    }
}

// Determine if a URL is a zarr metadata request from R2
function isZarrMetadataRequest(url) {
    try {
        var parsed = new URL(url);
        if (parsed.hostname !== R2_DOMAIN) return false;
        for (var i = 0; i < ZARR_META_FILES.length; i++) {
            if (parsed.pathname.endsWith(ZARR_META_FILES[i])) return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Determine if a URL is a static asset (HTML, JS, CSS)
function isStaticAsset(url) {
    var pathname = new URL(url).pathname;
    return pathname.endsWith('.html') ||
           pathname.endsWith('.js') ||
           pathname.endsWith('.css') ||
           pathname === '/' ||
           pathname === '';
}

// Install event - cache nothing initially, just activate immediately
self.addEventListener('install', function(event) {
    console.log(`[evostitch SW] Installing v${SW_VERSION}`);
    // Skip waiting to activate immediately
    event.waitUntil(self.skipWaiting());
});

// Activate event - claim all clients and clean up old caches
self.addEventListener('activate', function(event) {
    console.log(`[evostitch SW] Activating v${SW_VERSION}`);
    event.waitUntil(
        Promise.all([
            // Claim all open clients immediately
            self.clients.claim(),
            // Delete old caches from previous versions
            caches.keys().then(function(cacheNames) {
                return Promise.all(
                    cacheNames
                        .filter(function(name) {
                            // Delete any evostitch cache that doesn't match current version
                            var isOurCache = name.startsWith('evostitch-tiles-') ||
                                           name.startsWith('evostitch-static-') ||
                                           name.startsWith('evostitch-zarr-');
                            var isCurrentVersion = name === TILE_CACHE_NAME ||
                                                  name === STATIC_CACHE_NAME ||
                                                  name === ZARR_CACHE_NAME;
                            return isOurCache && !isCurrentVersion;
                        })
                        .map(function(name) {
                            console.log(`[evostitch SW] Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
        ])
    );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // Only handle GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Strategy 1: Cache-first for tile images
    // Tiles are immutable content - once created, they never change
    if (isTileRequest(url)) {
        event.respondWith(cacheFirstStrategy(event.request, TILE_CACHE_NAME));
        return;
    }

    // Strategy 2: Cache-first for DZI descriptors (also immutable)
    if (isDziRequest(url)) {
        event.respondWith(cacheFirstStrategy(event.request, TILE_CACHE_NAME));
        return;
    }

    // Strategy 3: Cache-first for zarr chunks (immutable binary blobs)
    if (isZarrChunkRequest(url)) {
        event.respondWith(cacheFirstStrategy(event.request, ZARR_CACHE_NAME, MAX_ZARR_CACHE_ENTRIES));
        return;
    }

    // Strategy 4: Cache-first for zarr metadata (.zarray, .zattrs, .zgroup)
    if (isZarrMetadataRequest(url)) {
        event.respondWith(cacheFirstStrategy(event.request, ZARR_CACHE_NAME, MAX_ZARR_CACHE_ENTRIES));
        return;
    }

    // Strategy 5: Network-first for static assets (HTML, JS, CSS)
    // Always try to get fresh code, fall back to cache if offline
    if (isStaticAsset(url)) {
        event.respondWith(networkFirstStrategy(event.request, STATIC_CACHE_NAME));
        return;
    }

    // All other requests: pass through to network (don't cache)
});

// Cache-first strategy: check cache, fall back to network
// Used for immutable content like tiles and zarr chunks
// Implements LRU by moving accessed entries to end of cache
function cacheFirstStrategy(request, cacheName, maxEntries) {
    maxEntries = maxEntries || MAX_TILE_CACHE_ENTRIES;
    return caches.open(cacheName).then(function(cache) {
        return cache.match(request).then(function(cachedResponse) {
            if (cachedResponse) {
                // Cache hit - move to end of cache for LRU tracking
                // (delete and re-add moves entry to end)
                cache.delete(request).then(function() {
                    cache.put(request, cachedResponse.clone());
                }).catch(function(e) {
                    console.warn('[evostitch SW] LRU cache update failed:', e);
                });
                return cachedResponse;
            }

            // Cache miss - fetch from network and cache the response
            return fetch(request).then(function(networkResponse) {
                // Only cache successful responses
                if (networkResponse.ok) {
                    // Clone the response since we need to use it twice
                    // (once to cache, once to return)
                    cache.put(request, networkResponse.clone());
                    // Trigger async cache trimming (don't wait for it)
                    trimCacheIfNeeded(cacheName, maxEntries).catch(function(e) {
                        console.warn('[evostitch SW] Cache trim failed:', e);
                    });
                }
                return networkResponse;
            });
        });
    });
}

// Network-first strategy: try network, fall back to cache
// Used for static assets that may be updated
function networkFirstStrategy(request, cacheName) {
    return fetch(request).then(function(networkResponse) {
        // Got network response - cache it and return
        if (networkResponse.ok) {
            var responseToCache = networkResponse.clone();
            caches.open(cacheName).then(function(cache) {
                cache.put(request, responseToCache);
            });
        }
        return networkResponse;
    }).catch(function() {
        // Network failed - try cache
        return caches.open(cacheName).then(function(cache) {
            return cache.match(request).then(function(cachedResponse) {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // No cache fallback available
                return new Response('Network unavailable and no cached version', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            });
        });
    });
}

// Trim cache to enforce size limit using LRU eviction
// Cache keys are ordered by insertion time, so first entries are oldest
function trimCacheIfNeeded(cacheName, maxEntries) {
    return caches.open(cacheName).then(function(cache) {
        return cache.keys().then(function(keys) {
            if (keys.length <= maxEntries) {
                return; // Within limit, no trimming needed
            }

            // Calculate how many to remove (batch eviction for efficiency)
            var toRemove = Math.min(
                keys.length - maxEntries + CACHE_TRIM_BATCH_SIZE,
                keys.length - maxEntries
            );
            toRemove = Math.max(toRemove, keys.length - maxEntries);

            console.log(`[evostitch SW] Trimming cache: ${keys.length} entries, removing ${toRemove} oldest`);

            // Remove oldest entries (at the beginning of keys array)
            var deletePromises = keys.slice(0, toRemove).map(function(key) {
                return cache.delete(key);
            });

            return Promise.all(deletePromises).then(function() {
                console.log(`[evostitch SW] Cache trimmed to ${keys.length - toRemove} entries`);
            });
        });
    });
}

// Message handler for page communication
self.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || !data.type) return;

    switch (data.type) {
        case 'getZarrCacheStats':
            caches.open(ZARR_CACHE_NAME).then(function(cache) {
                return cache.keys();
            }).then(function(keys) {
                event.ports[0].postMessage({
                    type: 'zarrCacheStats',
                    entryCount: keys.length,
                    cacheName: ZARR_CACHE_NAME
                });
            }).catch(function(e) {
                event.ports[0].postMessage({
                    type: 'zarrCacheStats',
                    entryCount: 0,
                    error: e.message
                });
            });
            break;

        case 'clearZarrCache':
            caches.delete(ZARR_CACHE_NAME).then(function(deleted) {
                event.ports[0].postMessage({
                    type: 'zarrCacheCleared',
                    deleted: deleted
                });
            }).catch(function(e) {
                event.ports[0].postMessage({
                    type: 'zarrCacheCleared',
                    deleted: false,
                    error: e.message
                });
            });
            break;

        case 'getCacheContents':
            caches.open(ZARR_CACHE_NAME).then(function(cache) {
                return cache.keys();
            }).then(function(keys) {
                var urls = keys.map(function(req) { return req.url; });
                event.ports[0].postMessage({
                    type: 'cacheContents',
                    urls: urls
                });
            }).catch(function(e) {
                event.ports[0].postMessage({
                    type: 'cacheContents',
                    urls: [],
                    error: e.message
                });
            });
            break;
    }
});

