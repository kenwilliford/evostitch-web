#!/usr/bin/env node
// Performance test harness - runs test matrix and outputs JSON results

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

// Read metrics collector source to inject into browser
const metricsCollectorSource = fs.readFileSync(
    path.join(__dirname, 'metrics-collector.js'),
    'utf8'
);

async function runTest(options) {
    const { network, cache, viewport, mosaicId } = options;

    console.log(`  Running: network=${network}, cache=${cache}, viewport=${viewport}`);

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            viewport: CONFIG.VIEWPORTS[viewport]
        });

        // Clear cache for cold runs
        if (cache === 'cold') {
            await context.clearCookies();
            // Note: Playwright context is fresh, so cache is already cold
        }

        const page = await context.newPage();

        // Set up CDP for network throttling
        const cdpSession = await context.newCDPSession(page);
        await cdpSession.send('Network.enable');

        const networkProfile = CONFIG.NETWORK_PROFILES[network];
        if (networkProfile) {
            await cdpSession.send('Network.emulateNetworkConditions', {
                offline: false,
                downloadThroughput: networkProfile.downloadThroughput,
                uploadThroughput: networkProfile.uploadThroughput,
                latency: networkProfile.latency
            });
        }

        // Navigate to viewer
        const url = `${CONFIG.VIEWER_BASE_URL}?mosaic=${mosaicId}`;

        // Inject metrics collector before page loads
        await page.addInitScript(metricsCollectorSource + `
            window.__perfMetrics = createMetricsCollector();
        `);

        // Hook into viewer initialization
        await page.addInitScript(`
            // Wait for OpenSeadragon viewer to be created, then attach
            const checkViewer = setInterval(() => {
                if (window.OpenSeadragon && document.querySelector('.openseadragon-container')) {
                    // Find the viewer instance
                    const container = document.getElementById('viewer');
                    if (container && container.viewer) {
                        window.__perfMetrics.attachToViewer(container.viewer);
                        clearInterval(checkViewer);
                    }
                }
            }, 100);
        `);

        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait for viewer to initialize and tiles to load
        const startTime = Date.now();
        let viewportComplete = false;

        while (!viewportComplete && (Date.now() - startTime) < CONFIG.VIEWPORT_COMPLETE_TIMEOUT_MS) {
            await page.waitForTimeout(500);

            viewportComplete = await page.evaluate(() => {
                if (window.__perfMetrics) {
                    window.__perfMetrics.checkViewportComplete();
                    return window.__perfMetrics.isViewportComplete();
                }
                return false;
            });
        }

        // Force completion if timeout
        await page.evaluate(() => {
            if (window.__perfMetrics) {
                window.__perfMetrics.forceViewportComplete();
            }
        });

        // Collect metrics
        const metrics = await page.evaluate(() => {
            return window.__perfMetrics ? window.__perfMetrics.getResults() : null;
        });

        if (!metrics) {
            throw new Error('Failed to collect metrics');
        }

        // Return without raw tileLoads for JSON output
        const { tileLoads, ...summaryMetrics } = metrics;
        return summaryMetrics;
    } finally {
        await browser.close();
    }
}

async function warmCache(mosaicId) {
    // Note: Warm cache tests have a known limitation - each Playwright browser
    // context has isolated cache, so warming in one browser doesn't help the
    // test browser. Results for 'warm' cache may not reflect actual warm cache
    // performance. A future enhancement could share browser context between
    // warmCache() and runTest().
    console.log('  Warming cache... (Note: limited accuracy due to browser isolation)');

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            viewport: CONFIG.VIEWPORTS['desktop']
        });
        const page = await context.newPage();

        const url = `${CONFIG.VIEWER_BASE_URL}?mosaic=${mosaicId}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(5000);  // Let tiles load
    } finally {
        await browser.close();
    }
}

async function runTestMatrix(options = {}) {
    const { quick = false } = options;
    const mosaicId = CONFIG.TEST_MOSAIC;

    const results = {
        timestamp: new Date().toISOString(),
        mosaic: mosaicId,
        conditions: []
    };

    // Define test matrix
    let networks = Object.keys(CONFIG.NETWORK_PROFILES);
    let viewports = Object.keys(CONFIG.VIEWPORTS);
    let cacheStates = CONFIG.CACHE_STATES;

    // Quick mode: reduced matrix
    if (quick) {
        networks = ['unthrottled', 'fast-3g'];
        viewports = ['desktop'];
        cacheStates = ['cold'];
    }

    console.log(`Running performance tests on mosaic: ${mosaicId}`);
    console.log(`Matrix: ${networks.length} networks x ${viewports.length} viewports x ${cacheStates.length} cache states`);
    console.log('');

    for (const viewport of viewports) {
        for (const network of networks) {
            for (const cache of cacheStates) {
                // For warm cache tests, we need to warm first
                if (cache === 'warm') {
                    await warmCache(mosaicId);
                }

                try {
                    const metrics = await runTest({
                        network,
                        cache,
                        viewport,
                        mosaicId
                    });

                    results.conditions.push({
                        conditions: { network, cache, viewport },
                        metrics
                    });

                    console.log(`    -> First tile: ${metrics.timeToFirstTile}ms, Viewport: ${metrics.timeToViewportComplete}ms, p50: ${metrics.p50TileLoad}ms`);
                } catch (error) {
                    console.error(`    -> ERROR: ${error.message}`);
                    results.conditions.push({
                        conditions: { network, cache, viewport },
                        error: error.message
                    });
                }
            }
        }
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const quick = args.includes('--quick');

    try {
        const results = await runTestMatrix({ quick });

        // Output JSON to stdout
        console.log('\n--- Results JSON ---');
        console.log(JSON.stringify(results, null, 2));

        // Also save to file
        const outputPath = path.join(
            __dirname, '..', '..', 'docs',
            CONFIG.BASELINE_JSON
        );
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`\nResults saved to: ${outputPath}`);

    } catch (error) {
        console.error('Harness failed:', error);
        process.exit(1);
    }
}

main();
