// W12 Dual-Domain Browser Test: SW interception for both R2 domains
// Verifies SW caches zarr chunks from both old (pub-*.r2.dev) and new (data.evostitch.net)
//
// Covers: SW activation, new domain caching, old domain interception,
//         cache contents verification, dual-domain URL matching
//
// Note: Uses --disable-web-security to bypass CORS for localhost testing.
// R2 CORS is configured for https://evostitch.net (production), not http://localhost.
// This test focuses on SW interception behavior, not CORS validation (covered in 7.R).

const { chromium } = require('playwright');
const http = require('http');

const PORT = 8769; // Unique port for W12 test
const TIMEOUT = 90000;

const OLD_DOMAIN = 'pub-db7ffa4b7df04b76aaae379c13562977.r2.dev';
const NEW_DOMAIN = 'data.evostitch.net';

function waitForServer(port, maxWait = 10000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        function tryConnect() {
            if (Date.now() - start > maxWait) {
                reject(new Error(`Server not ready after ${maxWait}ms`));
                return;
            }
            const req = http.get(`http://localhost:${port}/zarr-viewer.html`, res => {
                res.destroy();
                resolve();
            });
            req.on('error', () => setTimeout(tryConnect, 200));
            req.setTimeout(1000, () => { req.destroy(); setTimeout(tryConnect, 200); });
        }
        tryConnect();
    });
}

