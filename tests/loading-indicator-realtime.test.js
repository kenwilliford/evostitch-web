#!/usr/bin/env node
// Loading indicator real-time update test (ralph loop step 4.3)
// Tests: rings update in real-time as tiles load (not just on animation events)
//
// Usage: node tests/loading-indicator-realtime.test.js

const { chromium } = require('playwright');

const CONFIG = {
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    WAIT_FOR_VIEWER_MS: 30000,
    SAMPLE_INTERVAL_MS: 50,  // Sample progress every 50ms
    MAX_LOAD_TIME_MS: 15000,  // Max time to wait for loading
    MIN_PROGRESS_SAMPLES: 5,  // Need at least 5 distinct progress values for "real-time"

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runTest() {
    console.log('=== Loading Indicator Real-Time Update Test (4.3) ===\n');
    console.log('Tests: rings update in real-time as tiles load\n');

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

        // Zoom to a moderate level to ensure there will be tile loading
        console.log('\nZooming to moderate zoom level...');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            // Use 75% of max zoom to have a good number of tiles
            viewer.viewport.zoomTo(maxZoom * 0.75);
        });

        // Wait for initial zoom to complete
        await page.waitForTimeout(2000);

        // Get current Z count
        const zCount = await page.evaluate(() => {
            return window.evostitch?.tilePrioritizer?.getState()?.zCount || 1;
        });
        console.log(`Z-planes: ${zCount}`);

        // If 3D, change Z to trigger loading
        if (zCount > 1) {
            console.log('\nChanging Z-plane to trigger fresh tile loading...');
            await page.evaluate(() => {
                const slider = document.getElementById('z-slider');
                const currentZ = parseInt(slider.value);
                const newZ = currentZ + 1 < parseInt(slider.max) ? currentZ + 1 : currentZ - 1;
                slider.value = newZ;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            });
        } else {
            // For 2D, just do another zoom to trigger loading
            console.log('\nZooming to trigger fresh tile loading...');
            await page.evaluate(() => {
                const viewer = document.getElementById('viewer').viewer;
                viewer.viewport.zoomBy(1.5);
            });
        }

        // Sample progress values during loading
        const progressSamples = [];
        const startTime = Date.now();
        let lastXY = -1;
        let lastZ = -1;

        console.log('\nSampling progress values during loading...\n');

        while (Date.now() - startTime < CONFIG.MAX_LOAD_TIME_MS) {
            const state = await page.evaluate(() => {
                return window.evostitch?.loadingIndicator?.getState();
            });

            if (state && state.isLoading) {
                const xy = state.xyProgress;
                const z = state.zProgress;

                // Record distinct progress values
                if (xy !== lastXY || z !== lastZ) {
                    progressSamples.push({
                        xy,
                        z,
                        elapsed: Date.now() - startTime
                    });
                    lastXY = xy;
                    lastZ = z;
                    console.log(`  ${progressSamples.length}. XY: ${(xy * 100).toFixed(1)}%, Z: ${(z * 100).toFixed(1)}% (at ${Date.now() - startTime}ms)`);
                }

                // Stop if fully loaded
                if (xy >= 1 && z >= 1) {
                    console.log('\nLoading complete!');
                    break;
                }
            }

            await page.waitForTimeout(CONFIG.SAMPLE_INTERVAL_MS);
        }

        // Analyze results
        console.log('\n=== RESULTS ===\n');
        console.log(`Total distinct progress samples: ${progressSamples.length}`);
        console.log(`Required minimum: ${CONFIG.MIN_PROGRESS_SAMPLES}`);

        // Extract unique XY progress values
        const uniqueXY = [...new Set(progressSamples.map(s => Math.round(s.xy * 100)))];
        const uniqueZ = [...new Set(progressSamples.map(s => Math.round(s.z * 100)))];

        console.log(`\nUnique XY progress values: ${uniqueXY.join('%, ')}%`);
        console.log(`Unique Z progress values: ${uniqueZ.join('%, ')}%`);

        // Calculate update frequency
        if (progressSamples.length >= 2) {
            const firstSample = progressSamples[0];
            const lastSample = progressSamples[progressSamples.length - 1];
            const duration = lastSample.elapsed - firstSample.elapsed;
            const avgInterval = duration / (progressSamples.length - 1);
            console.log(`\nAverage update interval: ${avgInterval.toFixed(0)}ms`);
        }

        // Test assertions
        const passed = progressSamples.length >= CONFIG.MIN_PROGRESS_SAMPLES;

        if (passed) {
            console.log(`\n✓ PASS: Loading indicator updated ${progressSamples.length} times (>= ${CONFIG.MIN_PROGRESS_SAMPLES} required)`);
            console.log('        Real-time updates confirmed!\n');
        } else {
            console.log(`\n✗ FAIL: Loading indicator only updated ${progressSamples.length} times (need >= ${CONFIG.MIN_PROGRESS_SAMPLES})`);
            console.log('        Indicator may not be updating in real-time.\n');
            process.exitCode = 1;
        }

        return passed;

    } finally {
        await browser.close();
    }
}

runTest().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
