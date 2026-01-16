// Usage scenario scripts for performance testing (Step 0.1)
// Implements Scenarios A, B, C from w1-w4-performance-plan.md

const CONFIG = require('./config');

/**
 * Default scenario parameters - can be overridden per scenario
 */
const DEFAULT_PARAMS = {
    // Pan parameters
    panDistance: 200,        // pixels to pan per operation
    panCount: 3,             // number of pan operations

    // Zoom parameters
    zoomLevels: [2, 4],      // zoom multipliers to apply

    // Z-slide parameters
    zSlideSequence: [3, -2, 1, -1, 2],  // relative Z movements

    // Wait times
    viewportSettleMs: 2000,  // wait after pan/zoom for tiles
    zTransitionMs: 1500,     // wait after Z-slide for tiles
};

/**
 * Scenario A: Navigate-then-Z
 * 1. Load viewer at default zoom
 * 2. Pan to different area (2-3 pan operations)
 * 3. Zoom in 2x, then 4x
 * 4. Wait for viewport complete
 * 5. Z-slide through 5 planes: +3, -2, +1, -1, +2
 *
 * Metrics: Z-transition latency, tiles loaded per Z-change
 */
async function scenarioA(page, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const results = {
        scenario: 'A',
        name: 'Navigate-then-Z',
        operations: [],
        zTransitions: [],
    };

    // Wait for viewer to initialize
    await waitForViewer(page);
    await page.waitForTimeout(p.viewportSettleMs);

    // Record initial state
    const initialMetrics = await getMetrics(page);
    results.initialTiles = initialMetrics.totalTilesLoaded;

    // Step 2: Pan operations
    for (let i = 0; i < p.panCount; i++) {
        const startTime = Date.now();
        const startTiles = await getTileCount(page);

        // Pan using drag operation
        const direction = i % 2 === 0 ? 'right' : 'down';
        await panViewer(page, direction, p.panDistance);
        await page.waitForTimeout(p.viewportSettleMs);

        const endTiles = await getTileCount(page);
        results.operations.push({
            type: 'pan',
            direction,
            durationMs: Date.now() - startTime,
            tilesLoaded: endTiles - startTiles,
        });
    }

    // Step 3: Zoom operations
    for (const zoomLevel of p.zoomLevels) {
        const startTime = Date.now();
        const startTiles = await getTileCount(page);

        await zoomViewer(page, zoomLevel);
        await page.waitForTimeout(p.viewportSettleMs);

        const endTiles = await getTileCount(page);
        results.operations.push({
            type: 'zoom',
            level: zoomLevel,
            durationMs: Date.now() - startTime,
            tilesLoaded: endTiles - startTiles,
        });
    }

    // Step 4: Wait for viewport complete
    await waitForViewportComplete(page);

    // Step 5: Z-slide sequence
    for (const zDelta of p.zSlideSequence) {
        const transition = await performZTransition(page, zDelta, p.zTransitionMs);
        results.zTransitions.push(transition);
    }

    // Calculate summary metrics
    results.summary = {
        totalPanDurationMs: results.operations
            .filter(op => op.type === 'pan')
            .reduce((sum, op) => sum + op.durationMs, 0),
        totalZoomDurationMs: results.operations
            .filter(op => op.type === 'zoom')
            .reduce((sum, op) => sum + op.durationMs, 0),
        avgZTransitionMs: results.zTransitions.length > 0
            ? results.zTransitions.reduce((sum, t) => sum + t.durationMs, 0) / results.zTransitions.length
            : 0,
        p50ZTransitionMs: percentile(results.zTransitions.map(t => t.durationMs), 50),
        tilesPerZChange: results.zTransitions.length > 0
            ? results.zTransitions.reduce((sum, t) => sum + t.tilesLoaded, 0) / results.zTransitions.length
            : 0,
    };

    return results;
}

/**
 * Scenario B: Z-then-explore
 * 1. Load viewer
 * 2. Z-slide to middle plane (plane 10)
 * 3. Wait for viewport complete
 * 4. Pan to 4 different areas
 * 5. Zoom in and out
 *
 * Metrics: Tile cache hit rate, time to viewport complete per pan
 */
