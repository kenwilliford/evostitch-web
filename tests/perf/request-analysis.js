#!/usr/bin/env node
// Request pattern analysis for W3 Step 3.1
// Analyzes concurrent requests, HTTP/2 multiplexing, and request overhead

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

// Read metrics collector source to inject into browser
const metricsCollectorSource = fs.readFileSync(
    path.join(__dirname, 'metrics-collector.js'),
    'utf8'
);

/**
 * Extended metrics collector that captures request timing details
 */
function createRequestAnalysisCollector() {
    return `
    window.__requestAnalysis = {
        requests: [],

        captureRequestTimings: function() {
            // Get all resource timing entries - include jpeg/png tile files
            const entries = performance.getEntriesByType('resource')
                .filter(e => e.name.includes('/tiles/') || e.name.includes('.dzi') ||
                            e.name.includes('_files/') ||  // DZI tile path format
                            e.name.match(/\\/\\d+\\/\\d+_\\d+\\.jpe?g/i))  // Level/x_y.jpg
                .map(e => ({
                    url: e.name.split('/').slice(-4).join('/'),  // Last 4 path segments
                    fullUrl: e.name,
                    protocol: e.nextHopProtocol || 'unknown',
                    startTime: Math.round(e.startTime),
                    responseEnd: Math.round(e.responseEnd),
                    duration: Math.round(e.duration),
                    // Connection timing
                    dns: Math.round(e.domainLookupEnd - e.domainLookupStart),
                    tcp: Math.round(e.connectEnd - e.connectStart),
                    ssl: Math.round(e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : 0),
                    // Transfer timing
                    ttfb: Math.round(e.responseStart - e.requestStart),
                    download: Math.round(e.responseEnd - e.responseStart),
                    // Size
                    transferSize: e.transferSize || 0,
                    decodedSize: e.decodedBodySize || 0,
                    // Was request multiplexed?
                    wasReused: e.connectEnd === e.connectStart,
                    // Is this a tile (vs DZI metadata)?
                    isTile: e.name.match(/\\/\\d+\\/\\d+_\\d+\\.jpe?g/i) !== null
                }));

            this.requests = entries;
            return entries;
        },

        analyzePattern: function() {
            const entries = this.requests;
            if (entries.length === 0) return null;

            // 1. Protocol distribution
            const protocols = {};
            entries.forEach(e => {
                protocols[e.protocol] = (protocols[e.protocol] || 0) + 1;
            });

            // 2. Calculate concurrent requests over time
            // Build timeline of active requests
            const events = [];
            entries.forEach(e => {
                events.push({ time: e.startTime, type: 'start' });
                events.push({ time: e.responseEnd, type: 'end' });
            });
            events.sort((a, b) => a.time - b.time);

            let concurrent = 0;
            let maxConcurrent = 0;
            let concurrentHistory = [];
            events.forEach(e => {
                if (e.type === 'start') {
                    concurrent++;
                    maxConcurrent = Math.max(maxConcurrent, concurrent);
                } else {
                    concurrent--;
                }
                concurrentHistory.push({ time: e.time, concurrent });
            });

            // Average concurrent requests during active period
            let avgConcurrent = 0;
            if (concurrentHistory.length > 1) {
                let weightedSum = 0;
                let totalTime = 0;
                for (let i = 1; i < concurrentHistory.length; i++) {
                    const dt = concurrentHistory[i].time - concurrentHistory[i-1].time;
                    weightedSum += concurrentHistory[i-1].concurrent * dt;
                    totalTime += dt;
                }
                avgConcurrent = totalTime > 0 ? weightedSum / totalTime : 0;
            }

            // Separate tiles from metadata
            const tileRequests = entries.filter(e => e.isTile);
            const metaRequests = entries.filter(e => !e.isTile);

            // 3. Connection overhead vs transfer time (tiles only)
            const withTiming = tileRequests.filter(e => e.duration > 0);
            const avgTtfb = withTiming.length > 0
                ? withTiming.reduce((s, e) => s + e.ttfb, 0) / withTiming.length
                : 0;
            const avgDownload = withTiming.length > 0
                ? withTiming.reduce((s, e) => s + e.download, 0) / withTiming.length
                : 0;
            const avgDuration = withTiming.length > 0
                ? withTiming.reduce((s, e) => s + e.duration, 0) / withTiming.length
                : 0;

            // Connection reuse rate (indicates HTTP/2 multiplexing)
            const reusedCount = entries.filter(e => e.wasReused).length;
            const connectionReuseRate = entries.length > 0
                ? (reusedCount / entries.length) * 100
                : 0;

            // 4. Request overhead (TTFB includes queue wait + network latency)
            // For well-multiplexed requests, overhead should be low
            const requestOverhead = avgDuration > 0
                ? ((avgDuration - avgDownload) / avgDuration) * 100
                : 0;

            return {
                totalRequests: entries.length,
                tileRequests: tileRequests.length,
                metaRequests: metaRequests.length,
                protocols,
                concurrency: {
                    max: maxConcurrent,
                    avg: Math.round(avgConcurrent * 10) / 10
                },
                timing: {
                    avgTtfbMs: Math.round(avgTtfb),
                    avgDownloadMs: Math.round(avgDownload),
                    avgDurationMs: Math.round(avgDuration)
                },
                multiplexing: {
                    connectionReuseRate: Math.round(connectionReuseRate * 10) / 10,
                    requestOverheadPct: Math.round(requestOverhead * 10) / 10
                }
            };
        }
    };
    `;
}

