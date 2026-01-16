#!/usr/bin/env node
// Z-change full resolution loading test (ralph loop step 3.4)
// Tests: change Z at deep zoom, all tiles load to full resolution within 10s
//
// Usage: node tests/z-change-full-resolution.test.js

const { chromium } = require('playwright');

const CONFIG = {
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    WAIT_FOR_VIEWER_MS: 30000,
    SETTLE_AFTER_ZOOM_MS: 3000,
    MAX_LOAD_TIME_MS: 10000,  // 10 second limit per spec
    CHECK_INTERVAL_MS: 500,

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runTest() {
    console.log('=== Z-Change Full Resolution Test (3.4) ===\n');
    console.log('Tests: change Z at deep zoom, all tiles load to full resolution within 10s\n');

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

        // Zoom to max level for "full resolution" test
        console.log('\nZooming to max zoom level...');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            viewer.viewport.zoomTo(maxZoom);
        });

        // Wait for zoom to settle and tiles to load
        console.log(`Waiting ${CONFIG.SETTLE_AFTER_ZOOM_MS / 1000}s for zoom to settle...`);
        await page.waitForTimeout(CONFIG.SETTLE_AFTER_ZOOM_MS);

        // Get current Z and viewport state before change
        const beforeState = await page.evaluate(() => {
            const state = window.evostitch?.tilePrioritizer?.getState() || {};
            const viewer = document.getElementById('viewer')?.viewer;
            const tiledImage = viewer?.world?.getItemAt(state.currentZ);
            return {
                currentZ: state.currentZ,
                zCount: state.zCount,
                zoom: viewer?.viewport?.getZoom(),
                maxZoom: viewer?.viewport?.getMaxZoom(),
                drawnLevel: tiledImage?.lastDrawn?.length > 0 ? Math.max(...tiledImage.lastDrawn.map(t => t.level)) : 0,
                drawnCount: tiledImage?.lastDrawn?.length || 0
            };
        });
        console.log(`Current Z: ${beforeState.currentZ}, Total Z-planes: ${beforeState.zCount}`);
        console.log(`BEFORE: zoom=${beforeState.zoom?.toFixed(2)}/${beforeState.maxZoom?.toFixed(2)} drawn=${beforeState.drawnCount} at lvl ${beforeState.drawnLevel}`);

        // Determine target Z (move to a different Z-plane)
        const targetZ = beforeState.currentZ + 1 < beforeState.zCount
            ? beforeState.currentZ + 1
            : beforeState.currentZ - 1;

        // Change Z-plane
        console.log(`\n=== CHANGING Z FROM ${beforeState.currentZ} TO ${targetZ} ===\n`);

        await page.evaluate((z) => {
            const slider = document.getElementById('z-slider');
            if (slider) {
                slider.value = z;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, targetZ);

        // Give OSD time to process the Z-change
        await page.waitForTimeout(300);

        // Wait briefly for Z-change to process
        await page.waitForTimeout(500);

        // Monitor tile loading - should complete within 10s
        console.log(`Monitoring tile loading (max ${CONFIG.MAX_LOAD_TIME_MS / 1000}s)...\n`);

        const startTime = Date.now();
        let fullyLoaded = false;
        let elapsed = 0;
        let lastTileCount = 0;
        let lastPending = 0;

        while (elapsed < CONFIG.MAX_LOAD_TIME_MS) {
            const state = await page.evaluate((targetZ) => {
                const result = {
                    pendingJobs: 0,
                    tilesLoaded: 0,
                    xyProgress: 0,
                    currentZ: 0,
                    tilesLoading: 0,
                    lastDrawnCount: 0,
                    drawnLevel: 0,
                    maxLevel: 0
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
                // Use loading indicator's XY progress as "fully loaded" check
                if (window.evostitch?.loadingIndicator) {
                    const indicatorState = window.evostitch.loadingIndicator.getState();
                    result.xyProgress = indicatorState.xyProgress || 0;
                }
                // OSD internal state
                const viewer = document.getElementById('viewer')?.viewer;
                if (viewer) {
                    const tiledImage = viewer.world.getItemAt(targetZ);
                    if (tiledImage) {
                        result.tilesLoading = tiledImage._loading || 0;
                        result.lastDrawnCount = tiledImage.lastDrawn?.length || 0;
                        if (tiledImage.lastDrawn?.length > 0) {
                            result.drawnLevel = Math.max(...tiledImage.lastDrawn.map(t => t.level));
                        }
                        result.maxLevel = tiledImage.source?.maxLevel || 0;
                        // Use OSD's fullyLoaded as primary completion check
                        // (loading indicator xyProgress is Phase 4 fix)
                        result.fullyLoadedOSD = tiledImage.getFullyLoaded();
                    }
                }
                return result;
            }, targetZ);

            elapsed = Date.now() - startTime;
            const elapsedSec = (elapsed / 1000).toFixed(1);
            const newTiles = state.tilesLoaded - lastTileCount;
            const xyPct = Math.round(state.xyProgress * 100);
            // Use OSD's fullyLoaded + max level as completion check
            // (xyProgress from loading indicator is Phase 4 fix)
            const isComplete = state.fullyLoadedOSD && state.drawnLevel === state.maxLevel;
            const statusStr = isComplete ? 'COMPLETE' : (state.pendingJobs > 0 ? 'LOADING' : 'IDLE');

            console.log(`[${elapsedSec}s] pending=${state.pendingJobs} tiles=${state.tilesLoaded} (+${newTiles}) xy=${xyPct}% lvl=${state.drawnLevel}/${state.maxLevel} osdLoaded=${state.fullyLoadedOSD} status=${statusStr}`);

            lastTileCount = state.tilesLoaded;
            lastPending = state.pendingJobs;

            if (isComplete) {
                fullyLoaded = true;
                console.log(`\n>>> FULLY LOADED (level ${state.drawnLevel}/${state.maxLevel}) in ${elapsedSec}s <<<`);
                break;
            }

            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        // Final analysis
        console.log('\n=== Results ===\n');

        const finalElapsed = Date.now() - startTime;
        const success = fullyLoaded && finalElapsed <= CONFIG.MAX_LOAD_TIME_MS;

        if (success) {
            console.log(`>>> PASS: Tiles loaded to full resolution in ${(finalElapsed / 1000).toFixed(1)}s (limit: 10s) <<<`);
        } else if (fullyLoaded) {
            console.log(`>>> FAIL: Loaded but took ${(finalElapsed / 1000).toFixed(1)}s (limit: 10s) <<<`);
        } else {
            console.log(`>>> FAIL: Did not reach full resolution within ${CONFIG.MAX_LOAD_TIME_MS / 1000}s <<<`);
            console.log(`Final state: pending=${lastPending}`);
        }

        return {
            success,
            fullyLoaded,
            loadTimeMs: finalElapsed,
            withinLimit: finalElapsed <= CONFIG.MAX_LOAD_TIME_MS
        };

    } finally {
        await browser.close();
    }
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