async function scenarioB(page, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const results = {
        scenario: 'B',
        name: 'Z-then-explore',
        operations: [],
        zTransitions: [],
    };

    // Wait for viewer to initialize
    await waitForViewer(page);
    await page.waitForTimeout(p.viewportSettleMs);

    // Step 2: Z-slide to middle plane (target: plane 10, or half of zCount)
    const targetPlane = params.targetZPlane || 10;
    const zToMiddle = await performZTransition(page, targetPlane, p.zTransitionMs * 2);
    results.zTransitions.push({ ...zToMiddle, note: 'initial Z-slide to middle' });

    // Step 3: Wait for viewport complete
    await waitForViewportComplete(page);

    // Step 4: Pan to 4 different areas
    const panDirections = ['right', 'down', 'left', 'up'];
    for (const direction of panDirections) {
        const startTime = Date.now();
        const startTiles = await getTileCount(page);
        const cacheHitsBefore = await getCacheHits(page);

        await panViewer(page, direction, p.panDistance * 1.5);
        await waitForViewportComplete(page);

        const endTiles = await getTileCount(page);
        const cacheHitsAfter = await getCacheHits(page);

        results.operations.push({
            type: 'pan',
            direction,
            durationMs: Date.now() - startTime,
            tilesLoaded: endTiles - startTiles,
            cacheHits: cacheHitsAfter - cacheHitsBefore,
        });
    }

    // Step 5: Zoom in and out
    const zoomSequence = [2, 4, 1, 0.5, 1];  // Zoom in 2x, 4x, back to 1x, zoom out, back
    for (const zoomLevel of zoomSequence) {
        const startTime = Date.now();
        const startTiles = await getTileCount(page);

        await zoomViewer(page, zoomLevel);
        await waitForViewportComplete(page);

        results.operations.push({
            type: 'zoom',
            level: zoomLevel,
            durationMs: Date.now() - startTime,
            tilesLoaded: await getTileCount(page) - startTiles,
        });
    }

    // Calculate summary metrics
    const panOps = results.operations.filter(op => op.type === 'pan');
    const totalTilesLoaded = panOps.reduce((sum, op) => sum + op.tilesLoaded, 0);
    const totalCacheHits = panOps.reduce((sum, op) => sum + (op.cacheHits || 0), 0);

    results.summary = {
        avgPanDurationMs: panOps.length > 0
            ? panOps.reduce((sum, op) => sum + op.durationMs, 0) / panOps.length
            : 0,
        cacheHitRate: totalTilesLoaded > 0
            ? (totalCacheHits / totalTilesLoaded) * 100
            : 0,
        p50PanDurationMs: percentile(panOps.map(op => op.durationMs), 50),
    };

    return results;
}

/**
 * Scenario C: Mixed browsing
 * 1. Load viewer
 * 2. Simulate realistic session: pan, zoom 2x, Z-slide +2, pan, zoom out, Z-slide -3, pan, zoom 4x
 *
 * Metrics: Overall p50/p95 tile latency, cache hit rate, Z-transition responsiveness
 */
async function scenarioC(page, params = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const results = {
        scenario: 'C',
        name: 'Mixed browsing',
        operations: [],
        zTransitions: [],
        tileLatencies: [],
    };

    // Wait for viewer to initialize
    await waitForViewer(page);
    await page.waitForTimeout(p.viewportSettleMs);

    // Define the mixed operation sequence
    const sequence = [
        { type: 'pan', direction: 'right' },
        { type: 'zoom', level: 2 },
        { type: 'z-slide', delta: 2 },
        { type: 'pan', direction: 'down' },
        { type: 'zoom', level: 0.5 },
        { type: 'z-slide', delta: -3 },
        { type: 'pan', direction: 'left' },
        { type: 'zoom', level: 4 },
    ];

    for (const op of sequence) {
        const startTime = Date.now();
        const startTiles = await getTileCount(page);

        switch (op.type) {
            case 'pan':
                await panViewer(page, op.direction, p.panDistance);
                await page.waitForTimeout(p.viewportSettleMs);
                break;
            case 'zoom':
                await zoomViewer(page, op.level);
                await page.waitForTimeout(p.viewportSettleMs);
                break;
            case 'z-slide':
                const transition = await performZTransition(page, op.delta, p.zTransitionMs);
                results.zTransitions.push(transition);
                break;
        }

        const endTiles = await getTileCount(page);

        if (op.type !== 'z-slide') {
            results.operations.push({
                type: op.type,
                ...op,
                durationMs: Date.now() - startTime,
                tilesLoaded: endTiles - startTiles,
            });
        }

        // Collect tile latencies after each operation
        const latencies = await getTileLatencies(page);
        results.tileLatencies.push(...latencies);
    }

    // Calculate summary metrics
    const allLatencies = results.tileLatencies.filter(l => l > 0).sort((a, b) => a - b);

    results.summary = {
        p50TileLatency: percentile(allLatencies, 50),
        p95TileLatency: percentile(allLatencies, 95),
        avgZTransitionMs: results.zTransitions.length > 0
            ? results.zTransitions.reduce((sum, t) => sum + t.durationMs, 0) / results.zTransitions.length
            : 0,
        totalOperations: results.operations.length + results.zTransitions.length,
        totalTilesLoaded: results.operations.reduce((sum, op) => sum + op.tilesLoaded, 0),
    };

    return results;
}

