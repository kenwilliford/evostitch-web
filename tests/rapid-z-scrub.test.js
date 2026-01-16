#!/usr/bin/env node
// Rapid Z scrubbing edge case test (ralph loop step 5.3)
// Tests: rapid Z scrubbing should not break heartbeat or cause memory issues
//
// Usage: node tests/rapid-z-scrub.test.js

const { chromium } = require('playwright');

const CONFIG = {
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    WAIT_FOR_VIEWER_MS: 30000,
    SCRUB_INTERVAL_MS: 100,      // Change Z every 100ms (10 changes/sec)
    SCRUB_DURATION_MS: 3000,     // Scrub for 3 seconds
    SETTLE_AFTER_SCRUB_MS: 5000, // Wait for tiles to load after scrubbing
    CHECK_INTERVAL_MS: 500,

    // Memory/queue limits
    MAX_PENDING_JOBS: 50,        // Matches CONFIG.maxPendingJobs in tile-prioritizer.js

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runTest() {
    console.log('=== Rapid Z Scrubbing Edge Case Test (5.3) ===\n');
    console.log('Tests: rapid Z scrubbing should not break heartbeat or cause memory issues\n');

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

        // Zoom in partway to create more tile demand
        console.log('\nZooming to 50% for tile demand...');
        await page.evaluate(() => {
            const viewer = document.getElementById('viewer').viewer;
            const maxZoom = viewer.viewport.getMaxZoom();
            viewer.viewport.zoomTo(maxZoom * 0.5);
        });
        await page.waitForTimeout(1000);

        // Get initial state
        const initialState = await page.evaluate(() => {
            const state = window.evostitch?.tilePrioritizer?.getState() || {};
            return {
                zCount: state.zCount,
                currentZ: state.currentZ,
                pendingJobs: state.pendingJobs,
                heartbeatActive: state.heartbeat?.active
            };
        });
        console.log(`Initial: Z=${initialState.currentZ}/${initialState.zCount}, pending=${initialState.pendingJobs}`);

        // Track max pending jobs and heartbeat states during scrubbing
        let maxPendingDuringScrub = 0;
        let heartbeatActiveCount = 0;
        let heartbeatInactiveCount = 0;
        let zChanges = 0;

        // Rapid Z scrubbing
        console.log(`\n=== RAPID Z SCRUBBING (${CONFIG.SCRUB_DURATION_MS / 1000}s at ${1000 / CONFIG.SCRUB_INTERVAL_MS} changes/sec) ===\n`);

        const scrubStart = Date.now();
        const zCount = initialState.zCount || 21;
        let direction = 1;
        let currentZ = initialState.currentZ || 0;

        while (Date.now() - scrubStart < CONFIG.SCRUB_DURATION_MS) {
            // Change Z
            currentZ += direction;
            if (currentZ >= zCount - 1) {
                currentZ = zCount - 1;
                direction = -1;
            } else if (currentZ <= 0) {
                currentZ = 0;
                direction = 1;
            }

            await page.evaluate((z) => {
                const slider = document.getElementById('z-slider');
                if (slider) {
                    slider.value = z;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, currentZ);
            zChanges++;

            // Sample state occasionally
            if (zChanges % 5 === 0) {
                const state = await page.evaluate(() => {
                    const s = window.evostitch?.tilePrioritizer?.getState() || {};
                    return {
                        pendingJobs: s.pendingJobs || 0,
                        heartbeatActive: s.heartbeat?.active || false
                    };
                });

                maxPendingDuringScrub = Math.max(maxPendingDuringScrub, state.pendingJobs);
                if (state.heartbeatActive) heartbeatActiveCount++;
                else heartbeatInactiveCount++;

                const elapsed = ((Date.now() - scrubStart) / 1000).toFixed(1);
                console.log(`[${elapsed}s] Z=${currentZ} pending=${state.pendingJobs} heartbeat=${state.heartbeatActive ? 'ON' : 'OFF'}`);
            }

            await page.waitForTimeout(CONFIG.SCRUB_INTERVAL_MS);
        }

        console.log(`\nScrubbing complete: ${zChanges} Z-changes in ${CONFIG.SCRUB_DURATION_MS / 1000}s`);
        console.log(`Max pending during scrub: ${maxPendingDuringScrub} (limit: ${CONFIG.MAX_PENDING_JOBS})`);

        // Now stop and let system settle
        console.log(`\n=== SETTLING (${CONFIG.SETTLE_AFTER_SCRUB_MS / 1000}s) ===\n`);

        const settleStart = Date.now();
        let maxPendingDuringSettle = 0;
        let settleHeartbeatStates = [];
        let queueDrained = false;
        let drainTime = null;

        while (Date.now() - settleStart < CONFIG.SETTLE_AFTER_SCRUB_MS) {
            const state = await page.evaluate(() => {
                const s = window.evostitch?.tilePrioritizer?.getState() || {};
                return {
                    pendingJobs: s.pendingJobs || 0,
                    heartbeatActive: s.heartbeat?.active || false,
                    currentZ: s.currentZ
                };
            });

            maxPendingDuringSettle = Math.max(maxPendingDuringSettle, state.pendingJobs);
            settleHeartbeatStates.push(state.heartbeatActive);

            const elapsed = ((Date.now() - settleStart) / 1000).toFixed(1);
            console.log(`[${elapsed}s] Z=${state.currentZ} pending=${state.pendingJobs} heartbeat=${state.heartbeatActive ? 'ON' : 'OFF'}`);

            // Track when queue drains
            if (!queueDrained && state.pendingJobs === 0) {
                queueDrained = true;
                drainTime = Date.now() - settleStart;
                console.log(`>>> Queue drained at ${(drainTime / 1000).toFixed(1)}s <<<`);
            }

            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        // Final state check
        const finalState = await page.evaluate(() => {
            const s = window.evostitch?.tilePrioritizer?.getState() || {};
            return {
                pendingJobs: s.pendingJobs || 0,
                heartbeatActive: s.heartbeat?.active || false,
                currentZ: s.currentZ,
                zVelocity: s.prefetch?.zVelocity || 0
            };
        });

        // Results
        console.log('\n=== Results ===\n');

        // Check 1: Queue never exceeded max limit
        const queueBounded = maxPendingDuringScrub <= CONFIG.MAX_PENDING_JOBS;
        console.log(`Queue bounded: ${queueBounded ? 'PASS' : 'FAIL'} (max=${maxPendingDuringScrub}, limit=${CONFIG.MAX_PENDING_JOBS})`);

        // Check 2: Heartbeat was active when needed (during scrubbing with pending jobs)
        const heartbeatWorked = heartbeatActiveCount > 0 || maxPendingDuringScrub === 0;
        console.log(`Heartbeat worked: ${heartbeatWorked ? 'PASS' : 'FAIL'} (active samples: ${heartbeatActiveCount})`);

        // Check 3: Queue drained after stopping
        console.log(`Queue drained: ${queueDrained ? 'PASS' : 'FAIL'} (final pending=${finalState.pendingJobs})`);

        // Check 4: Heartbeat stops when queue empty
        const heartbeatStoppedWhenEmpty = !finalState.heartbeatActive || finalState.pendingJobs > 0;
        console.log(`Heartbeat stops when empty: ${heartbeatStoppedWhenEmpty ? 'PASS' : 'FAIL'} (active=${finalState.heartbeatActive}, pending=${finalState.pendingJobs})`);

        // Check 5: Z-velocity info (not a pass/fail - velocity only updates on setCurrentZ calls)
        // High velocity after scrubbing is expected since no new Z-change occurred to reset it
        console.log(`Final velocity: ${finalState.zVelocity.toFixed(1)} planes/sec (informational)`);

        const success = queueBounded && heartbeatWorked && queueDrained && heartbeatStoppedWhenEmpty;

        if (success) {
            console.log('\n>>> PASS: Rapid Z scrubbing handled correctly <<<');
        } else {
            console.log('\n>>> FAIL: Rapid Z scrubbing exposed issues <<<');
        }

        return {
            success,
            zChanges,
            maxPendingDuringScrub,
            maxPendingDuringSettle,
            queueBounded,
            heartbeatWorked,
            queueDrained,
            drainTimeMs: drainTime,
            heartbeatStoppedWhenEmpty,
            finalVelocity: finalState.zVelocity
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
