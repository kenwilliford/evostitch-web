#!/usr/bin/env node
// Tile loading stall diagnosis test (ralph loop step 1.1)
// Tests whether tiles continue loading when viewport is stationary after deep zoom
//
// Usage: node tests/tile-loading-stall.test.js
//
// This test:
// 1. Opens a 3D mosaic at evostitch.net
// 2. Zooms to maximum
// 3. Stops all interaction
// 4. Waits 30 seconds, checking every 5 seconds if tiles are still loading or stalled
//
// Expected result (if fix needed): tiles stop loading after viewport becomes stationary
// Expected result (after fix): tiles continue loading to completion

const { chromium } = require('playwright');

const CONFIG = {
    // 3D test mosaic
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    // Use localhost to test unreleased code (diagnostic logging)
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    // Test timing
    WAIT_FOR_VIEWER_MS: 30000,
    INITIAL_SETTLE_MS: 3000,    // Wait after zoom before monitoring
    MONITOR_DURATION_MS: 30000, // How long to monitor for stall
    CHECK_INTERVAL_MS: 5000,    // How often to check tile loading state

    // Viewport
    VIEWPORT: { width: 1920, height: 1080 }
};

async function runStallTest() {
    console.log('=== Tile Loading Stall Diagnosis Test ===\n');
    console.log(`Mosaic: ${CONFIG.MOSAIC_ID}`);
    console.log(`Monitor duration: ${CONFIG.MONITOR_DURATION_MS / 1000}s`);
    console.log('');

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({
            viewport: CONFIG.VIEWPORT
        });
        const page = await context.newPage();

        // Collect diagnostic and debug logs via console messages
        const processQueueCalls = [];
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('TilePrioritizer') || text.includes('[DIAG')) {
                processQueueCalls.push({
                    time: Date.now(),
                    message: text
                });
                // Print diagnostic messages in real-time
                if (text.includes('[DIAG')) {
                    console.log('  ' + text);
                }
            }
        });

        // Navigate to viewer
        const url = `${CONFIG.VIEWER_URL}?mosaic=${CONFIG.MOSAIC_ID}`;
        console.log(`Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait for viewer to initialize
        console.log('Waiting for viewer initialization...');
        await page.waitForFunction(() => {
            const container = document.getElementById('viewer');
            return container && container.viewer && container.viewer.world;
        }, { timeout: CONFIG.WAIT_FOR_VIEWER_MS });

        // Enable debug and diagnostic logging for tile prioritizer
        await page.evaluate(() => {
            if (window.evostitch && window.evostitch.tilePrioritizer) {
                window.evostitch.tilePrioritizer.setDebug(true);
                window.evostitch.tilePrioritizer.setDiagnostic(true);
            }
        });

        // Wait for initial tiles to load
        console.log('Waiting for initial tiles to load...');
        await page.waitForTimeout(3000);

        // Zoom to maximum
        console.log('Zooming to maximum level...');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            viewer.viewport.zoomTo(maxZoom);
        });

        // Wait for zoom animation to complete
        await page.waitForTimeout(CONFIG.INITIAL_SETTLE_MS);

        // Change Z-plane (key part of stall reproduction scenario)
        console.log('Changing Z-plane...');
        const zInfo = await page.evaluate(() => {
            const container = document.getElementById('viewer');
            if (!container || !container.viewer || !container.viewer.world) {
                return { success: false, error: 'No viewer' };
            }
            const zCount = container.viewer.world.getItemCount();
            if (zCount < 2) {
                return { success: false, error: 'Only 1 Z-plane', zCount };
            }
            // Get current Z from tile prioritizer
            const currentZ = window.evostitch?.tilePrioritizer?.getState()?.currentZ || 0;
            const newZ = currentZ + 1 < zCount ? currentZ + 1 : currentZ - 1;

            // Change Z via the setZPlane function (exposed globally by viewer.js)
            if (window.setZPlane) {
                window.setZPlane(newZ);
            } else if (window.evostitch?.tilePrioritizer) {
                // Fallback: just update prioritizer Z (won't change visibility)
                window.evostitch.tilePrioritizer.setCurrentZ(newZ);
            }
            return { success: true, oldZ: currentZ, newZ, zCount };
        });
        console.log(`Z-change result: ${JSON.stringify(zInfo)}`);

        // Wait for Z-change to settle
        await page.waitForTimeout(1000);
        console.log('Viewport stationary after Z-change. Starting monitoring phase...\n');

        // Monitor tile loading over 30 seconds
        const samples = [];
        const startTime = Date.now();
        let lastTileCount = 0;
        let lastPendingJobs = 0;

        while (Date.now() - startTime < CONFIG.MONITOR_DURATION_MS) {
            // Get current state
            const state = await page.evaluate(() => {
                const result = {
                    tilePrioritizer: null,
                    tilesLoaded: 0,
                    fullyLoaded: false
                };

                // Get tile prioritizer state
                if (window.evostitch && window.evostitch.tilePrioritizer) {
                    result.tilePrioritizer = window.evostitch.tilePrioritizer.getState();
                }

                // Get OpenSeadragon state
                const container = document.getElementById('viewer');
                if (container && container.viewer && container.viewer.world) {
                    const tiledImage = container.viewer.world.getItemAt(0);
                    if (tiledImage) {
                        result.fullyLoaded = tiledImage.getFullyLoaded();
                        // Count loaded tiles from tiledImage
                        if (tiledImage.tilesLoaded !== undefined) {
                            result.tilesLoaded = tiledImage.tilesLoaded;
                        }
                    }
                }

                // Try to get tile count from telemetry if available
                if (window.evostitch && window.evostitch.telemetry) {
                    const stats = window.evostitch.telemetry.getStats();
                    if (stats && stats.totals) {
                        result.tilesLoaded = stats.totals.coldCount + stats.totals.warmCount;
                    }
                }

                return result;
            });

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const pendingJobs = state.tilePrioritizer?.pendingJobs || 0;
            const tilesLoaded = state.tilesLoaded || 0;
            const isAnimating = state.tilePrioritizer?.isAnimating || false;
            const fullyLoaded = state.fullyLoaded;

            // Calculate deltas
            const newTiles = tilesLoaded - lastTileCount;
            const pendingDelta = pendingJobs - lastPendingJobs;

            const sample = {
                elapsed,
                pendingJobs,
                tilesLoaded,
                newTiles,
                isAnimating,
                fullyLoaded
            };
            samples.push(sample);

            // Log progress
            const status = fullyLoaded ? 'COMPLETE' : (pendingJobs > 0 ? 'LOADING' : 'IDLE');
            console.log(`[${elapsed}s] pendingJobs=${pendingJobs} tilesLoaded=${tilesLoaded} (+${newTiles}) animating=${isAnimating} status=${status}`);

            lastTileCount = tilesLoaded;
            lastPendingJobs = pendingJobs;

            // If fully loaded, we're done
            if (fullyLoaded) {
                console.log('\n>>> Viewport fully loaded! <<<\n');
                break;
            }

            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        // Analyze results
        console.log('\n=== Analysis ===\n');

        const totalNewTiles = samples.reduce((sum, s) => sum + s.newTiles, 0);
        const lastSample = samples[samples.length - 1];
        const idleSamples = samples.filter(s => s.pendingJobs === 0 && !s.fullyLoaded);
        const loadingSamples = samples.filter(s => s.pendingJobs > 0 || s.newTiles > 0);

        console.log(`Total samples: ${samples.length}`);
        console.log(`Total new tiles during monitoring: ${totalNewTiles}`);
        console.log(`Idle samples (pendingJobs=0, not fully loaded): ${idleSamples.length}`);
        console.log(`Loading samples (pendingJobs>0 or newTiles>0): ${loadingSamples.length}`);
        console.log(`Final state: fullyLoaded=${lastSample.fullyLoaded}`);

        // Detect stall pattern
        const hasStall = idleSamples.length > 2 && !lastSample.fullyLoaded;
        const processQueueCallsAfterSettle = processQueueCalls.filter(c =>
            c.time > startTime + CONFIG.INITIAL_SETTLE_MS
        );

        console.log(`\nprocessQueue log messages during monitoring: ${processQueueCallsAfterSettle.length}`);

        if (hasStall) {
            console.log('\n>>> STALL DETECTED <<<');
            console.log('Tiles stopped loading while viewport not fully loaded.');
            console.log('Root cause likely: No heartbeat in tile-prioritizer processQueue.');
        } else if (lastSample.fullyLoaded) {
            console.log('\n>>> NO STALL - Tiles loaded to completion <<<');
        } else {
            console.log('\n>>> INCONCLUSIVE - More investigation needed <<<');
        }

        // Return structured result
        return {
            stalled: hasStall,
            samples,
            totalNewTiles,
            fullyLoaded: lastSample.fullyLoaded,
            processQueueCalls: processQueueCallsAfterSettle.length
        };

    } finally {
        await browser.close();
    }
}

// Run the test
runStallTest()
    .then(result => {
        console.log('\n=== Test Complete ===');
        console.log(JSON.stringify({
            stalled: result.stalled,
            fullyLoaded: result.fullyLoaded,
            totalNewTiles: result.totalNewTiles,
            sampleCount: result.samples.length,
            processQueueCalls: result.processQueueCalls
        }, null, 2));

        // Exit with error code if stall detected (test failure means bug confirmed)
        process.exit(result.stalled ? 1 : 0);
    })
    .catch(error => {
        console.error('Test failed with error:', error);
        process.exit(2);
    });
