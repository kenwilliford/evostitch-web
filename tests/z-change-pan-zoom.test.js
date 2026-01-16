#!/usr/bin/env node
// Z-change pan/zoom responsiveness test (ralph loop step 3.5)
// Tests: zoom in -> change Z -> pan/zoom at new Z -> should behave like 2D (responsive tile loading)
//
// Usage: node tests/z-change-pan-zoom.test.js

const { chromium } = require('playwright');

const CONFIG = {
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    WAIT_FOR_VIEWER_MS: 30000,
    SETTLE_MS: 2000,
    PAN_SETTLE_MS: 3000,    // Time to wait for tiles after pan/zoom
    RESPONSIVE_THRESHOLD_MS: 5000,  // 5s to reach full resolution after interaction (2D-like)
    CHECK_INTERVAL_MS: 250,

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runTest() {
    console.log('=== Z-Change Pan/Zoom Responsiveness Test (3.5) ===\n');
    console.log('Tests: zoom in -> change Z -> pan/zoom -> responsive tile loading\n');

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

        // Step 1: Zoom in (not max, like 70% zoom for realistic scenario)
        console.log('\n--- Step 1: Zooming to ~70% zoom level ---');
        const zoomInfo = await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const minZoom = viewer.viewport.getMinZoom();
            const maxZoom = viewer.viewport.getMaxZoom();
            const targetZoom = minZoom + (maxZoom - minZoom) * 0.7;
            viewer.viewport.zoomTo(targetZoom);
            return { minZoom, maxZoom, targetZoom };
        });
        console.log(`Zoom target: ${zoomInfo.targetZoom.toFixed(2)} (70% between ${zoomInfo.minZoom.toFixed(2)}-${zoomInfo.maxZoom.toFixed(2)})`);

        // Wait for zoom to settle
        await page.waitForTimeout(CONFIG.SETTLE_MS);

        // Get current state before Z-change
        const beforeState = await page.evaluate(() => {
            const state = window.evostitch?.tilePrioritizer?.getState() || {};
            const viewer = document.getElementById('viewer')?.viewer;
            const tiledImage = viewer?.world?.getItemAt(state.currentZ);
            return {
                currentZ: state.currentZ,
                zCount: state.zCount,
                zoom: viewer?.viewport?.getZoom(),
                drawnLevel: tiledImage?.lastDrawn?.length > 0
                    ? Math.max(...tiledImage.lastDrawn.map(t => t.level)) : 0,
                drawnCount: tiledImage?.lastDrawn?.length || 0
            };
        });
        console.log(`Current Z: ${beforeState.currentZ}, Zoom: ${beforeState.zoom?.toFixed(2)}, Tiles: ${beforeState.drawnCount} at lvl ${beforeState.drawnLevel}`);

        // Step 2: Change Z-plane
        const targetZ = beforeState.currentZ + 1 < beforeState.zCount
            ? beforeState.currentZ + 1
            : beforeState.currentZ - 1;

        console.log(`\n--- Step 2: Changing Z from ${beforeState.currentZ} to ${targetZ} ---`);
        await page.evaluate((z) => {
            const slider = document.getElementById('z-slider');
            if (slider) {
                slider.value = z;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, targetZ);

        // Wait for Z-change to process
        await page.waitForTimeout(1000);
        console.log('Z-change complete, tiles loading...');

        // Step 3: Pan to a different viewport location
        console.log('\n--- Step 3: Panning viewport ---');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const center = viewer.viewport.getCenter();
            // Pan 20% of viewport width to the right and up
            viewer.viewport.panTo(new OpenSeadragon.Point(
                center.x + 0.1,
                center.y - 0.1
            ));
        });
        console.log('Pan initiated...');

        // Monitor tile loading responsiveness after pan
        console.log(`\nMonitoring tile loading (max ${CONFIG.RESPONSIVE_THRESHOLD_MS / 1000}s for responsive behavior)...\n`);

        let panLoadResult = await monitorTileLoading(page, targetZ, CONFIG.RESPONSIVE_THRESHOLD_MS);
        console.log(`\nPan result: ${panLoadResult.success ? 'PASS' : 'FAIL'} (${panLoadResult.loadTimeMs}ms to ${panLoadResult.drawnLevel}/${panLoadResult.maxLevel})`);

        // Step 4: Zoom at new Z-plane
        console.log('\n--- Step 4: Zooming at new Z-plane ---');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const currentZoom = viewer.viewport.getZoom();
            // Zoom in another 30%
            const maxZoom = viewer.viewport.getMaxZoom();
            const newZoom = Math.min(currentZoom * 1.3, maxZoom);
            viewer.viewport.zoomTo(newZoom);
        });
        console.log('Zoom initiated...');

        // Monitor tile loading after zoom
        console.log(`\nMonitoring tile loading after zoom (max ${CONFIG.RESPONSIVE_THRESHOLD_MS / 1000}s)...\n`);

        let zoomLoadResult = await monitorTileLoading(page, targetZ, CONFIG.RESPONSIVE_THRESHOLD_MS);
        console.log(`\nZoom result: ${zoomLoadResult.success ? 'PASS' : 'FAIL'} (${zoomLoadResult.loadTimeMs}ms to ${zoomLoadResult.drawnLevel}/${zoomLoadResult.maxLevel})`);

        // Final analysis
        console.log('\n=== Results ===\n');

        const allPassed = panLoadResult.success && zoomLoadResult.success;

        if (allPassed) {
            console.log('>>> PASS: Pan and zoom after Z-change are responsive (2D-like behavior) <<<');
            console.log(`  - Pan: ${panLoadResult.loadTimeMs}ms to full resolution`);
            console.log(`  - Zoom: ${zoomLoadResult.loadTimeMs}ms to full resolution`);
        } else {
            console.log('>>> FAIL: Tile loading after Z-change not responsive <<<');
            if (!panLoadResult.success) {
                console.log(`  - Pan: FAILED - ${panLoadResult.loadTimeMs}ms, level ${panLoadResult.drawnLevel}/${panLoadResult.maxLevel}`);
            }
            if (!zoomLoadResult.success) {
                console.log(`  - Zoom: FAILED - ${zoomLoadResult.loadTimeMs}ms, level ${zoomLoadResult.drawnLevel}/${zoomLoadResult.maxLevel}`);
            }
        }

        return {
            success: allPassed,
            panResult: panLoadResult,
            zoomResult: zoomLoadResult,
            responsiveThresholdMs: CONFIG.RESPONSIVE_THRESHOLD_MS
        };

    } finally {
        await browser.close();
    }
}

