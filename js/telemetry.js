// evostitch tile load telemetry - lightweight performance measurement
// Aggregates tile load times by zoom level for cold vs warm loads

(function() {
    'use strict';

    const STORAGE_KEY = 'evostitch_tile_telemetry';
    const VERSION = 1;

    // Threshold for warm cache detection (ms)
    // Tiles loading faster than this are considered cache hits
    const WARM_THRESHOLD_MS = 50;

    // Batching configuration
    const FLUSH_INTERVAL_MS = 5000;  // Flush every 5 seconds
    const FLUSH_BATCH_SIZE = 50;     // Or when 50 tiles accumulated

    // In-memory pending stats (not yet flushed to localStorage)
    let pendingStats = {
        byZoom: {}
    };
    let pendingCount = 0;
    let flushTimer = null;

    // Initialize or load existing stats from localStorage
    function loadStats() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                if (data.version === VERSION) {
                    return data;
                }
            }
        } catch (e) {
            console.warn('[evostitch] Failed to load telemetry:', e);
        }

        // Return fresh stats structure
        return {
            version: VERSION,
            deviceTier: null,
            byZoom: {},
            lastUpdated: null
        };
    }

    // Merge pending stats into stored stats and save
    function flushToStorage() {
        if (pendingCount === 0) return;

        try {
            const stats = loadStats();

            // Merge pending into stored
            for (const [key, pending] of Object.entries(pendingStats.byZoom)) {
                if (!stats.byZoom[key]) {
                    stats.byZoom[key] = {
                        coldCount: 0,
                        coldTotalMs: 0,
                        warmCount: 0,
                        warmTotalMs: 0
                    };
                }
                stats.byZoom[key].coldCount += pending.coldCount;
                stats.byZoom[key].coldTotalMs += pending.coldTotalMs;
                stats.byZoom[key].warmCount += pending.warmCount;
                stats.byZoom[key].warmTotalMs += pending.warmTotalMs;
            }

            stats.lastUpdated = new Date().toISOString();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));

            // Reset pending
            pendingStats = { byZoom: {} };
            pendingCount = 0;
        } catch (e) {
            console.warn('[evostitch] Failed to flush telemetry:', e);
        }
    }

    // Schedule a flush (debounced)
    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(function() {
            flushTimer = null;
            flushToStorage();
        }, FLUSH_INTERVAL_MS);
    }

    // Record a single tile load (batched in memory)
    function recordTileLoad(zoomLevel, latencyMs, isWarm) {
        const key = String(zoomLevel);

        if (!pendingStats.byZoom[key]) {
            pendingStats.byZoom[key] = {
                coldCount: 0,
                coldTotalMs: 0,
                warmCount: 0,
                warmTotalMs: 0
            };
        }

        const zoom = pendingStats.byZoom[key];
        if (isWarm) {
            zoom.warmCount++;
            zoom.warmTotalMs += latencyMs;
        } else {
            zoom.coldCount++;
            zoom.coldTotalMs += latencyMs;
        }

        pendingCount++;

        // Flush if batch size reached, otherwise schedule
        if (pendingCount >= FLUSH_BATCH_SIZE) {
            flushToStorage();
        } else {
            scheduleFlush();
        }
    }

    // Save stats to localStorage (used by setDeviceTier)
    function saveStats(stats) {
        try {
            stats.lastUpdated = new Date().toISOString();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
        } catch (e) {
            console.warn('[evostitch] Failed to save telemetry:', e);
        }
    }

    // Set device tier for context
    function setDeviceTier(tier) {
        const stats = loadStats();
        stats.deviceTier = tier;
        saveStats(stats);
    }

    // Get computed statistics (includes unflushed pending data)
    function getStats() {
        // Merge stored + pending for complete picture
        const stored = loadStats();

        // Build combined byZoom data
        const combined = {};
        const allKeys = new Set([
            ...Object.keys(stored.byZoom),
            ...Object.keys(pendingStats.byZoom)
        ]);

        for (const key of allKeys) {
            const s = stored.byZoom[key] || { coldCount: 0, coldTotalMs: 0, warmCount: 0, warmTotalMs: 0 };
            const p = pendingStats.byZoom[key] || { coldCount: 0, coldTotalMs: 0, warmCount: 0, warmTotalMs: 0 };
            combined[key] = {
                coldCount: s.coldCount + p.coldCount,
                coldTotalMs: s.coldTotalMs + p.coldTotalMs,
                warmCount: s.warmCount + p.warmCount,
                warmTotalMs: s.warmTotalMs + p.warmTotalMs
            };
        }

        const result = {
            deviceTier: stored.deviceTier,
            lastUpdated: stored.lastUpdated,
            byZoom: {},
            totals: {
                coldCount: 0,
                coldAvgMs: 0,
                warmCount: 0,
                warmAvgMs: 0
            }
        };

        let totalColdMs = 0;
        let totalWarmMs = 0;

        for (const [zoom, data] of Object.entries(combined)) {
            result.byZoom[zoom] = {
                coldCount: data.coldCount,
                coldAvgMs: data.coldCount > 0 ? Math.round(data.coldTotalMs / data.coldCount) : 0,
                warmCount: data.warmCount,
                warmAvgMs: data.warmCount > 0 ? Math.round(data.warmTotalMs / data.warmCount) : 0
            };

            result.totals.coldCount += data.coldCount;
            result.totals.warmCount += data.warmCount;
            totalColdMs += data.coldTotalMs;
            totalWarmMs += data.warmTotalMs;
        }

        result.totals.coldAvgMs = result.totals.coldCount > 0
            ? Math.round(totalColdMs / result.totals.coldCount)
            : 0;
        result.totals.warmAvgMs = result.totals.warmCount > 0
            ? Math.round(totalWarmMs / result.totals.warmCount)
            : 0;

        return result;
    }

    // Clear all telemetry data
    function clearStats() {
        // Clear pending
        pendingStats = { byZoom: {} };
        pendingCount = 0;
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        // Clear stored
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.warn('[evostitch] Failed to clear telemetry:', e);
        }
    }

    // Log summary to console
    function logSummary() {
        const stats = getStats();
        if (stats.totals.coldCount === 0 && stats.totals.warmCount === 0) {
            console.log('[evostitch] Telemetry: no data yet');
            return;
        }

        console.log(
            `[evostitch] Telemetry: cold=${stats.totals.coldCount} tiles (avg ${stats.totals.coldAvgMs}ms), ` +
            `warm=${stats.totals.warmCount} tiles (avg ${stats.totals.warmAvgMs}ms)`
        );
    }

    // Flush on page visibility change or unload
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            flushToStorage();
        }
    });
    window.addEventListener('beforeunload', flushToStorage);

    // Expose API
    window.evostitch = window.evostitch || {};
    window.evostitch.telemetry = {
        recordTileLoad,
        setDeviceTier,
        getStats,
        clearStats,
        logSummary,
        flushToStorage,
        WARM_THRESHOLD_MS
    };
})();
