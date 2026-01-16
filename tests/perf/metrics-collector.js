// Browser-side metrics collector - injected via page.evaluate()
// Hooks into OpenSeadragon events to capture tile timing

function createMetricsCollector() {
    // Threshold for cache hit detection (ms) - tiles loading faster are cache hits
    const CACHE_HIT_THRESHOLD_MS = 50;

    const metrics = {
        startTime: performance.now(),
        firstTileTime: null,
        viewportCompleteTime: null,
        tileLoads: [],
        tilesInViewport: new Set(),
        tilesLoaded: new Set(),
        viewportComplete: false,
        // Scenario-specific metrics (Step 0.2)
        zTransitions: [],           // Z-plane transition measurements
        operations: [],             // Pan/zoom/Z operation timings
        currentOperation: null      // Active operation being timed
    };

    // Reference to the TiledImage for checking fully-loaded state
    let tiledImage = null;

    // Hook into OpenSeadragon viewer
    function attachToViewer(viewer) {
        viewer.addHandler('tile-loaded', function(event) {
            const now = performance.now();
            const elapsed = now - metrics.startTime;

            // Record first tile
            if (metrics.firstTileTime === null) {
                metrics.firstTileTime = elapsed;
            }

            // Get tile URL for tracking
            const tileUrl = event.tile.getUrl ? event.tile.getUrl() : event.tile.url;
            const tileKey = `${event.tile.level}-${event.tile.x}-${event.tile.y}`;

            // Get latency from PerformanceResourceTiming
            let latencyMs = 0;
            if (tileUrl && performance.getEntriesByName) {
                const entries = performance.getEntriesByName(tileUrl, 'resource');
                if (entries.length > 0) {
                    latencyMs = Math.round(entries[entries.length - 1].duration);
                }
            }

            metrics.tileLoads.push({
                time: elapsed,
                level: event.tile.level,
                latencyMs: latencyMs,
                key: tileKey
            });

            metrics.tilesLoaded.add(tileKey);
        });

        // Detect when initial viewport is fully loaded
        viewer.addHandler('tile-load-failed', function(event) {
            console.warn('[perf] Tile load failed:', event.tile.url);
        });

        // Use OSD's native fully-loaded-change event for accurate completion detection
        // This fires when all tiles needed for the current viewport are loaded
        function attachToTiledImage(item) {
            tiledImage = item;
            tiledImage.addHandler('fully-loaded-change', function(fullyLoadedEvent) {
                if (fullyLoadedEvent.fullyLoaded && !metrics.viewportComplete) {
                    markViewportComplete();
                }
            });

            // Check if already fully loaded (can happen with cached tiles)
            if (tiledImage.getFullyLoaded() && !metrics.viewportComplete) {
                markViewportComplete();
            }
        }

        // Handle TiledImage added after we attach
        viewer.world.addHandler('add-item', function(addItemEvent) {
            attachToTiledImage(addItemEvent.item);
        });

        // Handle TiledImage that already exists (race condition: added before we attach)
        if (viewer.world.getItemCount() > 0) {
            attachToTiledImage(viewer.world.getItemAt(0));
        }
    }

    function markViewportComplete() {
        metrics.viewportComplete = true;
        metrics.viewportCompleteTime = performance.now() - metrics.startTime;

        // If a Z-transition is pending completion, mark it complete
        const pendingZ = metrics.zTransitions.find(z => z.endTime === null);
        if (pendingZ) {
            pendingZ.endTime = performance.now();
            pendingZ.durationMs = Math.round(pendingZ.endTime - pendingZ.startTime);
            pendingZ.tilesLoadedAfter = metrics.tileLoads.length;
            pendingZ.tilesLoaded = pendingZ.tilesLoadedAfter - pendingZ.tilesLoadedBefore;
        }
    }

    function checkViewportComplete() {
        // Called by harness during polling - check OSD's native fully-loaded state
        if (metrics.viewportComplete) return;

        if (tiledImage && tiledImage.getFullyLoaded()) {
            markViewportComplete();
        }
    }

    // ========== Scenario-specific metrics (Step 0.2) ==========

    /**
     * Start timing a Z-plane transition
     * Call this when Z-slider value changes, before tiles start loading
     */
    function startZTransition(fromZ, toZ) {
        // Reset viewport complete flag for new transition
        metrics.viewportComplete = false;

        const transition = {
            fromZ: fromZ,
            toZ: toZ,
            startTime: performance.now(),
            endTime: null,
            durationMs: null,
            tilesLoadedBefore: metrics.tileLoads.length,
            tilesLoadedAfter: null,
            tilesLoaded: null
        };
        metrics.zTransitions.push(transition);
        return transition;
    }

    /**
     * Complete the current Z-transition timing
     * Call this when viewport is fully loaded after Z change
     */
    function completeZTransition() {
        const pending = metrics.zTransitions.find(z => z.endTime === null);
        if (pending) {
            pending.endTime = performance.now();
            pending.durationMs = Math.round(pending.endTime - pending.startTime);
            pending.tilesLoadedAfter = metrics.tileLoads.length;
            pending.tilesLoaded = pending.tilesLoadedAfter - pending.tilesLoadedBefore;
        }
        return pending;
    }

    /**
     * Start timing a generic operation (pan, zoom, etc.)
     * @param {string} type - Operation type: 'pan', 'zoom', 'z-slide'
     * @param {object} params - Operation parameters (direction, level, etc.)
     */
    function startOperation(type, params = {}) {
        const operation = {
            type: type,
            params: params,
            startTime: performance.now(),
            endTime: null,
            durationMs: null,
            tilesLoadedBefore: metrics.tileLoads.length,
            tilesLoadedAfter: null,
            tilesLoaded: null
        };
        metrics.currentOperation = operation;
        return operation;
    }

    /**
     * Complete the current operation timing
     */
    function completeOperation() {
        if (metrics.currentOperation) {
            const op = metrics.currentOperation;
            op.endTime = performance.now();
            op.durationMs = Math.round(op.endTime - op.startTime);
            op.tilesLoadedAfter = metrics.tileLoads.length;
            op.tilesLoaded = op.tilesLoadedAfter - op.tilesLoadedBefore;
            metrics.operations.push(op);
            metrics.currentOperation = null;
            return op;
        }
        return null;
    }

    /**
     * Calculate cache hit rate from tile load timings
     * Tiles with latency < CACHE_HIT_THRESHOLD_MS are considered cache hits
     * @param {number} sinceIndex - Optional: only count tiles after this index
     * @returns {object} { total, cacheHits, networkLoads, hitRate }
     */
    function getCacheHitRate(sinceIndex = 0) {
        const relevantLoads = metrics.tileLoads.slice(sinceIndex);
        const withTiming = relevantLoads.filter(t => t.latencyMs > 0);

        if (withTiming.length === 0) {
            return { total: 0, cacheHits: 0, networkLoads: 0, hitRate: 0 };
        }

        const cacheHits = withTiming.filter(t => t.latencyMs < CACHE_HIT_THRESHOLD_MS).length;
        const networkLoads = withTiming.length - cacheHits;

        return {
            total: withTiming.length,
            cacheHits: cacheHits,
            networkLoads: networkLoads,
            hitRate: (cacheHits / withTiming.length) * 100
        };
    }

    /**
     * Reset viewport complete flag (for measuring subsequent operations)
     */
    function resetViewportComplete() {
        metrics.viewportComplete = false;
        // Clear the reference to force re-checking
        if (tiledImage) {
            // TiledImage still has the handler, it will fire again when new tiles load
        }
    }

    function getResults() {
        // Calculate p50/p95 tile load latency
        const latencies = metrics.tileLoads
            .map(t => t.latencyMs)
            .filter(l => l > 0)
            .sort((a, b) => a - b);

        const p50 = latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.5)]
            : 0;
        const p95 = latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.95)]
            : 0;

        // Calculate overall cache hit rate
        const cacheStats = getCacheHitRate(0);

        // Calculate Z-transition statistics
        const completedZ = metrics.zTransitions.filter(z => z.durationMs !== null);
        const zDurations = completedZ.map(z => z.durationMs).sort((a, b) => a - b);
        const zP50 = zDurations.length > 0
            ? zDurations[Math.floor(zDurations.length * 0.5)]
            : 0;
        const zP95 = zDurations.length > 0
            ? zDurations[Math.floor(zDurations.length * 0.95)]
            : 0;

        return {
            // Core metrics
            timeToFirstTile: Math.round(metrics.firstTileTime || 0),
            timeToViewportComplete: Math.round(metrics.viewportCompleteTime || 0),
            p50TileLoad: p50,
            p95TileLoad: p95,
            totalTilesLoaded: metrics.tileLoads.length,
            tileLoads: metrics.tileLoads,  // Raw data for analysis

            // Scenario-specific metrics (Step 0.2)
            cacheHitRate: cacheStats.hitRate,
            cacheStats: cacheStats,
            zTransitions: metrics.zTransitions,
            zTransitionP50: zP50,
            zTransitionP95: zP95,
            operations: metrics.operations
        };
    }

    function forceViewportComplete() {
        if (!metrics.viewportComplete) {
            metrics.viewportComplete = true;
            metrics.viewportCompleteTime = performance.now() - metrics.startTime;
        }
    }

    return {
        attachToViewer,
        checkViewportComplete,
        forceViewportComplete,
        getResults,
        isViewportComplete: () => metrics.viewportComplete,
        // Scenario-specific API (Step 0.2)
        startZTransition,
        completeZTransition,
        startOperation,
        completeOperation,
        getCacheHitRate,
        resetViewportComplete,
        // Expose threshold for consistency
        CACHE_HIT_THRESHOLD_MS
    };
}

// Export for Node.js (when reading file) or browser (when injected)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createMetricsCollector };
}
