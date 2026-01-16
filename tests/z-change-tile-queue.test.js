#!/usr/bin/env node
// Z-change tile queuing verification test (ralph loop step 3.1)
// Tests whether OSD queues tiles for the new Z-plane after setZPlane()
//
// Usage: node tests/z-change-tile-queue.test.js
//
// This test:
// 1. Opens a 3D mosaic
// 2. Zooms to maximum
// 3. Enables diagnostic logging
// 4. Changes Z-plane
// 5. Monitors addJob calls to see if tiles for the new Z-plane are queued
//
// Expected result: addJob calls should show tiles being queued with isCurrentZ: true

const { chromium } = require('playwright');

const CONFIG = {
    // 3D test mosaic
    MOSAIC_ID: 'SCH-55-22B_50xt_3D_test4_33x33x21',
    VIEWER_URL: process.env.VIEWER_URL || 'http://localhost:8080/viewer.html',

    // Test timing
    WAIT_FOR_VIEWER_MS: 30000,
    INITIAL_SETTLE_MS: 3000,
    POST_ZCHANGE_WAIT_MS: 5000,  // Time to wait after Z-change to collect addJob logs

    // Viewport
    VIEWPORT: { width: 1920, height: 1080 }
};

async function runZChangeTest() {
    console.log('=== Z-Change Tile Queuing Verification Test (3.1) ===\n');
    console.log(`Mosaic: ${CONFIG.MOSAIC_ID}`);
    console.log('');

    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({
            viewport: CONFIG.VIEWPORT
        });
        const page = await context.newPage();

        // Collect addJob diagnostic logs
        const addJobLogs = [];
        let zChangeTime = null;

        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[DIAG') && text.includes('addJob')) {
                const log = {
                    time: Date.now(),
                    message: text
                };
                addJobLogs.push(log);
                console.log('  ' + text);
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

        // Wait for zoom to settle and tiles to load
        console.log(`Waiting ${CONFIG.INITIAL_SETTLE_MS / 1000}s for viewport to settle...`);
        await page.waitForTimeout(CONFIG.INITIAL_SETTLE_MS);

        // Enable diagnostic logging AFTER zoom settles
        // This way we only capture addJob logs related to the Z-change
        console.log('\nEnabling diagnostic logging...');
        await page.evaluate(() => {
            if (window.evostitch && window.evostitch.tilePrioritizer) {
                window.evostitch.tilePrioritizer.setDiagnostic(true);
            }
        });

        // Clear any existing logs
        addJobLogs.length = 0;

        // Get current state before Z-change
        const beforeState = await page.evaluate(() => {
            const state = window.evostitch?.tilePrioritizer?.getState() || {};
            return {
                currentZ: state.currentZ,
                zCount: state.zCount,
                pendingJobs: state.pendingJobs
            };
        });
        console.log(`\nBefore Z-change: currentZ=${beforeState.currentZ}, zCount=${beforeState.zCount}`);

        // Change Z-plane
        const newZ = beforeState.currentZ + 1 < beforeState.zCount
            ? beforeState.currentZ + 1
            : beforeState.currentZ - 1;

        console.log(`\n=== CHANGING Z FROM ${beforeState.currentZ} TO ${newZ} ===\n`);
        zChangeTime = Date.now();

        await page.evaluate((targetZ) => {
            // Use the Z-slider to change Z (this triggers setZPlane in viewer.js)
            const slider = document.getElementById('z-slider');
            if (slider) {
                slider.value = targetZ;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, newZ);

        // Wait and collect addJob logs after Z-change
        console.log(`Waiting ${CONFIG.POST_ZCHANGE_WAIT_MS / 1000}s to collect addJob logs after Z-change...\n`);
        await page.waitForTimeout(CONFIG.POST_ZCHANGE_WAIT_MS);

        // Get state after Z-change
        const afterState = await page.evaluate(() => {
            const state = window.evostitch?.tilePrioritizer?.getState() || {};
            return {
                currentZ: state.currentZ,
                pendingJobs: state.pendingJobs,
                heartbeat: state.heartbeat
            };
        });
        console.log(`After Z-change: currentZ=${afterState.currentZ}, pendingJobs=${afterState.pendingJobs}`);

        // Analyze addJob logs after Z-change
        console.log('\n=== Analysis ===\n');

        const logsAfterZChange = addJobLogs.filter(log => log.time >= zChangeTime);
        console.log(`Total addJob calls after Z-change: ${logsAfterZChange.length}`);

        // Parse the logs to extract Z-plane info
        // Logs look like: [DIAG timestamp] addJob { zPlane: X, currentZ: Y, priority: Z, isCurrentZ: true/false }
        let tilesForNewZ = 0;
        let tilesForOtherZ = 0;

        for (const log of logsAfterZChange) {
            // Try to parse isCurrentZ from the log message
            if (log.message.includes('isCurrentZ: true') || log.message.includes('"isCurrentZ":true')) {
                tilesForNewZ++;
            } else {
                tilesForOtherZ++;
            }
        }

        console.log(`Tiles queued for NEW Z-plane (isCurrentZ: true): ${tilesForNewZ}`);
        console.log(`Tiles queued for OTHER Z-planes (isCurrentZ: false): ${tilesForOtherZ}`);

        // Determine result
        const result = {
            success: tilesForNewZ > 0,
            tilesQueuedForNewZ: tilesForNewZ,
            tilesQueuedForOtherZ: tilesForOtherZ,
            totalAddJobCalls: logsAfterZChange.length,
            zChanged: afterState.currentZ === newZ,
            heartbeatActive: afterState.heartbeat?.active
        };

        if (result.success) {
            console.log('\n>>> SUCCESS: OSD is queuing tiles for the new Z-plane <<<');
        } else if (logsAfterZChange.length === 0) {
            console.log('\n>>> ISSUE: No addJob calls after Z-change <<<');
            console.log('This means OSD is NOT requesting tiles for the new Z-plane.');
            console.log('Possible fix: force viewport update via viewer.forceRedraw() or tiledImage.update()');
        } else {
            console.log('\n>>> ISSUE: addJob calls found but none for current Z-plane <<<');
            console.log('This might indicate a priority bug (tiles not getting priority 1).');
        }

        return result;

    } finally {
        await browser.close();
    }
}

// Run the test
runZChangeTest()
    .then(result => {
        console.log('\n=== Test Complete ===');
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Test failed with error:', error);
        process.exit(2);
    });