/**
 * Analyze CDP-captured requests for accurate protocol and timing info
 */
function analyzeCdpRequests(responses) {
    if (responses.length === 0) return null;

    const tiles = responses.filter(r => r.isTile);
    const meta = responses.filter(r => !r.isTile);

    // Protocol distribution
    const protocols = {};
    tiles.forEach(r => {
        const proto = r.protocol || 'unknown';
        protocols[proto] = (protocols[proto] || 0) + 1;
    });

    // Service Worker interception rate
    const swIntercepted = tiles.filter(r => r.fromServiceWorker).length;
    const swRate = tiles.length > 0 ? (swIntercepted / tiles.length) * 100 : 0;

    // Connection reuse (same connectionId)
    const connectionIds = new Set(tiles.map(r => r.connectionId).filter(Boolean));
    const avgRequestsPerConnection = connectionIds.size > 0
        ? tiles.length / connectionIds.size
        : tiles.length;

    // Concurrent requests analysis
    const events = [];
    tiles.forEach(r => {
        if (r.startTime && r.endTime) {
            events.push({ time: r.startTime, type: 'start' });
            events.push({ time: r.endTime, type: 'end' });
        }
    });
    events.sort((a, b) => a.time - b.time);

    let concurrent = 0;
    let maxConcurrent = 0;
    let sumConcurrent = 0;
    let samples = 0;
    events.forEach(e => {
        if (e.type === 'start') {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
        } else {
            concurrent--;
        }
        sumConcurrent += concurrent;
        samples++;
    });
    const avgConcurrent = samples > 0 ? sumConcurrent / samples : 0;

    // Duration stats
    const durations = tiles.map(r => r.duration).filter(d => d > 0).sort((a, b) => a - b);
    const p50Duration = durations.length > 0
        ? durations[Math.floor(durations.length * 0.5)]
        : 0;
    const p95Duration = durations.length > 0
        ? durations[Math.floor(durations.length * 0.95)]
        : 0;
    const avgDuration = durations.length > 0
        ? durations.reduce((s, d) => s + d, 0) / durations.length
        : 0;

    return {
        totalRequests: responses.length,
        tileRequests: tiles.length,
        metaRequests: meta.length,
        protocols,
        serviceWorker: {
            intercepted: swIntercepted,
            rate: Math.round(swRate * 10) / 10
        },
        connections: {
            uniqueConnections: connectionIds.size,
            avgRequestsPerConnection: Math.round(avgRequestsPerConnection * 10) / 10
        },
        concurrency: {
            max: maxConcurrent,
            avg: Math.round(avgConcurrent * 10) / 10
        },
        timing: {
            avgDurationMs: Math.round(avgDuration),
            p50DurationMs: p50Duration,
            p95DurationMs: p95Duration
        }
    };
}

