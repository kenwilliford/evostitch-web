#!/usr/bin/env node
// Heartbeat verification test (ralph loop step 2.4)
// Tests that heartbeat keeps tiles loading when viewport is stationary after deep zoom
// This tests the basic heartbeat fix WITHOUT Z-change (Z-change is Phase 3)
//
// Usage: node tests/heartbeat-verification.test.js

const { chromium } = require('playwright');

const CONFIG = {
    // 3D test mosaic (has multiple Z-planes and high resolution)
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    // Test timing
    WAIT_FOR_VIEWER_MS: 30000,
    SETTLE_AFTER_ZOOM_MS: 2000,
    MONITOR_DURATION_MS: 15000,
    CHECK_INTERVAL_MS: 2000,

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runHeartbeatTest() {
    console.log('=== Heartbeat Verification Test (2.4) ===\n');
    console.log('Tests: zoom deep, stop — tiles should continue loading via heartbeat\n');

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({ viewport: CONFIG.VIEWPORT });
        const page = await context.newPage();

        // Track heartbeat calls
        const heartbeatLogs = [];
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[DIAG')) {
                heartbeatLogs.push({ time: Date.now(), message: text });
                // Only log heartbeat start/stop
                if (text.includes('heartbeat')) {
                    console.log('  ' + text);
                }
            }
        });

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

        // Enable diagnostic logging
        await page.evaluate(() => {
            if (window.evostitch && window.evostitch.tilePrioritizer) {
                window.evostitch.tilePrioritizer.setDiagnostic(true);
            }
        });

        // Get initial tile count
        const initialState = await page.evaluate(() => ({
            tilesLoaded: window.evostitch?.telemetry?.getStats()?.totals?.coldCount +
                         window.evostitch?.telemetry?.getStats()?.totals?.warmCount || 0
        }));
        console.log(`Initial tiles loaded: ${initialState.tilesLoaded}`);

        // Zoom to deep level (75% of max, not 100% to avoid edge case of already loaded)
        console.log('\nZooming to 75% of max zoom...');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            const minZoom = viewer.viewport.getMinZoom();
            const targetZoom = minZoom + (maxZoom - minZoom) * 0.75;
            viewer.viewport.zoomTo(targetZoom);
        });

        // Wait for zoom to settle
        await page.waitForTimeout(CONFIG.SETTLE_AFTER_ZOOM_MS);

        // Now monitor: viewport is stationary, heartbeat should keep loading tiles
        console.log('\nViewport stationary. Monitoring tile loading...\n');

        const samples = [];
        const startTime = Date.now();
        let lastTileCount = 0;
        let heartbeatDetected = false;
        let tilesLoadedDuringStationaryPhase = 0;

        while (Date.now() - startTime < CONFIG.MONITOR_DURATION_MS) {
            const state = await page.evaluate(() => {
                const result = { pendingJobs: 0, tilesLoaded: 0, fullyLoaded: false };

                if (window.evostitch?.tilePrioritizer) {
                    result.pendingJobs = window.evostitch.tilePrioritizer.getState().pendingJobs;
                }
                if (window.evostitch?.telemetry) {
                    const stats = window.evostitch.telemetry.getStats();
                    result.tilesLoaded = (stats?.totals?.coldCount || 0) + (stats?.totals?.warmCount || 0);
                }
                const container = document.getElementById('viewer');
                const tiledImage = container?.viewer?.world?.getItemAt(0);
                if (tiledImage) {
                    result.fullyLoaded = tiledImage.getFullyLoaded();
                }
                return result;
            });

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const newTiles = state.tilesLoaded - lastTileCount;

            if (newTiles > 0) {
                tilesLoadedDuringStationaryPhase += newTiles;
            }

            // Check if heartbeat is active (logs during stationary phase)
            const recentHeartbeatLogs = heartbeatLogs.filter(h => h.time > startTime && h.message.includes('processQueue'));
            if (recentHeartbeatLogs.length > 0) {
                heartbeatDetected = true;
            }

            const status = state.fullyLoaded ? 'COMPLETE' : (state.pendingJobs > 0 ? 'LOADING' : 'IDLE');
            console.log(`[${elapsed}s] pending=${state.pendingJobs} tiles=${state.tilesLoaded} (+${newTiles}) status=${status}`);

            samples.push({ elapsed, ...state, newTiles });
            lastTileCount = state.tilesLoaded;

            if (state.fullyLoaded) {
                console.log('\n>>> Tiles fully loaded! <<<');
                break;
            }

            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        // Analysis
        console.log('\n=== Analysis ===\n');

        const lastSample = samples[samples.length - 1];
        const heartbeatLogsInPhase = heartbeatLogs.filter(h => h.time > startTime);

        console.log(`Tiles loaded during stationary phase: ${tilesLoadedDuringStationaryPhase}`);
        console.log(`Heartbeat processQueue calls: ${heartbeatLogsInPhase.filter(h => h.message.includes('processQueue')).length}`);
        console.log(`Final state: fullyLoaded=${lastSample.fullyLoaded}`);

        // Success criteria:
        // 1. Tiles continued loading during stationary phase (heartbeat working), OR
        // 2. Already fully loaded (nothing to do)
        const success = lastSample.fullyLoaded || tilesLoadedDuringStationaryPhase > 0;

        if (success) {
            console.log('\n>>> PASS: Heartbeat is working <<<');
            console.log('Tiles continued loading while viewport was stationary.');
        } else {
            console.log('\n>>> FAIL: Heartbeat not working <<<');
            console.log('No tiles loaded during stationary phase despite not being fully loaded.');
        }

        return {
            success,
            tilesLoadedDuringStationaryPhase,
            fullyLoaded: lastSample.fullyLoaded,
            heartbeatCalls: heartbeatLogsInPhase.filter(h => h.message.includes('processQueue')).length
        };

    } finally {
        await browser.close();
    }
}

runHeartbeatTest()
    .then(result => {
        console.log('\n=== Test Complete ===');
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Test failed with error:', error);
        process.exit(2);
    });
