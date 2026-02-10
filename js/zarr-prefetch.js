// evostitch Zarr Prefetch Engine - Intelligent Z-plane prefetching for OME-Zarr viewer
// Prefetches adjacent Z-plane chunks so the Service Worker caches them before
// the user navigates. Viv/deck.gl then gets cache hits via the SW.
//
// The SW handles all caching/eviction. This module only needs to issue fetch()
// requests for predicted Z-planes — the SW intercepts and caches automatically.

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // Adjacent planes to prefetch when idle (both directions)
        adjacentRadius: 2,
        // Extra planes ahead when scrolling fast
        predictiveDepth: 4,
        // Velocity threshold (planes/sec) for predictive mode
        velocityThreshold: 1.5,
        // Velocity decay factor per measurement
        velocityDecay: 0.7,
        // Debounce delay before starting prefetch (ms)
        prefetchDelay: 100,
        // Max concurrent prefetch requests
        maxConcurrent: 4,
        // Enable debug logging
        debug: false
    };

    // State
    let state = {
        initialized: false,
        currentZ: 0,
        zCount: 1,
        zarrStoreUrl: '',   // Full zarr store URL (e.g., https://...r2.dev/dataset/0/)
        resolutionLevels: [],   // Array of { level, zChunkSize, yChunks, xChunks }
        axes: [],
        levelCount: 0,
        dimensionSeparator: '/',  // Zarr dimension separator ('/' for OME-Zarr, '.' for older)

        // Velocity tracking
        lastZChangeTime: 0,
        lastZ: 0,
        velocity: 0,            // planes/sec, positive = forward

        // Viewport callbacks (same pattern as zarr-3d-loader)
        getViewState: null,         // Function returning current deck.gl viewState
        getContainerSize: null,     // Function returning { width, height }

        // Track which Z-planes have been prefetched this session
        prefetchedPlanes: new Set(),

        // In-flight tracking
        pendingFetches: new Map(),  // url -> AbortController
        prefetchTimeout: null,

        // Stats
        stats: {
            hits: 0,
            misses: 0,
            prefetched: 0,
            aborted: 0,
            errors: 0,
            lateFetchCount: 0,
            prefetchedBytes: 0,
            zSwitchCount: 0
        }
    };

    /**
     * Initialize the prefetch engine
     * @param {Object} config - Configuration
     * @param {string} config.zarrStoreUrl - Full zarr store URL (what was passed to loadOmeZarr)
     * @param {string} config.baseUrl - Base R2 URL (fallback)
     * @param {number} config.zCount - Total number of Z-planes
     * @param {Array} config.axes - Axes names (e.g., ['t', 'c', 'z', 'y', 'x'])
     * @param {number} [config.levelCount] - Number of resolution levels (from loader.data.length)
     * @param {number} [config.currentZ=0] - Starting Z-plane
     * @param {Object} [config.options] - Override default CONFIG values
     */
    function init(config) {
        if (!config || !config.zCount) {
            console.error('[evostitch] ZarrPrefetch: init requires zCount');
            return false;
        }

        // Use the full zarr store URL if available, fall back to baseUrl
        state.zarrStoreUrl = (config.zarrStoreUrl || config.baseUrl || '').replace(/\/$/, '');
        state.zCount = config.zCount;
        state.currentZ = config.currentZ || 0;
        state.axes = config.axes || ['t', 'c', 'z', 'y', 'x'];
        state.levelCount = config.levelCount || 0;
        state.getViewState = config.getViewState || null;
        state.getContainerSize = config.getContainerSize || null;
        state.lastZ = state.currentZ;
        state.lastZChangeTime = 0;
        state.velocity = 0;
        state.prefetchedPlanes.clear();

        // Apply config overrides
        if (config.options) {
            Object.keys(config.options).forEach(function(key) {
                if (key in CONFIG) {
                    CONFIG[key] = config.options[key];
                }
            });
        }

        // Fetch resolution level info from .zarray metadata (async)
        extractResolutionInfo(state.levelCount);

        state.initialized = true;
        log('Initialized: zarrStoreUrl=' + state.zarrStoreUrl + ', zCount=' + state.zCount +
            ', levels pending, sep=' + state.dimensionSeparator);

        // Prefetch adjacent planes for initial position (will re-run after .zarray loads)
        schedulePrefetch();

        return true;
    }

    /**
     * Extract resolution level metadata by fetching .zarray for each level.
     * Replaces the old approach of accessing Viv's private _data API.
     * Fetches {zarrStoreUrl}/{level}/.zarray and parses shape, chunks,
     * and dimension_separator from the JSON response.
     * @param {number} levelCount - Number of resolution levels to fetch
     */
    function extractResolutionInfo(levelCount) {
        state.resolutionLevels = [];

        if (levelCount === 0 || !state.zarrStoreUrl) {
            log('No level count or store URL, skipping .zarray fetch');
            return;
        }

        var zIdx = state.axes.indexOf('z');
        var yIdx = state.axes.indexOf('y');
        var xIdx = state.axes.indexOf('x');

        // Pre-allocate to maintain level ordering despite async fetches
        var levels = new Array(levelCount);
        var fetches = [];
        for (var i = 0; i < levelCount; i++) {
            fetches.push(fetchZarrayForLevel(i, levels, zIdx, yIdx, xIdx));
        }

        Promise.all(fetches).then(function() {
            state.resolutionLevels = levels.filter(function(l) { return l != null; });
            log('Resolution levels extracted via .zarray: ' + state.resolutionLevels.length +
                ', sep=' + state.dimensionSeparator);
            // Re-schedule prefetch now that we have resolution data
            schedulePrefetch();
        }).catch(function(err) {
            log('Error fetching .zarray metadata: ' + err.message);
        });
    }

    /**
     * Fetch and parse .zarray metadata for a single resolution level.
     * @param {number} level - Resolution level index
     * @param {Array} levels - Pre-allocated array to store results by index
     * @param {number} zIdx - Index of z axis
     * @param {number} yIdx - Index of y axis
     * @param {number} xIdx - Index of x axis
     * @returns {Promise}
     */
    function fetchZarrayForLevel(level, levels, zIdx, yIdx, xIdx) {
        var url = state.zarrStoreUrl + '/' + level + '/.zarray';

        return fetch(url, { mode: 'cors', credentials: 'omit' })
            .then(function(response) {
                if (!response.ok) {
                    log('.zarray fetch failed for level ' + level + ': ' + response.status);
                    return null;
                }
                return response.json();
            })
            .then(function(zarray) {
                if (!zarray) return;

                var shape = zarray.shape;
                var chunks = zarray.chunks;

                // Extract dimension separator from the first level
                if (level === 0 && zarray.dimension_separator) {
                    state.dimensionSeparator = zarray.dimension_separator;
                }

                if (!shape || !chunks) return;

                var ySize = yIdx >= 0 ? shape[yIdx] : 0;
                var xSize = xIdx >= 0 ? shape[xIdx] : 0;
                var yChunkSize = yIdx >= 0 ? chunks[yIdx] : 256;
                var xChunkSize = xIdx >= 0 ? chunks[xIdx] : 256;
                var zChunkSize = zIdx >= 0 ? chunks[zIdx] : 1;

                levels[level] = {
                    level: level,
                    shape: shape,
                    chunks: chunks,
                    zChunkSize: zChunkSize,
                    yChunks: ySize > 0 ? Math.ceil(ySize / yChunkSize) : 0,
                    xChunks: xSize > 0 ? Math.ceil(xSize / xChunkSize) : 0,
                    yChunkSize: yChunkSize,
                    xChunkSize: xChunkSize
                };
            })
            .catch(function(err) {
                log('.zarray fetch error for level ' + level + ': ' + err.message);
            });
    }

    /**
     * Generate chunk URLs for a given Z-plane at a specific resolution level.
     * Must match Viv's URL construction exactly:
     *   HTTPStore.getItem(keyPrefix + chunkCoords.join(sep))
     *   resolveUrl(storeUrl, key)
     *
     * For OME-Zarr with '/' separator:
     *   {zarrStoreUrl}/{level}/{t}/{c}/{z}/{y}/{x}
     *
     * @param {number} z - Z-plane index
     * @param {number} levelIdx - Resolution level index
     * @param {Object} [tileRange] - Optional viewport tile range to constrain x/y loops
     * @param {number} tileRange.minTileX
     * @param {number} tileRange.maxTileX
     * @param {number} tileRange.minTileY
     * @param {number} tileRange.maxTileY
     * @returns {string[]} Array of chunk URLs
     */
    function getChunkUrlsForZ(z, levelIdx, tileRange) {
        var urls = [];
        var info = state.resolutionLevels[levelIdx];
        if (!info) return urls;

        var zIdx = state.axes.indexOf('z');
        if (zIdx < 0) return urls;

        var sep = state.dimensionSeparator;
        var zChunk = Math.floor(z / info.zChunkSize);

        var cIdx = state.axes.indexOf('c');
        var cCount = cIdx >= 0 && info.shape ? info.shape[cIdx] : 1;

        // Use viewport tile range if provided, otherwise fetch all chunks
        var yMin = tileRange ? tileRange.minTileY : 0;
        var yMax = tileRange ? tileRange.maxTileY : info.yChunks - 1;
        var xMin = tileRange ? tileRange.minTileX : 0;
        var xMax = tileRange ? tileRange.maxTileX : info.xChunks - 1;

        for (var c = 0; c < cCount; c++) {
            for (var y = yMin; y <= yMax; y++) {
                for (var x = xMin; x <= xMax; x++) {
                    // Build chunk coordinate array following axes order
                    var coords = [];
                    for (var a = 0; a < state.axes.length; a++) {
                        var axis = state.axes[a];
                        if (axis === 't') coords.push(0);
                        else if (axis === 'c') coords.push(c);
                        else if (axis === 'z') coords.push(zChunk);
                        else if (axis === 'y') coords.push(y);
                        else if (axis === 'x') coords.push(x);
                    }

                    // Viv builds: keyPrefix + coords.join(sep)
                    // keyPrefix = level + '/' (from pathToPrefix)
                    // Then resolveUrl(storeUrl, key) makes the full URL
                    var chunkKey = levelIdx + '/' + coords.join(sep);
                    var url = state.zarrStoreUrl + '/' + chunkKey;
                    urls.push(url);
                }
            }
        }

        return urls;
    }

    /**
     * Compute visible tile range for a resolution level using viewport math.
     * Returns null if viewport info is unavailable (graceful fallback to all chunks).
     * @param {number} levelIdx - Resolution level index
     * @returns {Object|null} { minTileX, maxTileX, minTileY, maxTileY } or null
     */
    function getViewportTileRange(levelIdx) {
        var vpm = window.evostitch && window.evostitch.viewportMath;
        if (!vpm || !state.getViewState || !state.getContainerSize) return null;

        var viewState = state.getViewState();
        var containerSize = state.getContainerSize();
        if (!viewState || !containerSize) return null;

        var info = state.resolutionLevels[levelIdx];
        if (!info) return null;

        var bounds = vpm.viewStateToBounds(viewState, containerSize);
        return vpm.boundsToTileRange(bounds, info, 2);  // 2-tile margin
    }

    /**
     * Called when Z-plane changes - triggers velocity tracking and prefetch
     * @param {number} newZ - New Z-plane index
     */
    function onZChange(newZ) {
        if (!state.initialized) return;
        if (newZ === state.currentZ) return;

        var now = performance.now();
        var dt = now - state.lastZChangeTime;

        // Update velocity with exponential smoothing
        if (dt < 1000 && state.lastZChangeTime > 0) {
            var instantVelocity = (newZ - state.lastZ) / dt * 1000;
            state.velocity = state.velocity * CONFIG.velocityDecay +
                instantVelocity * (1 - CONFIG.velocityDecay);
        } else {
            state.velocity = 0;
        }

        state.lastZChangeTime = now;
        state.lastZ = state.currentZ;
        state.currentZ = newZ;
        state.stats.zSwitchCount++;

        log('Z changed to ' + newZ + ', velocity=' + state.velocity.toFixed(1) + ' planes/sec');

        // Abort stale prefetches that are no longer relevant
        abortStalePrefetches();

        // Schedule new prefetch
        schedulePrefetch();
    }

    /**
     * Schedule prefetch with debounce
     */
    function schedulePrefetch() {
        if (state.prefetchTimeout) {
            clearTimeout(state.prefetchTimeout);
        }

        state.prefetchTimeout = setTimeout(function() {
            state.prefetchTimeout = null;
            executePrefetch();
        }, CONFIG.prefetchDelay);
    }

    /**
     * Determine which Z-planes to prefetch based on velocity and position
     * @returns {number[]} Ordered list of Z-planes to prefetch (highest priority first)
     */
    function predictPlanesToPrefetch() {
        var planes = [];
        var speed = Math.abs(state.velocity);
        var direction = Math.sign(state.velocity);

        if (speed >= CONFIG.velocityThreshold) {
            // Fast navigation: prefetch further ahead in direction of travel
            var depth = Math.min(CONFIG.predictiveDepth,
                Math.ceil(speed / CONFIG.velocityThreshold));

            // Ahead in direction of travel (highest priority)
            for (var i = 1; i <= depth; i++) {
                var ahead = state.currentZ + direction * i;
                if (ahead >= 0 && ahead < state.zCount) {
                    planes.push(ahead);
                }
            }

            // One plane behind (for direction reversal)
            var behind = state.currentZ - direction;
            if (behind >= 0 && behind < state.zCount) {
                planes.push(behind);
            }
        } else {
            // Idle or slow navigation: prefetch symmetrically
            for (var r = 1; r <= CONFIG.adjacentRadius; r++) {
                if (state.currentZ + r < state.zCount) {
                    planes.push(state.currentZ + r);
                }
                if (state.currentZ - r >= 0) {
                    planes.push(state.currentZ - r);
                }
            }
        }

        return planes;
    }

    /**
     * Execute prefetch for predicted Z-planes.
     * Filters to viewport-visible chunks + 2-tile margin when viewport info is available.
     * Just issues fetch() calls — the Service Worker intercepts and caches them.
     */
    function executePrefetch() {
        if (!state.initialized) return;

        var planes = predictPlanesToPrefetch();
        if (planes.length === 0) return;

        log('Prefetching planes: [' + planes.join(', ') + ']');

        // Determine which resolution level(s) to prefetch
        var levelsToFetch = choosePrefetchLevels();

        // Compute viewport tile ranges per level (null = no filtering, fetch all)
        var tileRanges = {};
        for (var l = 0; l < levelsToFetch.length; l++) {
            tileRanges[levelsToFetch[l]] = getViewportTileRange(levelsToFetch[l]);
        }

        for (var p = 0; p < planes.length; p++) {
            var z = planes[p];

            // Skip if already prefetched this session
            if (state.prefetchedPlanes.has(z)) {
                state.stats.hits++;
                continue;
            }
            state.stats.misses++;

            for (var l = 0; l < levelsToFetch.length; l++) {
                prefetchPlane(z, levelsToFetch[l], tileRanges[levelsToFetch[l]]);
            }
        }
    }

    /**
     * Choose which resolution levels to prefetch
     * Coarser levels are smaller and load faster, maximizing perceived performance
     * @returns {number[]} Resolution level indices to prefetch
     */
    function choosePrefetchLevels() {
        if (state.resolutionLevels.length === 0) return [];

        var levels = [];
        var count = state.resolutionLevels.length;

        // Coarsest level (smallest, fastest)
        levels.push(count - 1);

        // If there's a mid-level, include it
        if (count > 2) {
            levels.push(Math.floor(count / 2));
        }

        // Finest level (largest, full detail) - only if few chunks
        if (count > 1) {
            var finest = state.resolutionLevels[0];
            var totalChunks = finest.yChunks * finest.xChunks;
            if (totalChunks <= 64) {
                levels.push(0);
            }
        }

        return levels;
    }

    /**
     * Prefetch chunks for a Z-plane at a given resolution level.
     * When tileRange is provided, only fetches viewport-visible chunks.
     * Just issues fetch() requests — the SW intercepts and caches them.
     * @param {number} z - Z-plane index
     * @param {number} levelIdx - Resolution level index
     * @param {Object} [tileRange] - Optional viewport tile range from getViewportTileRange
     */
    function prefetchPlane(z, levelIdx, tileRange) {
        var urls = getChunkUrlsForZ(z, levelIdx, tileRange);
        if (urls.length === 0) return;

        // Limit concurrent requests
        var activeFetches = state.pendingFetches.size;
        var slotsAvailable = CONFIG.maxConcurrent - activeFetches;
        if (slotsAvailable <= 0) return;

        var toFetch = urls.slice(0, slotsAvailable);

        log('Prefetching Z=' + z + ' level=' + levelIdx +
            ' (' + toFetch.length + '/' + urls.length + ' chunks)');

        toFetch.forEach(function(url) {
            if (state.pendingFetches.has(url)) return;

            var controller = new AbortController();
            state.pendingFetches.set(url, controller);

            // Just fetch — the SW will intercept and cache the response
            fetch(url, {
                signal: controller.signal,
                mode: 'cors',
                credentials: 'omit'
            }).then(function(response) {
                state.pendingFetches.delete(url);

                if (!response.ok) {
                    state.stats.errors++;
                    return;
                }

                state.stats.prefetched++;
                state.prefetchedPlanes.add(z);

                // Track prefetched bytes from Content-Length header
                var contentLength = response.headers.get('Content-Length');
                if (contentLength) {
                    state.stats.prefetchedBytes += parseInt(contentLength, 10) || 0;
                }

                log('Prefetched: ' + url);
            }).catch(function(err) {
                state.pendingFetches.delete(url);

                if (err.name === 'AbortError') {
                    state.stats.aborted++;
                    return;
                }
                state.stats.errors++;
                log('Prefetch error for ' + url + ': ' + err.message);
            });
        });
    }

    /**
     * Abort prefetch requests that are no longer relevant
     * Keeps fetches for current Z and predicted planes; aborts others
     */
    function abortStalePrefetches() {
        var relevantPlanes = new Set([state.currentZ]);
        var predicted = predictPlanesToPrefetch();
        predicted.forEach(function(z) { relevantPlanes.add(z); });

        state.pendingFetches.forEach(function(controller, url) {
            // Check if URL belongs to a relevant Z-plane
            var isRelevant = false;
            relevantPlanes.forEach(function(z) {
                for (var l = 0; l < state.resolutionLevels.length; l++) {
                    var urls = getChunkUrlsForZ(z, l);
                    if (urls.indexOf(url) >= 0) {
                        isRelevant = true;
                    }
                }
            });

            if (!isRelevant) {
                controller.abort();
                state.pendingFetches.delete(url);
                state.stats.aborted++;
                log('Aborted stale prefetch: ' + url);
            }
        });
    }

    /**
     * Check if a Z-plane is prefetched, loading, or not started
     * @param {number} z - Z-plane index
     * @returns {string} 'cached' | 'loading' | 'none'
     */
    function getPrefetchState(z) {
        if (state.prefetchedPlanes.has(z)) return 'cached';

        for (var l = 0; l < state.resolutionLevels.length; l++) {
            var urls = getChunkUrlsForZ(z, l);
            for (var i = 0; i < urls.length; i++) {
                if (state.pendingFetches.has(urls[i])) return 'loading';
            }
        }

        return 'none';
    }

    /**
     * Explicitly request a plane be prefetched
     * @param {number} z - Z-plane index to warm
     */
    function warmPlane(z) {
        if (!state.initialized) return;
        if (z < 0 || z >= state.zCount) return;
        if (state.prefetchedPlanes.has(z)) return;

        var levels = choosePrefetchLevels();
        for (var l = 0; l < levels.length; l++) {
            prefetchPlane(z, levels[l]);
        }
        log('Warming plane Z=' + z);
    }

    /**
     * Called when onViewportLoad fires (tiles for current viewport finished loading).
     * Increments lateFetchCount if there are still pending prefetch requests,
     * meaning the viewer loaded tiles before prefetch completed.
     */
    function onViewportLoad() {
        if (!state.initialized) return;
        if (state.pendingFetches.size > 0) {
            state.stats.lateFetchCount++;
            log('Late fetch detected: ' + state.pendingFetches.size + ' prefetches still pending at viewport load');
        }
    }

    /**
     * Get prefetch statistics
     * @returns {Object} Stats including hits, misses, cache size, velocity
     */
    function getStats() {
        var zSwitches = state.stats.zSwitchCount;
        return {
            hits: state.stats.hits,
            misses: state.stats.misses,
            prefetched: state.stats.prefetched,
            aborted: state.stats.aborted,
            errors: state.stats.errors,
            lateFetchCount: state.stats.lateFetchCount,
            totalZSwitches: zSwitches,
            prefetchedBytes: state.stats.prefetchedBytes,
            prefetchedBytesPerZSwitch: zSwitches > 0 ? Math.round(state.stats.prefetchedBytes / zSwitches) : 0,
            prefetchedPlanes: Array.from(state.prefetchedPlanes),
            pendingFetches: state.pendingFetches.size,
            velocity: Math.round(state.velocity * 10) / 10,
            currentZ: state.currentZ,
            zCount: state.zCount,
            resolutionLevels: state.resolutionLevels.length,
            zarrStoreUrl: state.zarrStoreUrl,
            dimensionSeparator: state.dimensionSeparator
        };
    }

    /**
     * Toggle debug logging
     * @param {boolean} enabled - Whether to enable debug logging
     */
    function setDebug(enabled) {
        CONFIG.debug = !!enabled;
    }

    /**
     * Clean up all prefetch state and abort pending requests
     */
    function destroy() {
        if (!state.initialized) return;

        // Clear scheduled prefetch
        if (state.prefetchTimeout) {
            clearTimeout(state.prefetchTimeout);
            state.prefetchTimeout = null;
        }

        // Abort all pending fetches
        state.pendingFetches.forEach(function(controller) {
            controller.abort();
        });
        state.pendingFetches.clear();

        // Reset state
        state.prefetchedPlanes.clear();
        state.initialized = false;
        state.velocity = 0;
        state.getViewState = null;
        state.getContainerSize = null;
        state.stats = { hits: 0, misses: 0, prefetched: 0, aborted: 0, errors: 0, lateFetchCount: 0, prefetchedBytes: 0, zSwitchCount: 0 };

        log('Destroyed');
    }

    /**
     * Debug logging
     * @param {string} message - Log message
     */
    function log(message) {
        if (CONFIG.debug) {
            console.log('[evostitch] ZarrPrefetch: ' + message);
        }
    }

    /**
     * Get resolution level metadata (needed by zarr-3d-loader)
     * @returns {Array} Array of { level, shape, chunks, zChunkSize, yChunks, xChunks, yChunkSize, xChunkSize }
     */
    function getResolutionLevels() {
        return state.resolutionLevels.slice();
    }

    /**
     * Get axes order (needed by zarr-3d-loader)
     * @returns {Array} e.g., ['t', 'c', 'z', 'y', 'x']
     */
    function getAxes() {
        return state.axes.slice();
    }

    /**
     * Get zarr store URL (needed by zarr-3d-loader)
     * @returns {string}
     */
    function getStoreUrl() {
        return state.zarrStoreUrl;
    }

    /**
     * Get dimension separator (needed by zarr-3d-loader)
     * @returns {string} '/' or '.'
     */
    function getDimensionSeparator() {
        return state.dimensionSeparator;
    }

    // Expose public API
    window.evostitch = window.evostitch || {};
    window.evostitch.zarrPrefetch = {
        init: init,
        onZChange: onZChange,
        onViewportLoad: onViewportLoad,
        getPrefetchState: getPrefetchState,
        warmPlane: warmPlane,
        getStats: getStats,
        setDebug: setDebug,
        destroy: destroy,
        getChunkUrlsForZ: getChunkUrlsForZ,
        getResolutionLevels: getResolutionLevels,
        getAxes: getAxes,
        getStoreUrl: getStoreUrl,
        getDimensionSeparator: getDimensionSeparator,
        // Expose for testing
        CONFIG: CONFIG
    };

})();