// Helper functions

/**
 * Wait for the OpenSeadragon viewer to initialize
 */
async function waitForViewer(page) {
    await page.waitForFunction(() => {
        const container = document.getElementById('viewer');
        return container && container.viewer && container.viewer.world;
    }, { timeout: 30000 });
}

/**
 * Wait for viewport to be fully loaded with tiles
 */
async function waitForViewportComplete(page, timeoutMs = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const complete = await page.evaluate(() => {
            const container = document.getElementById('viewer');
            if (!container || !container.viewer) return false;

            const viewer = container.viewer;
            if (viewer.world.getItemCount() === 0) return false;

            // Check if current visible item is fully loaded
            const currentItem = viewer.world.getItemAt(0);
            if (currentItem && currentItem.getFullyLoaded) {
                return currentItem.getFullyLoaded();
            }
            return false;
        });

        if (complete) return true;
        await page.waitForTimeout(200);
    }

    return false;
}

/**
 * Get current tile count from metrics collector
 */
async function getTileCount(page) {
    return await page.evaluate(() => {
        if (window.__perfMetrics) {
            const results = window.__perfMetrics.getResults();
            return results.totalTilesLoaded || 0;
        }
        return 0;
    });
}

/**
 * Get cache hits (warm tiles) count
 * Uses metrics-collector's getCacheHitRate for consistent threshold
 */
async function getCacheHits(page) {
    return await page.evaluate(() => {
        if (window.__perfMetrics) {
            const cacheStats = window.__perfMetrics.getCacheHitRate(0);
            return cacheStats.cacheHits;
        }
        return 0;
    });
}

/**
 * Get cache hit rate statistics
 * @param {number} sinceIndex - Only count tiles after this index (for incremental measurement)
 */
async function getCacheHitStats(page, sinceIndex = 0) {
    return await page.evaluate((idx) => {
        if (window.__perfMetrics) {
            return window.__perfMetrics.getCacheHitRate(idx);
        }
        return { total: 0, cacheHits: 0, networkLoads: 0, hitRate: 0 };
    }, sinceIndex);
}

/**
 * Get tile latencies from metrics collector
 */
async function getTileLatencies(page) {
    return await page.evaluate(() => {
        if (window.__perfMetrics) {
            const results = window.__perfMetrics.getResults();
            return (results.tileLoads || []).map(t => t.latencyMs);
        }
        return [];
    });
}

/**
 * Get full metrics from collector
 */
async function getMetrics(page) {
    return await page.evaluate(() => {
        if (window.__perfMetrics) {
            return window.__perfMetrics.getResults();
        }
        return { totalTilesLoaded: 0 };
    });
}

/**
 * Pan the viewer in a direction
 */
async function panViewer(page, direction, distance) {
    const viewer = await page.evaluateHandle(() => document.getElementById('viewer').viewer);

    // Calculate pan delta based on direction
    let deltaX = 0, deltaY = 0;
    switch (direction) {
        case 'left':  deltaX = distance; break;
        case 'right': deltaX = -distance; break;
        case 'up':    deltaY = distance; break;
        case 'down':  deltaY = -distance; break;
    }

    await page.evaluate(({ dx, dy }) => {
        const viewer = document.getElementById('viewer').viewer;
        const center = viewer.viewport.getCenter();
        const pixelDelta = new OpenSeadragon.Point(dx, dy);
        const viewportDelta = viewer.viewport.deltaPointsFromPixels(pixelDelta);
        viewer.viewport.panTo(center.plus(viewportDelta));
    }, { dx: deltaX, dy: deltaY });
}

/**
 * Zoom the viewer to a level
 */
async function zoomViewer(page, level) {
    await page.evaluate((zoomLevel) => {
        const viewer = document.getElementById('viewer').viewer;
        const currentZoom = viewer.viewport.getZoom();
        viewer.viewport.zoomTo(currentZoom * zoomLevel);
    }, level);
}

