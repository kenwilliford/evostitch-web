#!/usr/bin/env node
// Performance test harness - runs test matrix and outputs JSON results

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');
const { runScenario, runAllScenarios } = require('./scenarios');

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

/**
 * Run scenario-based tests with network throttling
 * Scenarios exercise realistic usage patterns (A, B, C)
 */
async function runScenarioTests(options = {}) {
    const { scenario = 'all', quick = false } = options;
    const mosaicId = CONFIG.TEST_MOSAIC;

    const results = {
        timestamp: new Date().toISOString(),
        mosaic: mosaicId,
        testType: 'scenario',
        scenarios: []
    };

    // Determine which scenarios to run
    const scenariosToRun = scenario.toUpperCase() === 'ALL'
        ? ['A', 'B', 'C']
        : [scenario.toUpperCase()];

    // Network conditions to test
    let networks = Object.keys(CONFIG.NETWORK_PROFILES);
    if (quick) {
        networks = ['unthrottled', 'fast-3g'];
    }

    console.log(`Running scenario tests on mosaic: ${mosaicId}`);
    console.log(`Scenarios: ${scenariosToRun.join(', ')}`);
    console.log(`Networks: ${networks.join(', ')}`);
    console.log('');

    for (const scenarioName of scenariosToRun) {
        console.log(`Scenario ${scenarioName}:`);

        for (const network of networks) {
            console.log(`  Network: ${network}`);

            const browser = await chromium.launch({ headless: true });
            try {
                const context = await browser.newContext({
                    viewport: CONFIG.VIEWPORTS['desktop']
                });

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
                    const checkViewer = setInterval(() => {
                        if (window.OpenSeadragon && document.querySelector('.openseadragon-container')) {
                            const container = document.getElementById('viewer');
                            if (container && container.viewer) {
                                window.__perfMetrics.attachToViewer(container.viewer);
                                clearInterval(checkViewer);
                            }
                        }
                    }, 100);
                `);

                await page.goto(url, { waitUntil: 'domcontentloaded' });

                // Wait for viewer to be ready before running scenario
                await page.waitForFunction(() => {
                    const container = document.getElementById('viewer');
                    return container && container.viewer && container.viewer.world;
                }, { timeout: 30000 });

                // Run the scenario
                const scenarioResult = await runScenario(page, scenarioName);

                // Get final metrics from collector
                const collectorMetrics = await page.evaluate(() => {
                    return window.__perfMetrics ? window.__perfMetrics.getResults() : null;
                });

                results.scenarios.push({
                    scenario: scenarioName,
                    network,
                    result: scenarioResult,
                    metrics: collectorMetrics ? {
                        totalTilesLoaded: collectorMetrics.totalTilesLoaded,
                        cacheHitRate: collectorMetrics.cacheHitRate,
                        zTransitionP50: collectorMetrics.zTransitionP50,
                        zTransitionP95: collectorMetrics.zTransitionP95,
                        p50TileLoad: collectorMetrics.p50TileLoad,
                        p95TileLoad: collectorMetrics.p95TileLoad
                    } : null
                });

                // Log summary
                const summary = scenarioResult.summary;
                console.log(`    -> ${scenarioResult.name}: ` +
                    (summary.avgZTransitionMs ? `Z-trans avg: ${Math.round(summary.avgZTransitionMs)}ms, ` : '') +
                    (summary.cacheHitRate !== undefined ? `Cache hit: ${summary.cacheHitRate.toFixed(1)}%, ` : '') +
                    `Total tiles: ${collectorMetrics?.totalTilesLoaded || 0}`);

            } catch (error) {
                console.error(`    -> ERROR: ${error.message}`);
                results.scenarios.push({
                    scenario: scenarioName,
                    network,
                    error: error.message
                });
            } finally {
                await browser.close();
            }
        }
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const quick = args.includes('--quick');

    // Parse --scenario flag (A, B, C, or "all")
    const scenarioIndex = args.indexOf('--scenario');
    const scenario = scenarioIndex !== -1 && args[scenarioIndex + 1]
        ? args[scenarioIndex + 1]
        : null;

    try {
        let results;
        let outputFilename;

        if (scenario) {
            // Run scenario-based tests
            const validScenarios = ['A', 'B', 'C', 'ALL'];
            const scenarioUpper = scenario.toUpperCase();
            if (!validScenarios.includes(scenarioUpper)) {
                console.error(`Invalid scenario: ${scenario}. Valid options: A, B, C, all`);
                process.exit(1);
            }

            results = await runScenarioTests({ scenario: scenarioUpper, quick });
            outputFilename = 'performance-scenarios.json';
        } else {
            // Run traditional matrix tests
            results = await runTestMatrix({ quick });
            outputFilename = CONFIG.BASELINE_JSON;
        }

        // Output JSON to stdout
        console.log('\n--- Results JSON ---');
        console.log(JSON.stringify(results, null, 2));

        // Also save to file
        const outputPath = path.join(
            __dirname, '..', '..', 'docs',
            outputFilename
        );
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`\nResults saved to: ${outputPath}`);

    } catch (error) {
        console.error('Harness failed:', error);
        process.exit(1);
    }
}

main();