async function monitorTileLoading(page, targetZ, maxTime) {
    const startTime = Date.now();
    let lastTileCount = 0;

    while (Date.now() - startTime < maxTime) {
        const state = await page.evaluate((targetZ) => {
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
            }
            if (window.evostitch?.telemetry) {
                const stats = window.evostitch.telemetry.getStats();
                result.tilesLoaded = (stats?.totals?.coldCount || 0) + (stats?.totals?.warmCount || 0);
            }
            const viewer = document.getElementById('viewer')?.viewer;
            if (viewer) {
                const tiledImage = viewer.world.getItemAt(targetZ);
                if (tiledImage) {
                    result.drawnCount = tiledImage.lastDrawn?.length || 0;
                    if (tiledImage.lastDrawn?.length > 0) {
                        result.drawnLevel = Math.max(...tiledImage.lastDrawn.map(t => t.level));
                    }
                    result.maxLevel = tiledImage.source?.maxLevel || 0;
                    result.fullyLoaded = tiledImage.getFullyLoaded() && result.drawnLevel === result.maxLevel;
                }
            }
            return result;
        }, targetZ);

        const elapsed = Date.now() - startTime;
        const elapsedSec = (elapsed / 1000).toFixed(1);
        const newTiles = state.tilesLoaded - lastTileCount;

        console.log(`[${elapsedSec}s] pending=${state.pendingJobs} tiles=${state.tilesLoaded} (+${newTiles}) lvl=${state.drawnLevel}/${state.maxLevel} ${state.fullyLoaded ? 'COMPLETE' : ''}`);

        lastTileCount = state.tilesLoaded;

        if (state.fullyLoaded) {
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
    const finalState = await page.evaluate((targetZ) => {
        const viewer = document.getElementById('viewer')?.viewer;
        const tiledImage = viewer?.world?.getItemAt(targetZ);
        return {
            drawnLevel: tiledImage?.lastDrawn?.length > 0
                ? Math.max(...tiledImage.lastDrawn.map(t => t.level)) : 0,
            maxLevel: tiledImage?.source?.maxLevel || 0
        };
    }, targetZ);

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
