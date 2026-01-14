// Browser-side metrics collector - injected via page.evaluate()
// Hooks into OpenSeadragon events to capture tile timing

function createMetricsCollector() {
    const metrics = {
        startTime: performance.now(),
        firstTileTime: null,
        viewportCompleteTime: null,
        tileLoads: [],
        tilesInViewport: new Set(),
        tilesLoaded: new Set(),
        viewportComplete: false
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
    }

    function checkViewportComplete() {
        // Called by harness during polling - check OSD's native fully-loaded state
        if (metrics.viewportComplete) return;

        if (tiledImage && tiledImage.getFullyLoaded()) {
            markViewportComplete();
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

        return {
            timeToFirstTile: Math.round(metrics.firstTileTime || 0),
            timeToViewportComplete: Math.round(metrics.viewportCompleteTime || 0),
            p50TileLoad: p50,
            p95TileLoad: p95,
            totalTilesLoaded: metrics.tileLoads.length,
            tileLoads: metrics.tileLoads  // Raw data for analysis
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
        isViewportComplete: () => metrics.viewportComplete
    };
}

// Export for Node.js (when reading file) or browser (when injected)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createMetricsCollector };
}
