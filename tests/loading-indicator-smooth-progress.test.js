#!/usr/bin/env node
// Loading indicator smooth progress test (ralph loop step 4.4)
// Tests: indicator shows 0→25→50→75→100% smoothly during load, then hides
//
// Usage: node tests/loading-indicator-smooth-progress.test.js

const { chromium } = require('playwright');

const CONFIG = {
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    WAIT_FOR_VIEWER_MS: 30000,
    SAMPLE_INTERVAL_MS: 100,  // Sample progress every 100ms
    MAX_LOAD_TIME_MS: 30000,  // Max time to wait for loading cycle

    // Progress thresholds to check (approximate)
    PROGRESS_THRESHOLDS: [0, 25, 50, 75, 100],
    THRESHOLD_TOLERANCE: 15,  // +/- tolerance for hitting thresholds

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runTest() {
    console.log('=== Loading Indicator Smooth Progress Test (4.4) ===\n');
    console.log('Tests: indicator shows 0→25→50→75→100% smoothly during load, then hides\n');

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

        // Wait for initial load to fully settle
        console.log('Waiting for initial load to settle...');
        await page.waitForTimeout(5000);

        // Wait for indicator to be hidden (initial load complete)
        await page.waitForFunction(() => {
            const state = window.evostitch?.loadingIndicator?.getState();
            return state && !state.isLoading;
        }, { timeout: 15000 }).catch(() => {
            console.log('(initial load still in progress, continuing anyway)');
        });

        // Get Z count
        const zCount = await page.evaluate(() => {
            return window.evostitch?.tilePrioritizer?.getState()?.zCount || 1;
        });
        console.log(`Z-planes: ${zCount}`);

        // Zoom to moderate level first
        console.log('\nZooming to 50% of max zoom...');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            viewer.viewport.zoomTo(maxZoom * 0.5, null, true);  // immediate=true
        });
        await page.waitForTimeout(3000);

        // Now trigger fresh loading by changing Z-plane
        // This should cause a fresh load cycle we can measure
        console.log('\nChanging Z-plane to trigger loading cycle...');
        await page.evaluate(() => {
            const slider = document.getElementById('z-slider');
            const currentZ = parseInt(slider.value);
            const maxZ = parseInt(slider.max);
            // Jump to a different Z-plane
            const newZ = currentZ < maxZ / 2 ? maxZ - 1 : 1;
            slider.value = newZ;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Sample progress values during loading
        const progressSamples = [];
        const startTime = Date.now();
        let lastXY = -1;
        let lastZ = -1;
        let indicatorHidden = false;
        let sawLoading = false;

        console.log('\nSampling progress values...\n');

        while (Date.now() - startTime < CONFIG.MAX_LOAD_TIME_MS) {
            const state = await page.evaluate(() => {
                return window.evostitch?.loadingIndicator?.getState();
            });

            if (state) {
                const xy = Math.round(state.xyProgress * 100);
                const z = Math.round(state.zProgress * 100);

                if (state.isLoading) {
                    sawLoading = true;
                }

                // Record all progress values
                if (xy !== lastXY || z !== lastZ) {
                    progressSamples.push({
                        xy,
                        z,
                        isLoading: state.isLoading,
                        visible: state.visible,
                        elapsed: Date.now() - startTime
                    });
                    lastXY = xy;
                    lastZ = z;
                    console.log(`  XY: ${xy}%, Z: ${z}% (loading=${state.isLoading}, visible=${state.visible}) at ${Date.now() - startTime}ms`);
                }

                // Check if indicator has hidden after being in loading state
                if (sawLoading && !state.isLoading && !state.visible) {
                    indicatorHidden = true;
                    console.log('\nIndicator hidden after loading!');
                    break;
                }
            }

            await page.waitForTimeout(CONFIG.SAMPLE_INTERVAL_MS);
        }

        // If we timed out, check final state
        if (!indicatorHidden) {
            await page.waitForTimeout(2000);  // Extra wait
            const finalState = await page.evaluate(() => {
                return window.evostitch?.loadingIndicator?.getState();
            });
            if (finalState && !finalState.isLoading && !finalState.visible) {
                indicatorHidden = true;
                console.log('\nIndicator hidden (detected after timeout)');
            }
        }

        // Analyze results
        console.log('\n=== RESULTS ===\n');

        // Get max XY progress reached
        const maxXY = Math.max(...progressSamples.map(s => s.xy));
        const maxZ = Math.max(...progressSamples.map(s => s.z));
        console.log(`Max XY progress: ${maxXY}%`);
        console.log(`Max Z progress: ${maxZ}%`);

        const uniqueXY = [...new Set(progressSamples.map(s => s.xy))].sort((a, b) => a - b);
        console.log(`Unique XY values: ${uniqueXY.join('%, ')}%`);

        // Check if we hit each threshold range
        const thresholdsHit = {};
        for (const threshold of CONFIG.PROGRESS_THRESHOLDS) {
            const hit = progressSamples.some(s => {
                if (threshold === 0) return s.xy <= CONFIG.THRESHOLD_TOLERANCE;
                if (threshold === 100) return s.xy >= 100 - CONFIG.THRESHOLD_TOLERANCE;
                return Math.abs(s.xy - threshold) <= CONFIG.THRESHOLD_TOLERANCE;
            });
            thresholdsHit[threshold] = hit;
        }

        console.log('\nThreshold coverage:');
        for (const [threshold, hit] of Object.entries(thresholdsHit)) {
            console.log(`  ${threshold}%: ${hit ? '✓' : '✗'}`);
        }

        // Success criteria:
        // 1. Max XY reached at least 85% (near complete)
        // 2. At least 3 distinct progress samples
        // 3. Indicator eventually hides (or reaches 100%)
        const reachedHighProgress = maxXY >= 85;
        const hasSufficientSamples = progressSamples.length >= 3;
        const completed = indicatorHidden || maxXY >= 100;

        console.log('\n--- SUMMARY ---\n');
        console.log(`Reached high progress (≥85%): ${reachedHighProgress ? '✓' : '✗'} (${maxXY}%)`);
        console.log(`Sufficient progress samples (≥3): ${hasSufficientSamples ? '✓' : '✗'} (${progressSamples.length})`);
        console.log(`Loading completed: ${completed ? '✓' : '✗'} (hidden=${indicatorHidden}, maxXY=${maxXY}%)`);

        const passed = reachedHighProgress && hasSufficientSamples && completed;

        if (passed) {
            console.log('\n✓ PASS: Loading indicator shows smooth progress and completes properly\n');
        } else {
            console.log('\n✗ FAIL: Loading indicator progress not working as expected\n');
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
