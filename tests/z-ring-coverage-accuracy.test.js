#!/usr/bin/env node
// Z ring coverage accuracy test (ralph loop step 4.5)
// Tests: Z ring should reflect actual adjacent plane tile coverage, not stale state
//
// Verifies fix from 4.2: calculateZProgress() uses calculateTileCoverageForPlane()
// instead of getFullyLoaded() which could return stale/incorrect values.
//
// Usage: node tests/z-ring-coverage-accuracy.test.js

const { chromium } = require('playwright');

const CONFIG = {
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    WAIT_FOR_VIEWER_MS: 30000,
    SAMPLE_INTERVAL_MS: 50,   // Sample frequently to catch Z progress changes
    MAX_LOAD_TIME_MS: 30000,

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runTest() {
    console.log('=== Z Ring Coverage Accuracy Test (4.5) ===\n');
    console.log('Tests: Z ring reflects actual adjacent plane tile coverage, not stale state\n');

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
        console.log('Waiting for initial load...');
        await page.waitForTimeout(5000);

        // Get Z count and confirm 3D mosaic
        const zCount = await page.evaluate(() => {
            return window.evostitch?.tilePrioritizer?.getState()?.zCount || 1;
        });
        console.log(`Z-planes: ${zCount}`);

        if (zCount <= 1) {
            console.log('\nSKIPPED: This test requires a 3D mosaic (Z > 1)');
            return true;
        }

        // Zoom in moderately to create tile loading activity
        console.log('\nZooming to 60% of max zoom...');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            viewer.viewport.zoomTo(maxZoom * 0.6, null, true);
        });
        await page.waitForTimeout(3000);

        // Wait for initial loading to settle
        await page.waitForFunction(() => {
            const state = window.evostitch?.loadingIndicator?.getState();
            return state && !state.isLoading;
        }, { timeout: 15000 }).catch(() => {
            console.log('(initial load still in progress, continuing)');
        });

        // Record pre-Z-change state
        const preChangeState = await page.evaluate(() => {
            return window.evostitch?.loadingIndicator?.getState();
        });
        console.log(`\nPre-Z-change: XY=${Math.round((preChangeState?.xyProgress || 0) * 100)}%, Z=${Math.round((preChangeState?.zProgress || 0) * 100)}%`);

        // Change to a distant Z-plane to ensure adjacent planes need loading
        // Jump to opposite end of Z-stack
        console.log('\nChanging to distant Z-plane...');
        const targetZ = await page.evaluate(() => {
            const slider = document.getElementById('z-slider');
            const currentZ = parseInt(slider.value);
            const maxZ = parseInt(slider.max);
            // Jump to far end of Z-stack
            const newZ = currentZ < maxZ / 2 ? maxZ - 2 : 2;
            slider.value = newZ;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            return newZ;
        });
        console.log(`Target Z-plane: ${targetZ}`);

        // Sample Z progress values during loading
        const zProgressSamples = [];
        const startTime = Date.now();
        let lastZ = -1;
        let zProgressIncreased = false;
        let sawLowZProgress = false;
        let maxZProgress = 0;
        let minZProgress = 1;

        console.log('\nMonitoring Z ring progress...\n');

        while (Date.now() - startTime < CONFIG.MAX_LOAD_TIME_MS) {
            const state = await page.evaluate(() => {
                return window.evostitch?.loadingIndicator?.getState();
            });

            if (state) {
                const z = state.zProgress;
                const zPct = Math.round(z * 100);

                // Track min/max
                if (z < minZProgress && z >= 0) minZProgress = z;
                if (z > maxZProgress) maxZProgress = z;

                // Did we see Z progress below 100% after Z-change?
                // This proves we're not using stale getFullyLoaded() state
                if (z < 0.99) {
                    sawLowZProgress = true;
                }

                // Record distinct Z progress values
                if (Math.abs(z - lastZ) > 0.01) {
                    zProgressSamples.push({
                        zProgress: z,
                        zPct,
                        isLoading: state.isLoading,
                        elapsed: Date.now() - startTime
                    });
                    console.log(`  Z: ${zPct}% (loading=${state.isLoading}) at ${Date.now() - startTime}ms`);

                    // Check if Z progress increased (tiles loading)
                    if (lastZ !== -1 && z > lastZ) {
                        zProgressIncreased = true;
                    }
                    lastZ = z;
                }

                // Stop when Z progress reaches 100% and loading complete
                if (z >= 0.99 && !state.isLoading) {
                    console.log('\nZ progress reached 100% and loading complete');
                    break;
                }
            }

            await page.waitForTimeout(CONFIG.SAMPLE_INTERVAL_MS);
        }

        // Analyze results
        console.log('\n=== RESULTS ===\n');

        console.log(`Z progress samples: ${zProgressSamples.length}`);
        console.log(`Min Z progress observed: ${Math.round(minZProgress * 100)}%`);
        console.log(`Max Z progress observed: ${Math.round(maxZProgress * 100)}%`);

        const uniqueZValues = [...new Set(zProgressSamples.map(s => Math.round(s.zProgress * 100)))].sort((a, b) => a - b);
        console.log(`Unique Z progress values: ${uniqueZValues.join('%, ')}%`);

        // Success criteria for 4.5 - Z ring reflects actual coverage, not stale state:
        // 1. Z progress showed values < 100% after Z-change (proves not using stale getFullyLoaded())
        // 2. Z progress changed over time (reflects actual tile loading)
        // 3. Multiple distinct Z progress samples (ring updates in real-time)
        //
        // Note: We don't require reaching 100% - that's tested elsewhere. This test
        // verifies the fix from 4.2: using calculateTileCoverageForPlane() instead
        // of getFullyLoaded() which could return stale/incorrect 100% values.

        console.log('\n--- CRITERIA ---\n');

        const criterion1 = sawLowZProgress;
        console.log(`1. Saw Z progress < 100% after Z-change: ${criterion1 ? '✓' : '✗'}`);
        console.log(`   (min observed: ${Math.round(minZProgress * 100)}%)`);
        if (!criterion1) {
            console.log('   FAIL: Z progress never dropped below 100% - suggests stale getFullyLoaded() state');
        }

        const criterion2 = zProgressIncreased || (zProgressSamples.length > 0 && minZProgress !== maxZProgress);
        console.log(`2. Z progress reflects tile loading activity: ${criterion2 ? '✓' : '✗'}`);
        console.log(`   (range: ${Math.round(minZProgress * 100)}% → ${Math.round(maxZProgress * 100)}%)`);
        if (!criterion2) {
            console.log('   FAIL: Z progress never changed - suggests static/stale values');
        }

        const criterion3 = uniqueZValues.length >= 2;
        console.log(`3. Multiple distinct Z progress values: ${criterion3 ? '✓' : '✗'}`);
        console.log(`   (found ${uniqueZValues.length} distinct values)`);

        const passed = criterion1 && criterion2 && criterion3;

        console.log('\n--- SUMMARY ---\n');
        if (passed) {
            console.log('✓ PASS: Z ring accurately reflects adjacent plane tile coverage');
            console.log('  - Z progress starts < 100% after Z-change (not using stale getFullyLoaded())');
            console.log('  - Z progress values change as tiles load (reflects actual coverage)');
            console.log('  - Multiple distinct values prove real-time updates');
        } else {
            console.log('✗ FAIL: Z ring may be showing stale state');
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
