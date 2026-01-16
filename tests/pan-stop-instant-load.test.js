#!/usr/bin/env node
// Pan/stop instant tile loading test (ralph loop step 5.5)
// Tests: zoom to 75%, pan, stop — tiles load instantly (OSD 2D-like behavior)
//
// Usage: node tests/pan-stop-instant-load.test.js

const { chromium } = require('playwright');

const CONFIG = {
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    WAIT_FOR_VIEWER_MS: 30000,
    SETTLE_MS: 2000,

    // "Instant" means < 3s to full resolution (2D OSD-like)
    INSTANT_THRESHOLD_MS: 3000,
    CHECK_INTERVAL_MS: 200,

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runTest() {
    console.log('=== Pan/Stop Instant Load Test (5.5) ===\n');
    console.log('Tests: zoom to 75%, pan, stop — tiles load instantly (2D-like)\n');

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({ viewport: CONFIG.VIEWPORT });
        const page = await context.newPage();

        // Navigate
        const url = `${CONFIG.VIEWER_URL}?mosaic=${CONFIG.MOSAIC_ID}`;
        console.log(`Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait for viewer
        console.log('Waiting for viewer initialization...');
        await page.waitForFunction(() => {
            const container = document.getElementById('viewer');
            return container && container.viewer && container.viewer.world;
        }, { timeout: CONFIG.WAIT_FOR_VIEWER_MS });

        // Wait for initial load
        console.log('Waiting for initial tiles...');
        await page.waitForTimeout(2000);

        // Step 1: Zoom to 75% zoom level
        console.log('\n--- Step 1: Zooming to 75% zoom level ---');
        const zoomInfo = await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const minZoom = viewer.viewport.getMinZoom();
            const maxZoom = viewer.viewport.getMaxZoom();
            const targetZoom = minZoom + (maxZoom - minZoom) * 0.75;
            viewer.viewport.zoomTo(targetZoom);
            return { minZoom, maxZoom, targetZoom };
        });
        console.log(`Zoom target: ${zoomInfo.targetZoom.toFixed(2)} (75% between ${zoomInfo.minZoom.toFixed(2)}-${zoomInfo.maxZoom.toFixed(2)})`);

        // Wait for zoom to settle and tiles to load
        await page.waitForTimeout(CONFIG.SETTLE_MS);

        // Wait for initial tiles to fully load before pan test
        console.log('Waiting for tiles at current viewport...');
        await waitForTilesLoaded(page, 5000);

        // Get state before pan
        const beforePan = await getViewerState(page);
        console.log(`Before pan: ${beforePan.drawnCount} tiles at lvl ${beforePan.drawnLevel}, fullyLoaded=${beforePan.fullyLoaded}`);

        // Step 2: Pan to a new location
        console.log('\n--- Step 2: Panning viewport ---');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const center = viewer.viewport.getCenter();
            // Pan 30% of viewport width to a new location
            viewer.viewport.panTo(new OpenSeadragon.Point(
                center.x + 0.15,
                center.y - 0.1
            ));
        });
        console.log('Pan initiated...');

        // Step 3: Stop and monitor tile loading time
        console.log('\n--- Step 3: Viewport stationary — monitoring tile load time ---');
        console.log(`Threshold: < ${CONFIG.INSTANT_THRESHOLD_MS}ms = "instant" (2D-like)\n`);

        const loadResult = await monitorTileLoadingTime(page, CONFIG.INSTANT_THRESHOLD_MS);

        // Analysis
        console.log('\n=== Results ===\n');

        if (loadResult.success) {
            console.log(`>>> PASS: Tiles loaded in ${loadResult.loadTimeMs}ms <<<`);
            console.log(`This is under the ${CONFIG.INSTANT_THRESHOLD_MS}ms "instant" threshold.`);
            console.log('Behavior matches vanilla 2D OSD expectations.');
        } else {
            console.log(`>>> FAIL: Tiles took ${loadResult.loadTimeMs}ms to load <<<`);
            console.log(`Exceeds the ${CONFIG.INSTANT_THRESHOLD_MS}ms "instant" threshold.`);
            console.log(`Final level: ${loadResult.drawnLevel}/${loadResult.maxLevel}`);
        }

        return {
            success: loadResult.success,
            loadTimeMs: loadResult.loadTimeMs,
            drawnLevel: loadResult.drawnLevel,
            maxLevel: loadResult.maxLevel,
            instantThresholdMs: CONFIG.INSTANT_THRESHOLD_MS
        };

    } finally {
        await browser.close();
    }
}

async function getViewerState(page) {
    return await page.evaluate(() => {
        const result = {
            pendingJobs: 0,
            tilesLoaded: 0,
            drawnCount: 0,
            drawnLevel: 0,
            maxLevel: 0,
            fullyLoaded: false
        };

        if (window.evostitch?.tilePrioritizer) {
            const s = window.evostitch.tilePrioritizer.getState();
            result.pendingJobs = s.pendingJobs;
            result.currentZ = s.currentZ;
        }
        if (window.evostitch?.telemetry) {
            const stats = window.evostitch.telemetry.getStats();
            result.tilesLoaded = (stats?.totals?.coldCount || 0) + (stats?.totals?.warmCount || 0);
        }
        const viewer = document.getElementById('viewer')?.viewer;
        if (viewer) {
            const currentZ = result.currentZ || 0;
            const tiledImage = viewer.world.getItemAt(currentZ);
            if (tiledImage) {
                result.drawnCount = tiledImage.lastDrawn?.length || 0;
                if (tiledImage.lastDrawn?.length > 0) {
                    result.drawnLevel = Math.max(...tiledImage.lastDrawn.map(t => t.level));
                }
                result.maxLevel = tiledImage.source?.maxLevel || 0;
                result.fullyLoaded = tiledImage.getFullyLoaded();
            }
        }
        return result;
    });
}

async function waitForTilesLoaded(page, maxTime) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxTime) {
        const state = await getViewerState(page);
        if (state.fullyLoaded || state.pendingJobs === 0) {
            return;
        }
        await page.waitForTimeout(200);
    }
}

async function monitorTileLoadingTime(page, maxTime) {
    const startTime = Date.now();
    let lastTileCount = 0;

    while (Date.now() - startTime < maxTime) {
        const state = await getViewerState(page);

        const elapsed = Date.now() - startTime;
        const elapsedSec = (elapsed / 1000).toFixed(1);
        const newTiles = state.tilesLoaded - lastTileCount;

        console.log(`[${elapsedSec}s] pending=${state.pendingJobs} tiles=${state.tilesLoaded} (+${newTiles}) lvl=${state.drawnLevel}/${state.maxLevel} ${state.fullyLoaded ? 'COMPLETE' : ''}`);

        lastTileCount = state.tilesLoaded;

        // Success: either fully loaded or no pending jobs (queue drained)
        if (state.fullyLoaded || (state.pendingJobs === 0 && elapsed > 500)) {
            return {
                success: true,
                loadTimeMs: elapsed,
                drawnLevel: state.drawnLevel,
                maxLevel: state.maxLevel
            };
        }

        await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
    }

    // Timed out - get final state
    const finalState = await getViewerState(page);
    return {
        success: false,
        loadTimeMs: maxTime,
        drawnLevel: finalState.drawnLevel,
        maxLevel: finalState.maxLevel
    };
}

runTest()
    .then(result => {
        console.log('\n=== Test Complete ===');
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Test failed with error:', error);
        process.exit(2);
    });