/**
 * Perform Z-plane transition and measure timing
 * Uses metrics-collector's Z-transition tracking for accurate browser-side timing
 */
async function performZTransition(page, zDelta, maxWaitMs) {
    const startTime = Date.now();

    // Get current Z, start transition tracking, and trigger Z change
    const result = await page.evaluate((delta) => {
        const slider = document.getElementById('z-slider');
        if (!slider) return { success: false, reason: 'No Z-slider (2D mosaic?)' };

        const currentZ = parseInt(slider.value, 10);
        const maxZ = parseInt(slider.max, 10);
        let targetZ = currentZ + delta;

        // Clamp to valid range
        targetZ = Math.max(0, Math.min(targetZ, maxZ));

        // Start timing via metrics collector (before slider change)
        if (window.__perfMetrics) {
            window.__perfMetrics.startZTransition(currentZ, targetZ);
        }

        // Set slider value and dispatch input event
        slider.value = targetZ;
        slider.dispatchEvent(new Event('input', { bubbles: true }));

        return { success: true, fromZ: currentZ, toZ: targetZ };
    }, zDelta);

    if (!result.success) {
        return {
            zDelta,
            durationMs: 0,
            tilesLoaded: 0,
            skipped: true,
            reason: result.reason,
        };
    }

    // Wait for tiles to load after Z transition
    await waitForViewportComplete(page, maxWaitMs);

    // Complete the Z-transition timing and get browser-side metrics
    const transitionMetrics = await page.evaluate(() => {
        if (window.__perfMetrics) {
            return window.__perfMetrics.completeZTransition();
        }
        return null;
    });

    // Use browser-side timing if available, fallback to wallclock
    const durationMs = transitionMetrics?.durationMs ?? (Date.now() - startTime);
    const tilesLoaded = transitionMetrics?.tilesLoaded ?? 0;

    return {
        zDelta,
        fromZ: result.fromZ,
        toZ: result.toZ,
        durationMs,
        tilesLoaded,
        // Include browser-side metrics for analysis
        browserMetrics: transitionMetrics,
    };
}

/**
 * Start timing an operation in the metrics collector
 * @param {string} type - Operation type: 'pan', 'zoom', 'z-slide'
 * @param {object} params - Operation parameters
 */
async function startOperation(page, type, params = {}) {
    return await page.evaluate(({ opType, opParams }) => {
        if (window.__perfMetrics) {
            return window.__perfMetrics.startOperation(opType, opParams);
        }
        return null;
    }, { opType: type, opParams: params });
}

/**
 * Complete the current operation timing in the metrics collector
 */
async function completeOperation(page) {
    return await page.evaluate(() => {
        if (window.__perfMetrics) {
            return window.__perfMetrics.completeOperation();
        }
        return null;
    });
}

/**
 * Get full scenario metrics from the collector
 * Returns all tracked data including Z-transitions and operations
 */
async function getScenarioMetrics(page) {
    return await page.evaluate(() => {
        if (window.__perfMetrics) {
            return window.__perfMetrics.getResults();
        }
        return null;
    });
}

/**
 * Calculate percentile of sorted array
 */
function percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * (p / 100));
    return sorted[Math.min(index, sorted.length - 1)];
}

/**
 * Run a scenario by name
 */
async function runScenario(page, scenarioName, params = {}) {
    switch (scenarioName.toUpperCase()) {
        case 'A':
            return await scenarioA(page, params);
        case 'B':
            return await scenarioB(page, params);
        case 'C':
            return await scenarioC(page, params);
        default:
            throw new Error(`Unknown scenario: ${scenarioName}`);
    }
}

/**
 * Run all scenarios
 */
async function runAllScenarios(page, params = {}) {
    return {
        A: await scenarioA(page, params),
        B: await scenarioB(page, params),
        C: await scenarioC(page, params),
    };
}

module.exports = {
    scenarioA,
    scenarioB,
    scenarioC,
    runScenario,
    runAllScenarios,
    DEFAULT_PARAMS,
    // Export helpers for testing
    waitForViewer,
    waitForViewportComplete,
    panViewer,
    zoomViewer,
    performZTransition,
    // Scenario-specific metrics helpers (Step 0.2)
    getCacheHits,
    getCacheHitStats,
    startOperation,
    completeOperation,
    getScenarioMetrics,
    getTileCount,
    getTileLatencies,
    getMetrics,
};