async function runAnalysis(options = {}) {
    const { network = 'unthrottled', mosaicId = CONFIG.TEST_MOSAIC } = options;

    console.log(`Analyzing request patterns for mosaic: ${mosaicId}`);
    console.log(`Network: ${network}`);
    console.log('');

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({
            viewport: CONFIG.VIEWPORTS['desktop']
        });

        const page = await context.newPage();

        // Set up CDP for network throttling and request tracking
        const cdpSession = await context.newCDPSession(page);
        await cdpSession.send('Network.enable');

        // Track requests via CDP for accurate protocol info
        const cdpRequests = new Map();
        const cdpResponses = [];

        cdpSession.on('Network.requestWillBeSent', (params) => {
            if (params.request.url.includes('_files/') || params.request.url.includes('.dzi')) {
                cdpRequests.set(params.requestId, {
                    requestId: params.requestId,
                    url: params.request.url,
                    startTime: params.timestamp * 1000,  // Convert to ms
                    isTile: params.request.url.match(/\/\d+\/\d+_\d+\.jpe?g/i) !== null
                });
            }
        });

        cdpSession.on('Network.responseReceived', (params) => {
            const req = cdpRequests.get(params.requestId);
            if (req) {
                req.protocol = params.response.protocol || 'unknown';
                req.status = params.response.status;
                req.fromServiceWorker = params.response.fromServiceWorker || false;
                req.connectionId = params.response.connectionId;
            }
        });

        cdpSession.on('Network.loadingFinished', (params) => {
            const req = cdpRequests.get(params.requestId);
            if (req) {
                req.endTime = params.timestamp * 1000;
                req.duration = Math.round(req.endTime - req.startTime);
                req.encodedDataLength = params.encodedDataLength;
                cdpResponses.push(req);
            }
        });

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

        // Inject metrics collectors
        await page.addInitScript(metricsCollectorSource + `
            window.__perfMetrics = createMetricsCollector();
        `);
        await page.addInitScript(createRequestAnalysisCollector());

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

        // Wait for viewer to be ready
        await page.waitForFunction(() => {
            const container = document.getElementById('viewer');
            return container && container.viewer && container.viewer.world;
        }, { timeout: 30000 });

        // Wait for initial viewport to load
        console.log('Waiting for initial viewport to load...');
        await page.waitForTimeout(3000);

        // Do a zoom operation to load higher resolution tiles
        console.log('Zooming to load tiles...');
        const viewerEl = await page.$('#viewer');
        const box = await viewerEl.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -200);  // Zoom in
        await page.waitForTimeout(2000);

        // Do a pan operation to trigger more tile loads
        console.log('Panning to load more tiles...');
        await page.mouse.move(960, 540);
        await page.mouse.down();
        await page.mouse.move(600, 300, { steps: 10 });
        await page.mouse.up();

        // Wait for tiles to load after pan
        await page.waitForTimeout(3000);

        // Zoom in more to get higher resolution tiles
        console.log('Zooming in further...');
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(3000);

        // Capture request timings
        const analysis = await page.evaluate(() => {
            window.__requestAnalysis.captureRequestTimings();
            return window.__requestAnalysis.analyzePattern();
        });

        // Get raw request data for detailed analysis
        const rawRequests = await page.evaluate(() => {
            return window.__requestAnalysis.requests;
        });

        // Get performance metrics from collector
        const metrics = await page.evaluate(() => {
            if (window.__perfMetrics) {
                window.__perfMetrics.forceViewportComplete();
                return window.__perfMetrics.getResults();
            }
            return null;
        });

        // Analyze CDP-captured requests for accurate protocol info
        const cdpAnalysis = analyzeCdpRequests(cdpResponses);

        return {
            analysis,
            cdpAnalysis,
            rawRequests: rawRequests.slice(0, 20),  // Sample for report
            cdpSample: cdpResponses.filter(r => r.isTile).slice(0, 10),
            metrics: metrics ? {
                totalTilesLoaded: metrics.totalTilesLoaded,
                p50TileLoad: metrics.p50TileLoad,
                p95TileLoad: metrics.p95TileLoad
            } : null
        };

    } finally {
        await browser.close();
    }
}

