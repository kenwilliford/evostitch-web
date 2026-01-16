#!/usr/bin/env node
// 2D mosaic compatibility test (ralph loop step 5.4)
// Tests that 2D mosaics still work correctly with heartbeat changes
// Verifies no regression from 3D tile loading fixes
//
// Usage: node tests/2d-mosaic-compatibility.test.js

const { chromium } = require('playwright');

const CONFIG = {
    // 2D mosaic (single Z-plane, standard OSD behavior expected)
    MOSAIC_ID: 'SCH-55-22B_50xt_global',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    // Test timing
    WAIT_FOR_VIEWER_MS: 30000,
    SETTLE_AFTER_ACTION_MS: 2000,
    LOAD_TIMEOUT_MS: 15000,
    CHECK_INTERVAL_MS: 1000,

    VIEWPORT: { width: 1920, height: 1080 }
};

async function run2DMosaicTest() {
    console.log('=== 2D Mosaic Compatibility Test (5.4) ===\n');
    console.log('Tests: 2D mosaics should still work correctly with heartbeat changes\n');

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({ viewport: CONFIG.VIEWPORT });
        const page = await context.newPage();

        // Track any errors
        const errors = [];
        page.on('pageerror', error => {
            errors.push({ type: 'page', message: error.message });
        });
        page.on('console', msg => {
            if (msg.type() === 'error') {
                errors.push({ type: 'console', message: msg.text() });
            }
        });

        // Navigate to 2D mosaic
        const url = `${CONFIG.VIEWER_URL}?mosaic=${CONFIG.MOSAIC_ID}`;
        console.log(`Navigating to 2D mosaic: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait for viewer initialization
        console.log('Waiting for viewer initialization...');
        await page.waitForFunction(() => {
            const container = document.getElementById('viewer');
            return container && container.viewer && container.viewer.world && container.viewer.world.getItemCount() > 0;
        }, { timeout: CONFIG.WAIT_FOR_VIEWER_MS });

        // Verify it's a 2D mosaic (single TiledImage)
        const mosaicInfo = await page.evaluate(() => {
            const container = document.getElementById('viewer');
            const viewer = container.viewer;
            return {
                itemCount: viewer.world.getItemCount(),
                hasZControls: !!document.querySelector('.z-slider, .z-nav, [class*="z-plane"]')
            };
        });

        console.log(`Mosaic info: ${mosaicInfo.itemCount} TiledImage(s), Z controls visible: ${mosaicInfo.hasZControls}`);

        if (mosaicInfo.itemCount !== 1) {
            console.log('WARNING: Expected 1 TiledImage for 2D mosaic');
        }

        // Enable diagnostic logging
        await page.evaluate(() => {
            if (window.evostitch && window.evostitch.tilePrioritizer) {
                window.evostitch.tilePrioritizer.setDiagnostic(true);
            }
        });

        // --- Test 1: Initial load works ---
        console.log('\n--- Test 1: Initial tile load ---');
        const initialState = await page.evaluate(() => {
            const stats = window.evostitch?.telemetry?.getStats();
            return {
                tilesLoaded: (stats?.totals?.coldCount || 0) + (stats?.totals?.warmCount || 0),
                prioritizerEnabled: window.evostitch?.tilePrioritizer?.getState()?.enabled ?? false
            };
        });
        console.log(`Initial tiles loaded: ${initialState.tilesLoaded}`);
        console.log(`Tile prioritizer enabled: ${initialState.prioritizerEnabled}`);

        // Wait for initial view to fully load
        let initialLoadComplete = false;
        const startTime = Date.now();
        while (Date.now() - startTime < CONFIG.LOAD_TIMEOUT_MS) {
            const state = await page.evaluate(() => {
                const container = document.getElementById('viewer');
                const tiledImage = container?.viewer?.world?.getItemAt(0);
                return {
                    fullyLoaded: tiledImage?.getFullyLoaded() ?? false,
                    pendingJobs: window.evostitch?.tilePrioritizer?.getState()?.pendingJobs ?? 0
                };
            });

            if (state.fullyLoaded) {
                initialLoadComplete = true;
                console.log('Initial view fully loaded!');
                break;
            }
            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        if (!initialLoadComplete) {
            console.log('Note: Initial view not marked fully loaded (may still be loading edge tiles)');
        }

        // --- Test 2: Zoom to mid-level works ---
        console.log('\n--- Test 2: Zoom to 50% ---');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            const minZoom = viewer.viewport.getMinZoom();
            const targetZoom = minZoom + (maxZoom - minZoom) * 0.5;
            viewer.viewport.zoomTo(targetZoom);
        });

        await page.waitForTimeout(CONFIG.SETTLE_AFTER_ACTION_MS);

        // Count tiles loaded after zoom
        const afterZoom = await page.evaluate(() => {
            const stats = window.evostitch?.telemetry?.getStats();
            return {
                tilesLoaded: (stats?.totals?.coldCount || 0) + (stats?.totals?.warmCount || 0)
            };
        });
        console.log(`Tiles after zoom: ${afterZoom.tilesLoaded}`);

        // Wait for tiles to load at new zoom level
        const zoomLoadStart = Date.now();
        let zoomLoadSuccess = false;
        while (Date.now() - zoomLoadStart < CONFIG.LOAD_TIMEOUT_MS) {
            const state = await page.evaluate(() => ({
                pendingJobs: window.evostitch?.tilePrioritizer?.getState()?.pendingJobs ?? 0,
                fullyLoaded: document.getElementById('viewer')?.viewer?.world?.getItemAt(0)?.getFullyLoaded() ?? false
            }));

            if (state.pendingJobs === 0 || state.fullyLoaded) {
                zoomLoadSuccess = true;
                console.log(`Zoom tiles loaded (pending: ${state.pendingJobs}, fullyLoaded: ${state.fullyLoaded})`);
                break;
            }
            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        if (!zoomLoadSuccess) {
            console.log('WARNING: Zoom tiles may still be loading');
        }

        // --- Test 3: Pan works ---
        console.log('\n--- Test 3: Pan operation ---');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const center = viewer.viewport.getCenter();
            // Pan by 10% of viewport width
            viewer.viewport.panTo({ x: center.x + 0.1, y: center.y });
        });

        await page.waitForTimeout(CONFIG.SETTLE_AFTER_ACTION_MS);

        const afterPan = await page.evaluate(() => {
            const stats = window.evostitch?.telemetry?.getStats();
            return {
                tilesLoaded: (stats?.totals?.coldCount || 0) + (stats?.totals?.warmCount || 0)
            };
        });
        console.log(`Tiles after pan: ${afterPan.tilesLoaded}`);

        // Wait for pan tiles to load
        const panLoadStart = Date.now();
        let panLoadSuccess = false;
        while (Date.now() - panLoadStart < CONFIG.LOAD_TIMEOUT_MS) {
            const state = await page.evaluate(() => ({
                pendingJobs: window.evostitch?.tilePrioritizer?.getState()?.pendingJobs ?? 0
            }));

            if (state.pendingJobs === 0) {
                panLoadSuccess = true;
                console.log('Pan tiles loaded');
                break;
            }
            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        // --- Test 4: Heartbeat behavior is correct ---
        console.log('\n--- Test 4: Heartbeat behavior ---');
        const heartbeatState = await page.evaluate(() => {
            if (window.evostitch?.tilePrioritizer) {
                const state = window.evostitch.tilePrioritizer.getState();
                return {
                    enabled: state.enabled,
                    pendingJobs: state.pendingJobs,
                    heartbeatActive: state.heartbeat?.active ?? false
                };
            }
            return null;
        });

        if (heartbeatState) {
            console.log(`Prioritizer enabled: ${heartbeatState.enabled}`);
            console.log(`Pending jobs: ${heartbeatState.pendingJobs}`);
            console.log(`Heartbeat active: ${heartbeatState.heartbeatActive}`);

            // Key check: heartbeat should NOT be active when no pending jobs
            if (heartbeatState.pendingJobs === 0 && heartbeatState.heartbeatActive) {
                errors.push({ type: 'test', message: 'Heartbeat active with no pending jobs (performance issue)' });
            }
        }

        // --- Test 5: Final tile count increased ---
        console.log('\n--- Test 5: Final state ---');
        const finalState = await page.evaluate(() => {
            const stats = window.evostitch?.telemetry?.getStats();
            return {
                tilesLoaded: (stats?.totals?.coldCount || 0) + (stats?.totals?.warmCount || 0),
                coldCount: stats?.totals?.coldCount || 0,
                warmCount: stats?.totals?.warmCount || 0
            };
        });

        console.log(`Final tiles loaded: ${finalState.tilesLoaded} (cold: ${finalState.coldCount}, warm: ${finalState.warmCount})`);
        console.log(`Tiles increased from initial: ${finalState.tilesLoaded > initialState.tilesLoaded}`);

        // Check for any errors
        console.log('\n=== Analysis ===\n');

        const criticalErrors = errors.filter(e =>
            !e.message.includes('favicon') &&
            !e.message.includes('404') &&
            !e.message.includes('net::')  // Ignore network errors for missing tiles
        );

        if (criticalErrors.length > 0) {
            console.log('Errors detected:');
            criticalErrors.forEach(e => console.log(`  [${e.type}] ${e.message}`));
        } else {
            console.log('No critical errors detected');
        }

        // Success criteria:
        // 1. No critical JavaScript errors
        // 2. Tiles loaded during interactions
        // 3. Heartbeat not active when queue empty
        const tilesIncreased = finalState.tilesLoaded > initialState.tilesLoaded;
        const noHeartbeatIssue = !(heartbeatState?.pendingJobs === 0 && heartbeatState?.heartbeatActive);
        const success = criticalErrors.length === 0 && tilesIncreased && noHeartbeatIssue;

        console.log(`\nTiles loaded during session: ${tilesIncreased ? 'YES' : 'NO'}`);
        console.log(`Heartbeat behaves correctly: ${noHeartbeatIssue ? 'YES' : 'NO'}`);
        console.log(`No critical errors: ${criticalErrors.length === 0 ? 'YES' : 'NO'}`);

        if (success) {
            console.log('\n>>> PASS: 2D mosaic works correctly <<<');
            console.log('No interference from heartbeat or 3D tile loading changes.');
        } else {
            console.log('\n>>> FAIL: 2D mosaic regression detected <<<');
            if (!tilesIncreased) console.log('  - Tiles did not load during interactions');
            if (!noHeartbeatIssue) console.log('  - Heartbeat active with empty queue');
            if (criticalErrors.length > 0) console.log('  - JavaScript errors occurred');
        }

        return {
            success,
            tilesLoaded: finalState.tilesLoaded,
            tilesIncreased,
            heartbeatCorrect: noHeartbeatIssue,
            errorCount: criticalErrors.length
        };

    } finally {
        await browser.close();
    }
}

run2DMosaicTest()
    .then(result => {
        console.log('\n=== Test Complete ===');
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Test failed with error:', error);
        process.exit(2);
    });
