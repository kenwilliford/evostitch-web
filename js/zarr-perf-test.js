// evostitch Zarr Performance Test Harness
// Self-contained IIFE for measuring Z-switch timing across multiple scenarios.
// Load via console: var s = document.createElement('script'); s.src = 'js/zarr-perf-test.js'; document.head.appendChild(s);
// Or add <script src="js/zarr-perf-test.js"></script> to zarr-viewer.html
//
// Usage:
//   evostitch.perfTest.runAll().then(r => evostitch.perfTest.logResults())
//   evostitch.perfTest.runScenario('cold-z-switch').then(r => console.log(r))

(function() {
    'use strict';

    var POLL_INTERVAL_MS = 50;
    var POLL_TIMEOUT_MS = 5000;

    var lastResults = null;

    // ---------- Helpers ----------

    function delay(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    /**
     * Wait for a Z-switch to complete by polling getPerfStats().sampleCount.
     * Returns the timing in ms, or null on timeout.
     * @param {number} expectedCount - The sampleCount value we expect after completion
     * @returns {Promise<number|null>} Duration in ms or null if timed out
     */
    function waitForZSwitch(expectedCount) {
        var start = performance.now();
        return new Promise(function(resolve) {
            var timer = setInterval(function() {
                var stats = window.evostitch.zarrViewer.getPerfStats();
                if (stats.sampleCount >= expectedCount) {
                    clearInterval(timer);
                    resolve(stats.lastMs);
                } else if (performance.now() - start > POLL_TIMEOUT_MS) {
                    clearInterval(timer);
                    console.warn('[perfTest] Z-switch timed out after ' + POLL_TIMEOUT_MS + 'ms');
                    resolve(null);
                }
            }, POLL_INTERVAL_MS);
        });
    }

    /**
     * Get current sampleCount from perf stats.
     * @returns {number}
     */
    function getSampleCount() {
        return window.evostitch.zarrViewer.getPerfStats().sampleCount;
    }

    /**
     * Get SW cache entry count if available.
     * @returns {Promise<number>}
     */
    function getSwCacheEntries() {
        if (!window.evostitch.sw || !window.evostitch.sw.isActive()) {
            return Promise.resolve(-1);
        }
        return window.evostitch.sw.getStats().then(function(stats) {
            return stats.entryCount || 0;
        }).catch(function() {
            return -1;
        });
    }

    /**
     * Clear the SW cache if available.
     * @returns {Promise}
     */
    function clearSwCache() {
        if (!window.evostitch.sw || !window.evostitch.sw.isActive()) {
            return Promise.resolve();
        }
        return window.evostitch.sw.clearCache().catch(function() {
            // Ignore errors
        });
    }

    /**
     * Get prefetch stats if available.
     * @returns {Object|null}
     */
    function getPrefetchStats() {
        if (!window.evostitch.zarrPrefetch) return null;
        return window.evostitch.zarrPrefetch.getStats();
    }

    /**
     * Compute summary stats from an array of measurements.
     * @param {Array} measurements - Array of {timeMs, ...} objects
     * @returns {Object}
     */
    function computeSummary(measurements) {
        var times = measurements.map(function(m) { return m.timeMs; }).filter(function(t) { return t !== null; });
        if (times.length === 0) {
            return { avgMs: null, p50Ms: null, p95Ms: null, minMs: null, maxMs: null, validSamples: 0 };
        }

        var sorted = times.slice().sort(function(a, b) { return a - b; });
        var sum = 0;
        for (var i = 0; i < sorted.length; i++) sum += sorted[i];

        return {
            avgMs: Math.round(sum / sorted.length),
            p50Ms: sorted[Math.floor(sorted.length * 0.5)],
            p95Ms: sorted[Math.floor(sorted.length * 0.95)],
            minMs: sorted[0],
            maxMs: sorted[sorted.length - 1],
            validSamples: sorted.length
        };
    }

    // ---------- Scenarios ----------

    /**
     * Scenario 1: Cold Z-switch
     * Clear SW cache, then switch to Z+5 and measure the load time.
     */
    function scenarioColdZSwitch() {
        var viewer = window.evostitch.zarrViewer;
        var viewerState = viewer.getState();
        var startZ = viewerState.currentZ;
        var targetZ = Math.min(startZ + 5, viewerState.zCount - 1);

        console.log('[perfTest] Cold Z-switch: Z=' + startZ + ' -> Z=' + targetZ);

        return clearSwCache().then(function() {
            return delay(500); // Allow cache to clear
        }).then(function() {
            viewer.clearPerfStats();
            var expected = 1;
            viewer.setZ(targetZ);
            return waitForZSwitch(expected);
        }).then(function(timeMs) {
            return getSwCacheEntries().then(function(entries) {
                var measurements = [{ z: targetZ, timeMs: timeMs, swCacheEntries: entries }];
                var summary = computeSummary(measurements);
                summary.cacheState = 'cold';
                return {
                    scenario: 'cold-z-switch',
                    measurements: measurements,
                    summary: summary
                };
            });
        });
    }

    /**
     * Scenario 2: Warm Z-switch
     * Prefetch Z+1, wait 3s for completion, then switch and measure.
     */
    function scenarioWarmZSwitch() {
        var viewer = window.evostitch.zarrViewer;
        var viewerState = viewer.getState();
        var startZ = viewerState.currentZ;
        var targetZ = Math.min(startZ + 1, viewerState.zCount - 1);

        console.log('[perfTest] Warm Z-switch: prefetching Z=' + targetZ + ', then switching');

        // Prefetch the target plane
        if (window.evostitch.zarrPrefetch) {
            window.evostitch.zarrPrefetch.warmPlane(targetZ);
        }

        return delay(3000).then(function() {
            viewer.clearPerfStats();
            var expected = 1;
            viewer.setZ(targetZ);
            return waitForZSwitch(expected);
        }).then(function(timeMs) {
            return getSwCacheEntries().then(function(entries) {
                var prefetch = getPrefetchStats();
                var measurements = [{ z: targetZ, timeMs: timeMs, swCacheEntries: entries }];
                var summary = computeSummary(measurements);
                summary.cacheState = 'warm';
                summary.prefetchHits = prefetch ? prefetch.hits : null;
                summary.prefetchMisses = prefetch ? prefetch.misses : null;
                return {
                    scenario: 'warm-z-switch',
                    measurements: measurements,
                    summary: summary
                };
            });
        });
    }

    /**
     * Scenario 3: Sequential Z-walk
     * Step from Z=0 to Z=5 with 2s gaps, measuring each switch.
     */
    function scenarioSequentialZWalk() {
        var viewer = window.evostitch.zarrViewer;
        var viewerState = viewer.getState();
        var maxZ = Math.min(5, viewerState.zCount - 1);
        var measurements = [];

        console.log('[perfTest] Sequential Z-walk: Z=0 to Z=' + maxZ);

        // Start at Z=0
        viewer.setZ(0);

        return delay(2000).then(function() {
            viewer.clearPerfStats();

            // Build a promise chain: for each Z from 1..maxZ, switch and measure
            var chain = Promise.resolve();
            for (var z = 1; z <= maxZ; z++) {
                (function(targetZ) {
                    chain = chain.then(function() {
                        var expected = targetZ; // sampleCount increments with each switch
                        viewer.setZ(targetZ);
                        return waitForZSwitch(expected).then(function(timeMs) {
                            return getSwCacheEntries().then(function(entries) {
                                measurements.push({ z: targetZ, timeMs: timeMs, swCacheEntries: entries });
                                return delay(2000);
                            });
                        });
                    });
                })(z);
            }

            return chain;
        }).then(function() {
            var summary = computeSummary(measurements);
            summary.cacheState = 'progressive';
            return {
                scenario: 'sequential-z-walk',
                measurements: measurements,
                summary: summary
            };
        });
    }

    /**
     * Scenario 4: Rapid Z-scrub
     * Change Z 10 times in 300ms (simulating fast slider drag), measure final load.
     */
    function scenarioRapidZScrub() {
        var viewer = window.evostitch.zarrViewer;
        var viewerState = viewer.getState();
        var startZ = 0;
        var steps = 10;
        var maxZ = Math.min(steps, viewerState.zCount - 1);
        var intervalMs = 30; // 300ms / 10 steps

        console.log('[perfTest] Rapid Z-scrub: ' + steps + ' changes in ' + (steps * intervalMs) + 'ms');

        viewer.setZ(startZ);

        return delay(1000).then(function() {
            viewer.clearPerfStats();

            // Fire rapid Z changes
            return new Promise(function(resolve) {
                var step = 1;
                var timer = setInterval(function() {
                    var z = Math.min(step, maxZ);
                    viewer.setZ(z);
                    step++;
                    if (step > steps) {
                        clearInterval(timer);
                        resolve();
                    }
                }, intervalMs);
            });
        }).then(function() {
            // Wait for the final Z-switch to complete
            // With debouncing, only the last setZ should trigger a real load
            // Poll until at least 1 sample appears
            var start = performance.now();
            return new Promise(function(resolve) {
                var timer = setInterval(function() {
                    var stats = viewer.getPerfStats();
                    if (stats.sampleCount > 0) {
                        clearInterval(timer);
                        resolve(stats);
                    } else if (performance.now() - start > POLL_TIMEOUT_MS) {
                        clearInterval(timer);
                        resolve(stats);
                    }
                }, POLL_INTERVAL_MS);
            });
        }).then(function(finalStats) {
            return getSwCacheEntries().then(function(entries) {
                var renderOpt = window.evostitch.zarrRenderOpt ? window.evostitch.zarrRenderOpt.getStats() : null;
                var measurements = [{
                    z: maxZ,
                    timeMs: finalStats.lastMs,
                    swCacheEntries: entries,
                    totalSamples: finalStats.sampleCount
                }];
                var summary = computeSummary(measurements);
                summary.debouncedCount = renderOpt ? renderOpt.zSwitchDebouncedCount : null;
                summary.layerRecreations = renderOpt ? renderOpt.layerRecreations : null;
                summary.requestedSwitches = steps;
                summary.actualLoads = finalStats.sampleCount;
                return {
                    scenario: 'rapid-z-scrub',
                    measurements: measurements,
                    summary: summary
                };
            });
        });
    }

    /**
     * Scenario 5: Back-and-forth
     * Z=5->6->5->6->5 with 1s gaps to measure cache benefit from revisiting planes.
     */
    function scenarioBackAndForth() {
        var viewer = window.evostitch.zarrViewer;
        var viewerState = viewer.getState();
        var zA = Math.min(5, viewerState.zCount - 1);
        var zB = Math.min(6, viewerState.zCount - 1);
        var sequence = [zA, zB, zA, zB, zA];
        var measurements = [];

        console.log('[perfTest] Back-and-forth: Z=' + sequence.join('->'));

        // Navigate to a different starting Z so the first switch is real
        viewer.setZ(Math.max(0, zA - 2));

        return delay(1500).then(function() {
            viewer.clearPerfStats();

            var chain = Promise.resolve();
            for (var i = 0; i < sequence.length; i++) {
                (function(idx) {
                    chain = chain.then(function() {
                        var targetZ = sequence[idx];
                        var expected = idx + 1;
                        viewer.setZ(targetZ);
                        return waitForZSwitch(expected).then(function(timeMs) {
                            return getSwCacheEntries().then(function(entries) {
                                measurements.push({
                                    step: idx + 1,
                                    z: targetZ,
                                    timeMs: timeMs,
                                    swCacheEntries: entries,
                                    isRevisit: idx >= 2
                                });
                                return delay(1000);
                            });
                        });
                    });
                })(i);
            }

            return chain;
        }).then(function() {
            // Split measurements into first-visit and revisit groups
            var firstVisits = measurements.filter(function(m) { return !m.isRevisit; });
            var revisits = measurements.filter(function(m) { return m.isRevisit; });

            var summary = computeSummary(measurements);
            summary.firstVisitAvgMs = computeSummary(firstVisits).avgMs;
            summary.revisitAvgMs = computeSummary(revisits).avgMs;
            summary.cacheSpeedup = (summary.firstVisitAvgMs && summary.revisitAvgMs)
                ? ((1 - summary.revisitAvgMs / summary.firstVisitAvgMs) * 100).toFixed(0) + '%'
                : 'N/A';

            return {
                scenario: 'back-and-forth',
                measurements: measurements,
                summary: summary
            };
        });
    }

    /**
     * Scenario 6: Cache warmth check
     * After a Z-walk, report SW cache entry count and prefetch stats.
     * This is a diagnostic scenario, not a timing test.
     */
    function scenarioCacheWarmthCheck() {
        console.log('[perfTest] Cache warmth check: inspecting cache and prefetch state');

        return getSwCacheEntries().then(function(entries) {
            var prefetch = getPrefetchStats();
            var cacheStats = null;

            var p = Promise.resolve(null);
            if (window.evostitch.zarrCache) {
                cacheStats = window.evostitch.zarrCache.getStats();
            }

            return p.then(function() {
                var measurements = [{
                    swCacheEntries: entries,
                    prefetchCacheSize: prefetch ? prefetch.cacheSize : null,
                    prefetchCachedPlanes: prefetch ? prefetch.cachedPlanes : null,
                    prefetchHits: prefetch ? prefetch.hits : null,
                    prefetchMisses: prefetch ? prefetch.misses : null,
                    prefetchPending: prefetch ? prefetch.pendingFetches : null,
                    zarrCacheHitRate: cacheStats ? cacheStats.hitRate : null,
                    zarrCacheSize: cacheStats ? cacheStats.cacheSize : null
                }];

                var total = prefetch ? (prefetch.hits + prefetch.misses) : 0;
                var summary = {
                    swCacheEntries: entries,
                    prefetchHitRate: total > 0 ? Math.round(prefetch.hits / total * 100) + '%' : 'N/A',
                    zarrCacheHitRate: cacheStats ? cacheStats.hitRate : 'N/A',
                    prefetchedChunks: prefetch ? prefetch.prefetched : 0,
                    cachedPlaneCount: prefetch ? prefetch.cacheSize : 0
                };

                return {
                    scenario: 'cache-warmth-check',
                    measurements: measurements,
                    summary: summary
                };
            });
        });
    }

    // ---------- Scenario Registry ----------

    var SCENARIOS = {
        'cold-z-switch': scenarioColdZSwitch,
        'warm-z-switch': scenarioWarmZSwitch,
        'sequential-z-walk': scenarioSequentialZWalk,
        'rapid-z-scrub': scenarioRapidZScrub,
        'back-and-forth': scenarioBackAndForth,
        'cache-warmth-check': scenarioCacheWarmthCheck
    };

    // ---------- Public API ----------

    /**
     * Run all scenarios sequentially, returning combined results.
     * @returns {Promise<Object>} Results object with all scenario results
     */
    function runAll() {
        console.log('=== evostitch Performance Test Suite ===');
        console.log('Starting all scenarios...');

        var results = {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            scenarios: {}
        };

        var scenarioNames = Object.keys(SCENARIOS);
        var chain = Promise.resolve();

        scenarioNames.forEach(function(name) {
            chain = chain.then(function() {
                console.log('\n--- Scenario: ' + name + ' ---');
                return SCENARIOS[name]().then(function(result) {
                    results.scenarios[name] = result;
                    console.log('[perfTest] ' + name + ' complete');
                }).catch(function(err) {
                    console.error('[perfTest] ' + name + ' failed:', err);
                    results.scenarios[name] = { scenario: name, error: err.message };
                });
            });
        });

        return chain.then(function() {
            lastResults = results;
            console.log('\n=== All scenarios complete ===');
            return results;
        });
    }

    /**
     * Run a single scenario by name.
     * @param {string} name - Scenario name
     * @returns {Promise<Object>} Scenario result
     */
    function runScenario(name) {
        var fn = SCENARIOS[name];
        if (!fn) {
            var available = Object.keys(SCENARIOS).join(', ');
            return Promise.reject(new Error('Unknown scenario: ' + name + '. Available: ' + available));
        }

        console.log('--- Running scenario: ' + name + ' ---');
        return fn().then(function(result) {
            lastResults = { timestamp: new Date().toISOString(), scenarios: {} };
            lastResults.scenarios[name] = result;
            return result;
        });
    }

    /**
     * Get the last results object.
     * @returns {Object|null}
     */
    function getResults() {
        return lastResults;
    }

    /**
     * Pretty-print results to console.
     */
    function logResults() {
        if (!lastResults) {
            console.log('[perfTest] No results yet. Run runAll() or runScenario() first.');
            return;
        }

        console.log('\n========================================');
        console.log('  evostitch Zarr Performance Results');
        console.log('  ' + lastResults.timestamp);
        console.log('========================================\n');

        var scenarios = lastResults.scenarios;
        Object.keys(scenarios).forEach(function(name) {
            var r = scenarios[name];
            if (r.error) {
                console.log('  ' + name + ': ERROR - ' + r.error);
                return;
            }

            console.log('  ' + name.toUpperCase());
            console.log('  ' + '-'.repeat(name.length));

            // Timing measurements
            if (r.measurements) {
                r.measurements.forEach(function(m) {
                    var parts = [];
                    if (m.z !== undefined) parts.push('Z=' + m.z);
                    if (m.timeMs !== undefined && m.timeMs !== null) parts.push(m.timeMs + 'ms');
                    else if (m.timeMs === null) parts.push('TIMEOUT');
                    if (m.swCacheEntries >= 0) parts.push('SW entries=' + m.swCacheEntries);
                    if (m.totalSamples !== undefined) parts.push('loads=' + m.totalSamples);
                    console.log('    ' + parts.join(' | '));
                });
            }

            // Summary
            if (r.summary) {
                var s = r.summary;
                var summaryParts = [];
                if (s.avgMs !== undefined && s.avgMs !== null) summaryParts.push('avg=' + s.avgMs + 'ms');
                if (s.p50Ms !== undefined && s.p50Ms !== null) summaryParts.push('p50=' + s.p50Ms + 'ms');
                if (s.p95Ms !== undefined && s.p95Ms !== null) summaryParts.push('p95=' + s.p95Ms + 'ms');
                if (s.minMs !== undefined && s.minMs !== null) summaryParts.push('min=' + s.minMs + 'ms');
                if (s.maxMs !== undefined && s.maxMs !== null) summaryParts.push('max=' + s.maxMs + 'ms');
                if (s.cacheState) summaryParts.push('cache=' + s.cacheState);
                if (s.prefetchHitRate) summaryParts.push('prefetchHitRate=' + s.prefetchHitRate);
                if (s.zarrCacheHitRate) summaryParts.push('cacheHitRate=' + s.zarrCacheHitRate);
                if (s.requestedSwitches) summaryParts.push('requested=' + s.requestedSwitches);
                if (s.actualLoads !== undefined) summaryParts.push('actualLoads=' + s.actualLoads);
                if (s.debouncedCount !== undefined && s.debouncedCount !== null) summaryParts.push('debounced=' + s.debouncedCount);
                if (s.swCacheEntries !== undefined) summaryParts.push('swEntries=' + s.swCacheEntries);
                if (s.cachedPlaneCount !== undefined) summaryParts.push('cachedPlanes=' + s.cachedPlaneCount);
                if (s.prefetchedChunks !== undefined) summaryParts.push('prefetched=' + s.prefetchedChunks);

                if (summaryParts.length > 0) {
                    console.log('    Summary: ' + summaryParts.join(', '));
                }
            }

            console.log('');
        });

        console.log('========================================');

        // Console table summary for quick comparison
        var tableData = [];
        Object.keys(scenarios).forEach(function(name) {
            var r = scenarios[name];
            if (r.error) return;
            var s = r.summary || {};
            var row = { Scenario: name };
            if (s.avgMs !== undefined && s.avgMs !== null) row['Avg (ms)'] = s.avgMs;
            if (s.p50Ms !== undefined && s.p50Ms !== null) row['P50 (ms)'] = s.p50Ms;
            if (s.p95Ms !== undefined && s.p95Ms !== null) row['P95 (ms)'] = s.p95Ms;
            if (s.cacheState) row['Cache'] = s.cacheState;
            if (s.cacheSpeedup) row['Speedup'] = s.cacheSpeedup;
            if (s.actualLoads !== undefined) row['Loads'] = s.actualLoads;
            if (s.prefetchHitRate && s.prefetchHitRate !== 'N/A') row['Prefetch HR'] = s.prefetchHitRate;
            if (s.zarrCacheHitRate && s.zarrCacheHitRate !== 'N/A') row['Cache HR'] = s.zarrCacheHitRate;
            tableData.push(row);
        });
        if (tableData.length > 0 && typeof console.table === 'function') {
            console.log('\nSummary Table:');
            console.table(tableData);
        }
    }

    /**
     * List available scenario names.
     * @returns {string[]}
     */
    function listScenarios() {
        return Object.keys(SCENARIOS);
    }

    // ---------- Register on window ----------

    window.evostitch = window.evostitch || {};
    window.evostitch.perfTest = {
        runAll: runAll,
        runScenario: runScenario,
        getResults: getResults,
        logResults: logResults,
        listScenarios: listScenarios
    };

    console.log('[evostitch] perfTest loaded. Usage: evostitch.perfTest.runAll().then(() => evostitch.perfTest.logResults())');
})();