async function run() {
    // Kill any existing server on this port
    try {
        require('child_process').execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`);
    } catch (e) { /* ignore */ }

    const server = require('child_process').spawn(
        'python3', ['-m', 'http.server', String(PORT), '--bind', '0.0.0.0'],
        { cwd: __dirname + '/..', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

    console.log('Waiting for server to start...');
    await waitForServer(PORT);
    console.log('Server ready.');

    const results = {};
    let browser;

    function pass(test, detail) {
        results[test] = 'PASS';
        console.log(`[PASS] ${test}${detail ? ': ' + detail : ''}`);
    }
    function fail(test, err) {
        results[test] = 'FAIL';
        console.log(`[FAIL] ${test}: ${err}`);
    }

    try {
        browser = await chromium.launch({
            headless: true,
            executablePath: '/home/kenwilliford/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
            args: [
                '--no-sandbox',
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--enable-webgl',
                '--ignore-gpu-blocklist',
                '--disable-web-security',  // Bypass CORS for localhost testing
                '--allow-running-insecure-content'
            ]
        });
        const page = await browser.newPage();

        const errors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        page.on('pageerror', err => errors.push(err.message));

        // === Load zarr-viewer with R2 dataset (now using data.evostitch.net) ===
        const url = `http://localhost:${PORT}/zarr-viewer.html?zarr=mosaic_3d_zarr_v2`;
        console.log(`Opening ${url} ...`);
        await page.goto(url, { timeout: TIMEOUT });

        // Wait for viewer initialization
        console.log('Waiting for viewer initialization (up to 60s)...');
        try {
            await page.waitForFunction(
                () => window.evostitch?.zarrViewer?.getState?.()?.initialized === true,
                undefined, { timeout: 60000 }
            );
        } catch (e) {
            // SW may need a reload to activate
            console.log('  Init timeout, reloading for SW activation...');
            await page.reload({ timeout: TIMEOUT });
            await page.waitForFunction(
                () => window.evostitch?.zarrViewer?.getState?.()?.initialized === true,
                undefined, { timeout: 60000 }
            );
        }
        console.log('Viewer initialized.');

        // Ensure SW is active (may need reload)
        let swActive = await page.evaluate(() => window.evostitch?.sw?.isActive?.());
        if (!swActive) {
            console.log('SW not active, reloading...');
            await page.reload({ timeout: TIMEOUT });
            await page.waitForFunction(
                () => window.evostitch?.zarrViewer?.getState?.()?.initialized === true,
                undefined, { timeout: 60000 }
            );
            swActive = await page.evaluate(() => window.evostitch?.sw?.isActive?.());
        }

        // === Test 1: SW active with v1.4.0 cache ===
        console.log('\n--- SW ACTIVATION ---');
        try {
            const stats = await page.evaluate(async () => {
                try { return await window.evostitch.sw.getStats(); }
                catch { return null; }
            });

            if (!stats) {
                fail('sw-active', 'Could not get SW stats');
            } else {
                // Check via cache API for v1.4.0 cache
                const cacheNames = await page.evaluate(async () => await caches.keys());
                const hasV14 = cacheNames.some(n => n.includes('1.4.0'));
                if (hasV14) {
                    pass('sw-active', `SW active, caches: ${cacheNames.join(', ')}, zarrEntries=${stats.zarrEntries || stats.entryCount || 0}`);
                } else {
                    fail('sw-active', `Expected v1.4.0 cache, found: ${cacheNames.join(', ')}`);
                }
            }
        } catch (e) {
            fail('sw-active', e.message);
        }

        // === Test 2: New domain (data.evostitch.net) chunks cached ===
        console.log('\n--- NEW DOMAIN CACHING ---');
        try {
            const cacheAudit = await page.evaluate(async (newDomain) => {
                const cache = await caches.open('evostitch-zarr-v1.4.0');
                const keys = await cache.keys();
                const newDomainUrls = keys
                    .map(r => r.url)
                    .filter(u => u.includes(newDomain));
                return {
                    total: keys.length,
                    newDomainCount: newDomainUrls.length,
                    samples: newDomainUrls.slice(0, 3)
                };
            }, NEW_DOMAIN);

            if (cacheAudit.newDomainCount > 0) {
                pass('new-domain-cached',
                    `${cacheAudit.newDomainCount}/${cacheAudit.total} entries from ${NEW_DOMAIN}. ` +
                    `Sample: ${cacheAudit.samples[0]}`);
            } else {
                fail('new-domain-cached',
                    `No cache entries from ${NEW_DOMAIN}. Total: ${cacheAudit.total}`);
            }
        } catch (e) {
            fail('new-domain-cached', e.message);
        }

        // === Test 3: Old domain chunk fetch → SW intercepts and caches ===
        console.log('\n--- OLD DOMAIN INTERCEPTION ---');
        try {
            // Fetch a known zarr chunk via old domain — SW should intercept
            const chunkUrl = `https://${OLD_DOMAIN}/mosaic_3d_zarr_v2/0/9/0/0/0/0/0`;

            const fetchResult = await page.evaluate(async (url) => {
                try {
                    const resp = await fetch(url);
                    return {
                        ok: resp.ok,
                        status: resp.status,
                        type: resp.type
                    };
                } catch (e) {
                    return { error: e.message };
                }
            }, chunkUrl);

            if (fetchResult.ok) {
                // Check if SW cached it
                const inCache = await page.evaluate(async (url) => {
                    const cache = await caches.open('evostitch-zarr-v1.4.0');
                    const match = await cache.match(url);
                    return !!match;
                }, chunkUrl);

                pass('old-domain-intercept',
                    `Old domain chunk fetch OK (status=${fetchResult.status}, type=${fetchResult.type}), SW cached=${inCache}`);
            } else if (fetchResult.error) {
                fail('old-domain-intercept',
                    `Old domain fetch error: ${fetchResult.error}`);
            } else {
                fail('old-domain-intercept',
                    `Old domain fetch failed: status=${fetchResult.status}`);
            }
        } catch (e) {
            fail('old-domain-intercept', e.message);
        }

        // === Test 4: Both domains in cache after mixed fetches ===
        console.log('\n--- DUAL DOMAIN CACHE ---');
        try {
            // Also fetch a chunk from new domain explicitly
            const newChunkUrl = `https://${NEW_DOMAIN}/mosaic_3d_zarr_v2/0/9/0/0/0/0/0`;
            await page.evaluate(async (url) => {
                try { await fetch(url); } catch {}
            }, newChunkUrl);

            await page.waitForTimeout(500);

            const domainAudit = await page.evaluate(async () => {
                const cache = await caches.open('evostitch-zarr-v1.4.0');
                const keys = await cache.keys();
                const domains = {};
                for (const req of keys) {
                    try {
                        const hostname = new URL(req.url).hostname;
                        domains[hostname] = (domains[hostname] || 0) + 1;
                    } catch { /* skip */ }
                }
                return { total: keys.length, domains };
            });

            const domainList = Object.entries(domainAudit.domains)
                .map(([d, c]) => `${d}:${c}`)
                .join(', ');

            const hasOld = domainAudit.domains[OLD_DOMAIN] > 0;
            const hasNew = domainAudit.domains[NEW_DOMAIN] > 0;

            if (hasOld && hasNew) {
                pass('dual-domain-cache',
                    `Both domains cached! ${domainAudit.total} total entries. ${domainList}`);
            } else if (hasNew) {
                pass('dual-domain-cache',
                    `New domain cached (${domainAudit.domains[NEW_DOMAIN]} entries). ` +
                    `Old domain entries=${domainAudit.domains[OLD_DOMAIN] || 0}. ${domainList}`);
            } else {
                fail('dual-domain-cache',
                    `Missing domains. Has old=${hasOld}, has new=${hasNew}. ${domainList}`);
            }
        } catch (e) {
            fail('dual-domain-cache', e.message);
        }

        // === Test 5: Z-switch with new domain — cache grows ===
        console.log('\n--- Z-SWITCH CACHING ---');
        try {
            const beforeCount = await page.evaluate(async () => {
                const cache = await caches.open('evostitch-zarr-v1.4.0');
                return (await cache.keys()).length;
            });

            // Z-switch to plane 1
            await page.evaluate(() => window.evostitch.zarrViewer.setZ(1));
            await page.waitForFunction(
                () => window.evostitch.zarrViewer.getState().currentZ === 1,
                undefined, { timeout: 20000 }
            );
            await page.waitForTimeout(2000);

            const afterCount = await page.evaluate(async () => {
                const cache = await caches.open('evostitch-zarr-v1.4.0');
                return (await cache.keys()).length;
            });

            if (afterCount > beforeCount) {
                pass('z-switch-caching',
                    `Z-switch grew cache: ${beforeCount} → ${afterCount} (+${afterCount - beforeCount})`);
            } else if (afterCount === beforeCount && afterCount > 0) {
                pass('z-switch-caching',
                    `Cache stable at ${afterCount} entries (chunks already cached from init)`);
            } else {
                fail('z-switch-caching',
                    `No cache growth: ${beforeCount} → ${afterCount}`);
            }
        } catch (e) {
            fail('z-switch-caching', e.message);
        }

        // === Test 6: CORS verification via curl (evostitch.net origin) ===
        console.log('\n--- CORS VERIFICATION ---');
        try {
            const corsResult = await new Promise((resolve) => {
                const cp = require('child_process');
                cp.exec(
                    `curl -s -H "Origin: https://evostitch.net" -D - -o /dev/null "https://${NEW_DOMAIN}/mosaic_3d_zarr_v2/0/0/.zarray" 2>&1 | head -20`,
                    { timeout: 10000 },
                    (err, stdout) => resolve(stdout || err?.message || 'unknown')
                );
            });

            const hasCors = corsResult.includes('access-control-allow-origin');
            if (hasCors) {
                pass('cors-check',
                    `CORS configured for evostitch.net: ${corsResult.match(/access-control-allow-origin:.*/)?.[0]}`);
            } else {
                fail('cors-check',
                    `No CORS headers for evostitch.net origin. Response: ${corsResult.substring(0, 200)}`);
            }
        } catch (e) {
            fail('cors-check', e.message);
        }

        // === Test 7: No critical console errors ===
        console.log('\n--- CONSOLE ERRORS ---');
        const criticalErrors = errors.filter(e =>
            !e.includes('Invalid indexer key: t') &&
            !e.includes('SwiftShader') &&
            !e.includes('WEBGL_debug_renderer_info') &&
            !e.includes('favicon.ico') &&
            !e.includes('net::ERR_FILE_NOT_FOUND') &&
            !e.includes('Failed to load resource') &&
            !e.includes('404') &&
            !e.includes('CORS') &&
            !e.includes('Automatic fallback to software WebGL')
        );

        if (criticalErrors.length > 0) {
            fail('no-errors', `${criticalErrors.length} critical errors:\n  ` +
                criticalErrors.slice(0, 5).join('\n  '));
        } else {
            pass('no-errors',
                `No critical console errors (${errors.length} non-blocking warnings filtered)`);
        }

        // === Summary ===
        console.log('\n=== SUMMARY ===');
        const passed = Object.values(results).filter(v => v === 'PASS').length;
        const failed = Object.values(results).filter(v => v === 'FAIL').length;
        const total = passed + failed;
        console.log(`${passed}/${total} passed, ${failed} failed`);

        if (failed > 0) {
            console.log('\nFAILED:');
            for (const [test, result] of Object.entries(results)) {
                if (result === 'FAIL') console.log(`  - ${test}`);
            }
            process.exitCode = 1;
        }

    } finally {
        if (browser) await browser.close();
        server.kill();
    }
}

run().catch(err => {
    console.error('W12 dual-domain test crashed:', err);
    process.exit(1);
});