async function main() {
    const args = process.argv.slice(2);
    const networkArg = args.find(a => a.startsWith('--network='));
    const network = networkArg ? networkArg.split('=')[1] : 'unthrottled';

    try {
        console.log('=== W3 Step 3.1: Request Pattern Analysis ===\n');

        const result = await runAnalysis({ network });

        if (!result.analysis) {
            console.log('ERROR: No request data captured');
            process.exit(1);
        }

        const a = result.analysis;
        console.log('\n=== Analysis Results ===\n');

        // 1. Request count
        console.log(`1. Total requests: ${a.totalRequests}`);
        console.log(`   - Tile requests: ${a.tileRequests}`);
        console.log(`   - Metadata requests: ${a.metaRequests}`);
        console.log('');

        // 2. Protocol distribution
        console.log('2. Protocol distribution:');
        for (const [proto, count] of Object.entries(a.protocols)) {
            const pct = ((count / a.totalRequests) * 100).toFixed(1);
            console.log(`   ${proto}: ${count} requests (${pct}%)`);
        }
        console.log('');

        // 3. Concurrency
        console.log('3. Concurrent requests during load:');
        console.log(`   Max concurrent: ${a.concurrency.max}`);
        console.log(`   Avg concurrent: ${a.concurrency.avg}`);
        console.log('');

        // 4. Request timing breakdown
        console.log('4. Request timing breakdown (avg):');
        console.log(`   TTFB (Time to First Byte): ${a.timing.avgTtfbMs}ms`);
        console.log(`   Download time: ${a.timing.avgDownloadMs}ms`);
        console.log(`   Total duration: ${a.timing.avgDurationMs}ms`);
        console.log('');

        // 5. HTTP/2 multiplexing effectiveness
        console.log('5. HTTP/2 multiplexing effectiveness:');
        console.log(`   Connection reuse rate: ${a.multiplexing.connectionReuseRate}%`);
        console.log(`   Request overhead: ${a.multiplexing.requestOverheadPct}%`);
        console.log('');

        // 6. Interpretation
        console.log('6. Interpretation:');

        // Check if HTTP/2 is being used
        const isHttp2 = a.protocols['h2'] > 0;
        if (isHttp2) {
            const h2Pct = ((a.protocols['h2'] / a.totalRequests) * 100).toFixed(1);
            console.log(`   ✓ HTTP/2 in use (${h2Pct}% of requests)`);
        } else {
            console.log('   ✗ HTTP/2 NOT detected - requests using HTTP/1.1');
        }

        // Evaluate multiplexing
        if (a.multiplexing.connectionReuseRate > 90) {
            console.log('   ✓ Excellent connection reuse - HTTP/2 multiplexing effective');
        } else if (a.multiplexing.connectionReuseRate > 70) {
            console.log('   ~ Good connection reuse - multiplexing mostly effective');
        } else {
            console.log('   ✗ Low connection reuse - may indicate HTTP/1.1 or connection issues');
        }

        // Evaluate overhead
        if (a.multiplexing.requestOverheadPct < 50) {
            console.log(`   ✓ Low request overhead (${a.multiplexing.requestOverheadPct}%) - batching unlikely to help`);
        } else {
            console.log(`   ~ High request overhead (${a.multiplexing.requestOverheadPct}%) - batching may help`);
        }

        // Evaluate concurrency
        if (a.concurrency.max > 10) {
            console.log(`   ✓ High concurrency (max ${a.concurrency.max}) - parallel loading effective`);
        } else {
            console.log(`   ~ Limited concurrency (max ${a.concurrency.max}) - may be bottlenecked`);
        }

        // CDP Analysis (more accurate)
        const cdp = result.cdpAnalysis;
        if (cdp) {
            console.log('\n=== CDP Network Analysis (Accurate) ===\n');

            console.log(`1. Request counts: ${cdp.tileRequests} tiles, ${cdp.metaRequests} metadata`);
            console.log('');

            console.log('2. Protocol distribution:');
            for (const [proto, count] of Object.entries(cdp.protocols)) {
                const pct = ((count / cdp.tileRequests) * 100).toFixed(1);
                console.log(`   ${proto}: ${count} requests (${pct}%)`);
            }
            console.log('');

            console.log('3. Service Worker interception:');
            console.log(`   Intercepted: ${cdp.serviceWorker.intercepted} (${cdp.serviceWorker.rate}%)`);
            console.log('');

            console.log('4. Connection analysis:');
            console.log(`   Unique connections: ${cdp.connections.uniqueConnections}`);
            console.log(`   Avg requests/connection: ${cdp.connections.avgRequestsPerConnection}`);
            console.log('');

            console.log('5. Concurrent requests:');
            console.log(`   Max concurrent: ${cdp.concurrency.max}`);
            console.log(`   Avg concurrent: ${cdp.concurrency.avg}`);
            console.log('');

            console.log('6. Request duration:');
            console.log(`   Avg: ${cdp.timing.avgDurationMs}ms`);
            console.log(`   p50: ${cdp.timing.p50DurationMs}ms`);
            console.log(`   p95: ${cdp.timing.p95DurationMs}ms`);
            console.log('');

            // Conclusions
            console.log('=== Conclusions ===\n');

            // Check HTTP/2
            const isHttp2Cdp = cdp.protocols['h2'] > 0 || cdp.protocols['http/2'] > 0;
            if (isHttp2Cdp) {
                console.log('✓ HTTP/2 is being used - multiplexing enabled');
            } else {
                const hasH1 = cdp.protocols['http/1.1'] > 0;
                if (hasH1) {
                    console.log('✗ HTTP/1.1 detected - consider HTTP/2 for better multiplexing');
                } else {
                    console.log('? Protocol unclear (may be served from SW cache)');
                }
            }

            // Evaluate connection efficiency
            if (cdp.connections.avgRequestsPerConnection > 20) {
                console.log('✓ Excellent connection reuse - HTTP/2 multiplexing working well');
            } else if (cdp.connections.avgRequestsPerConnection > 5) {
                console.log('~ Good connection reuse');
            } else {
                console.log('✗ Low connection reuse - may benefit from batching');
            }

            // Evaluate concurrency
            if (cdp.concurrency.max >= 20) {
                console.log('✓ High concurrency achieved - parallel loading effective');
            } else if (cdp.concurrency.max >= 6) {
                console.log('~ Moderate concurrency - HTTP/2 should allow more');
            } else {
                console.log('✗ Low concurrency - may be bottlenecked');
            }

            // Batching recommendation
            console.log('');
            console.log('Batching recommendation:');
            if (isHttp2Cdp && cdp.connections.avgRequestsPerConnection > 10 && cdp.concurrency.max >= 10) {
                console.log('  HTTP/2 multiplexing is handling concurrent requests well.');
                console.log('  Request batching is UNLIKELY to provide significant benefit.');
                console.log('  Recommendation: SKIP W3 batching implementation.');
            } else {
                console.log('  Request batching MAY provide benefit.');
                console.log('  Consider implementing connection pooling or request coalescing.');
            }
        }

        // Output JSON
        const outputPath = path.join(__dirname, '..', '..', 'docs', 'request-analysis.json');
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        console.log(`\nRaw data saved to: ${outputPath}`);

        // Return exit code based on HTTP/2 availability
        process.exit(0);

    } catch (error) {
        console.error('Analysis failed:', error);
        process.exit(1);
    }
}

main();
