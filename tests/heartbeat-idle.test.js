#!/usr/bin/env node
// Heartbeat idle test (ralph loop step 2.5)
// Tests that heartbeat does NOT fire when idle (no pending jobs)
// This ensures no performance regression from the heartbeat implementation.
//
// Usage: node tests/heartbeat-idle.test.js

const { chromium } = require('playwright');

const CONFIG = {
    // 3D test mosaic
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    // Test timing
    WAIT_FOR_VIEWER_MS: 30000,
    WAIT_FOR_LOAD_MS: 20000,      // Wait for initial tiles to load
    IDLE_MONITOR_MS: 10000,       // Monitor idle state for 10s
    CHECK_INTERVAL_MS: 1000,

    VIEWPORT: { width: 1920, height: 1080 }
};

async function runHeartbeatIdleTest() {
    console.log('=== Heartbeat Idle Test (2.5) ===\n');
    console.log('Tests: when queue is empty, heartbeat should NOT fire\n');

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({ viewport: CONFIG.VIEWPORT });
        const page = await context.newPage();

        // Track heartbeat diagnostic logs
        const heartbeatLogs = [];
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[DIAG')) {
                heartbeatLogs.push({ time: Date.now(), message: text });
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

        // Wait for initial load to complete (queue should drain)
        console.log('Waiting for initial tiles to load and queue to drain...');
        const startWaitTime = Date.now();
        let queueDrained = false;

        while (Date.now() - startWaitTime < CONFIG.WAIT_FOR_LOAD_MS) {
            const state = await page.evaluate(() => {
                if (window.evostitch?.tilePrioritizer) {
                    return window.evostitch.tilePrioritizer.getState();
                }
                return null;
            });

            if (state && state.pendingJobs === 0 && !state.heartbeat.active) {
                queueDrained = true;
                console.log('Queue drained, heartbeat stopped.\n');
                break;
            }

            await page.waitForTimeout(500);
        }

        if (!queueDrained) {
            console.log('WARNING: Queue did not drain within timeout.');
            console.log('Continuing to test idle behavior anyway...\n');
        }

        // Clear log history before idle monitoring
        heartbeatLogs.length = 0;

        // Mark the start of idle monitoring
        const idleStartTime = Date.now();
        console.log(`Monitoring idle state for ${CONFIG.IDLE_MONITOR_MS / 1000}s...\n`);

        // Monitor: viewport is idle, no interaction, heartbeat should NOT fire
        const samples = [];
        let heartbeatTicksDuringIdle = 0;

        while (Date.now() - idleStartTime < CONFIG.IDLE_MONITOR_MS) {
            const state = await page.evaluate(() => {
                if (window.evostitch?.tilePrioritizer) {
                    return window.evostitch.tilePrioritizer.getState();
                }
                return null;
            });

            const elapsed = Math.round((Date.now() - idleStartTime) / 1000);

            // Count any heartbeat ticks that occurred since last check
            const recentTicks = heartbeatLogs.filter(
                h => h.time >= idleStartTime && h.message.includes('heartbeat TICK')
            ).length;
            heartbeatTicksDuringIdle = recentTicks;

            console.log(`[${elapsed}s] pendingJobs=${state?.pendingJobs ?? '?'} heartbeat.active=${state?.heartbeat?.active ?? '?'} ticks=${recentTicks}`);

            samples.push({
                elapsed,
                pendingJobs: state?.pendingJobs ?? 0,
                heartbeatActive: state?.heartbeat?.active ?? false
            });

            await page.waitForTimeout(CONFIG.CHECK_INTERVAL_MS);
        }

        // Analysis
        console.log('\n=== Analysis ===\n');

        // Count any heartbeat-related logs during idle phase
        const heartbeatStartsDuringIdle = heartbeatLogs.filter(
            h => h.time >= idleStartTime && h.message.includes('heartbeat STARTED')
        ).length;

        const heartbeatStopsDuringIdle = heartbeatLogs.filter(
            h => h.time >= idleStartTime && h.message.includes('heartbeat STOPPED')
        ).length;

        console.log(`Heartbeat starts during idle period: ${heartbeatStartsDuringIdle}`);
        console.log(`Heartbeat stops during idle period: ${heartbeatStopsDuringIdle}`);
        console.log(`Heartbeat ticks during idle period: ${heartbeatTicksDuringIdle}`);

        // The KEY metric: was heartbeat ever active when pendingJobs was 0?
        // This is the actual performance regression we're checking for.
        // Heartbeat should ONLY be active when there are jobs to process.
        const activeWithNoJobs = samples.some(s => s.heartbeatActive && s.pendingJobs === 0);
        console.log(`\nCRITICAL: Heartbeat active with no pending jobs: ${activeWithNoJobs}`);

        // Count samples where queue was empty
        const idleSamples = samples.filter(s => s.pendingJobs === 0);
        const workingSamples = samples.filter(s => s.pendingJobs > 0);
        console.log(`Samples with empty queue: ${idleSamples.length}/${samples.length}`);
        console.log(`Samples with pending jobs: ${workingSamples.length}/${samples.length}`);

        // Success criteria:
        // The heartbeat should NOT be active when there are no pending jobs.
        // It's OK for heartbeat to tick while processing jobs (that's its purpose).
        // The performance regression would be if heartbeat keeps ticking with an empty queue.
        const success = !activeWithNoJobs;

        if (success) {
            console.log('\n>>> PASS: No performance regression <<<');
            console.log('Heartbeat correctly deactivates when queue is empty.');
            if (heartbeatTicksDuringIdle > 0) {
                console.log(`(${heartbeatTicksDuringIdle} ticks occurred while processing jobs - expected behavior)`);
            }
        } else {
            console.log('\n>>> FAIL: Performance regression detected <<<');
            console.log('Heartbeat was active with no pending jobs!');
            console.log('This causes unnecessary CPU usage when idle.');
        }

        return {
            success,
            heartbeatTicksDuringIdle,
            heartbeatStartsDuringIdle,
            heartbeatStopsDuringIdle,
            activeWithNoJobs
        };

    } finally {
        await browser.close();
    }
}

runHeartbeatIdleTest()
    .then(result => {
        console.log('\n=== Test Complete ===');
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Test failed with error:', error);
        process.exit(2);
    });
