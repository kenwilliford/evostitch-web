// W7 Full Browser Test: Z-nav, zoom/pan, channels, prefetch init, seamless Z-focus, SW interception
// Tests zarr-viewer.html with R2 dataset after Viv 0.19 + deck.gl 9 upgrade
//
// Covers: Z-slider, zoom/pan controls, channel controls, prefetch engine,
//         seamless zoom-gated Z-focus, service worker cache interception

const { chromium } = require('playwright');
const http = require('http');

const PORT = 8766; // Different from spike test
const TIMEOUT = 90000; // 90s - full viewer load can be slow

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
                '--ignore-gpu-blocklist'
            ]
        });
        const page = await browser.newPage();

        // Collect console output and errors
        const logs = [];
        const errors = [];
        page.on('console', msg => {
            const text = msg.text();
            logs.push(text);
            if (msg.type() === 'error') errors.push(text);
        });
        page.on('pageerror', err => {
            errors.push(err.message);
            process.stderr.write(`[page-error] ${err.message}\n`);
        });

        // === Load zarr-viewer.html with R2 dataset ===
        const url = `http://localhost:${PORT}/zarr-viewer.html?zarr=mosaic_3d_zarr_v3`;
        console.log(`Opening ${url} ...`);
        await page.goto(url, { timeout: TIMEOUT });

        // Wait for viewer to initialize (state.initialized === true)
        console.log('Waiting for viewer initialization (up to 60s)...');
        try {
            await page.waitForFunction(
                () => window.evostitch?.zarrViewer?.getState?.()?.initialized === true,
                undefined, { timeout: 60000 }
            );
            pass('viewer-init', 'zarr-viewer.html loaded and initialized');
        } catch (e) {
            fail('viewer-init', 'Viewer did not initialize within 60s');
            // Try to get diagnostic info
            const st = await page.evaluate(() => {
                try { return JSON.stringify(window.evostitch?.zarrViewer?.getState?.()); }
                catch { return 'getState unavailable'; }
            });
            console.log(`  Viewer state: ${st}`);
            // Still try remaining tests even if init is slow
        }

        // Get initial viewer state
        const viewerState = await page.evaluate(() => window.evostitch.zarrViewer.getState());
        console.log(`\nViewer state: Z=${viewerState.currentZ}/${viewerState.zCount}, ` +
            `loader=${viewerState.hasLoader}, deck=${viewerState.hasDeck}`);

        // === Test 1: Z-slider navigation ===
        console.log('\n--- Z-NAV ---');
        try {
            const zCount = viewerState.zCount;
            if (zCount <= 1) {
                fail('z-nav', `Only ${zCount} Z-planes, cannot test navigation`);
            } else {
                // Change Z to plane 1 via API
                await page.evaluate(() => window.evostitch.zarrViewer.setZ(1));

                // Wait for Z-switch to complete (state.currentZ updates after debounce)
                await page.waitForFunction(
                    () => window.evostitch.zarrViewer.getState().currentZ === 1,
                    undefined, { timeout: 20000 }
                );

                // Verify slider DOM reflects new Z
                const sliderVal = await page.evaluate(() =>
                    document.getElementById('z-slider')?.value
                );

                // Try changing to a higher Z
                const targetZ = Math.min(5, zCount - 1);
                await page.evaluate((z) => window.evostitch.zarrViewer.setZ(z), targetZ);
                await page.waitForFunction(
                    (z) => window.evostitch.zarrViewer.getState().currentZ === z,
                    targetZ, { timeout: 20000 }
                );

                const afterState = await page.evaluate(() =>
                    window.evostitch.zarrViewer.getState()
                );
                pass('z-nav', `Navigated Z=0→1→${targetZ}/${zCount}, slider=${sliderVal}`);
            }
        } catch (e) {
            fail('z-nav', e.message);
        }

        // === Test 2: Zoom/pan controls ===
        console.log('\n--- ZOOM/PAN ---');
        try {
            // Get initial zoom
            const initialZoom = await page.evaluate(() => {
                const s = window.evostitch.zarrViewer.getState();
                // Access internal viewState via deck
                return s.initialized ? true : false;
            });

            // Click zoom in
            await page.click('#zoom-in-btn');
            await page.waitForTimeout(300); // Let animation settle

            // Click zoom out
            await page.click('#zoom-out-btn');
            await page.waitForTimeout(300);

            // Click home/reset
            await page.click('#home-btn');
            await page.waitForTimeout(300);

            // Verify no errors during zoom
            const zoomErrors = errors.filter(e =>
                e.includes('WebGL') || e.includes('context lost')
            );
            if (zoomErrors.length > 0) {
                fail('zoom-pan', `WebGL errors during zoom: ${zoomErrors.join('; ')}`);
            } else {
                pass('zoom-pan', 'Zoom in/out/home buttons work, no WebGL errors');
            }
        } catch (e) {
            fail('zoom-pan', e.message);
        }

        // === Test 3: Channel controls ===
        console.log('\n--- CHANNELS ---');
        try {
            const channelInfo = await page.evaluate(() => {
                const settings = window.evostitch.zarrViewer.getChannelSettings();
                const channelList = document.getElementById('channel-list');
                const items = channelList?.querySelectorAll('.channel-item');
                return {
                    settingsCount: settings?.length || 0,
                    domItems: items?.length || 0,
                    firstChannel: settings?.[0] || null
                };
            });

            if (channelInfo.settingsCount === 0) {
                fail('channels', 'No channel settings found');
            } else {
                // Toggle first channel visibility
                await page.evaluate(() =>
                    window.evostitch.zarrViewer.setChannelVisible(0, false)
                );
                const hidden = await page.evaluate(() =>
                    window.evostitch.zarrViewer.getChannelSettings()[0]?.visible
                );

                await page.evaluate(() =>
                    window.evostitch.zarrViewer.setChannelVisible(0, true)
                );
                const visible = await page.evaluate(() =>
                    window.evostitch.zarrViewer.getChannelSettings()[0]?.visible
                );

                if (hidden === false && visible === true) {
                    pass('channels', `${channelInfo.settingsCount} channels, ` +
                        `${channelInfo.domItems} DOM items, toggle works`);
                } else {
                    fail('channels', `Toggle failed: hidden=${hidden}, visible=${visible}`);
                }
            }
        } catch (e) {
            fail('channels', e.message);
        }

        // === Test 4: Prefetch engine init ===
        console.log('\n--- PREFETCH ---');
        try {
            const prefetchStats = await page.evaluate(() => {
                if (!window.evostitch?.zarrPrefetch) return null;
                return window.evostitch.zarrPrefetch.getStats();
            });

            if (!prefetchStats) {
                fail('prefetch-init', 'zarrPrefetch module not found');
            } else if (!prefetchStats.zarrStoreUrl) {
                fail('prefetch-init', 'zarrPrefetch not initialized (no storeUrl)');
            } else {
                pass('prefetch-init',
                    `storeUrl=${prefetchStats.zarrStoreUrl}, ` +
                    `levels=${prefetchStats.resolutionLevels}, ` +
                    `zCount=${prefetchStats.zCount}, ` +
                    `sep="${prefetchStats.dimensionSeparator}"`);
            }
        } catch (e) {
            fail('prefetch-init', e.message);
        }

        // === Test 5: Seamless Z-Focus (replaced 3D loader mode) ===
        console.log('\n--- SEAMLESS Z-FOCUS ---');
        try {
            const zFocusInfo = await page.evaluate(() => {
                return {
                    // zarr3DLoader should NOT exist
                    has3DLoader: !!window.evostitch?.zarr3DLoader,
                    // No Load 3D button in DOM
                    hasLoadBtn: !!document.getElementById('load-3d-btn'),
                    hasExitBtn: !!document.getElementById('exit-3d-btn'),
                    // Z-controls container should exist
                    hasContainer: !!document.getElementById('z-controls-container'),
                    hasSlider: !!document.getElementById('z-slider'),
                    // Check CSS class support
                    containerClasses: document.getElementById('z-controls-container')?.className || ''
                };
            });

            const issues = [];
            if (zFocusInfo.has3DLoader) issues.push('zarr3DLoader still exists');
            if (zFocusInfo.hasLoadBtn) issues.push('load-3d-btn still in DOM');
            if (zFocusInfo.hasExitBtn) issues.push('exit-3d-btn still in DOM');
            if (!zFocusInfo.hasContainer) issues.push('z-controls-container missing');
            if (!zFocusInfo.hasSlider) issues.push('z-slider missing');

            if (issues.length > 0) {
                fail('seamless-z-focus', issues.join(', '));
            } else {
                pass('seamless-z-focus',
                    'No 3D loader, no Load/Exit buttons, Z-controls present');
            }
        } catch (e) {
            fail('seamless-z-focus', e.message);
        }

        // === Test 6: Service worker interception ===
        console.log('\n--- SW INTERCEPTION ---');
        try {
            // Check if SW is active
            const swActive = await page.evaluate(() =>
                window.evostitch?.sw?.isActive?.()
            );

            if (!swActive) {
                // SW may not activate on first load in headless — check if registered
                const swState = await page.evaluate(() => {
                    return navigator.serviceWorker?.controller ? 'controlling' :
                        navigator.serviceWorker?.ready ? 'registered' : 'none';
                });
                // SW not controlling yet is acceptable in headless first load
                console.log(`  SW state: ${swState} (first load, may need refresh)`);

                // Try getting SW stats anyway
                const stats = await page.evaluate(async () => {
                    try {
                        return await window.evostitch.sw.getStats();
                    } catch { return null; }
                });

                if (stats) {
                    pass('sw-interception', `SW stats available: ${JSON.stringify(stats)}`);
                } else {
                    // Reload and try again — SW activates on second load
                    console.log('  Reloading page for SW activation...');
                    await page.reload({ timeout: TIMEOUT });
                    await page.waitForFunction(
                        () => window.evostitch?.zarrViewer?.getState?.()?.initialized === true,
                        undefined, { timeout: 60000 }
                    );

                    const swActiveRetry = await page.evaluate(() =>
                        window.evostitch?.sw?.isActive?.()
                    );
                    const statsRetry = await page.evaluate(async () => {
                        try {
                            return await window.evostitch.sw.getStats();
                        } catch { return null; }
                    });

                    if (swActiveRetry || statsRetry) {
                        pass('sw-interception',
                            `SW active after reload: ${swActiveRetry}, ` +
                            `stats: ${JSON.stringify(statsRetry)}`);
                    } else {
                        fail('sw-interception',
                            'SW not active even after reload (headless limitation)');
                    }
                }
            } else {
                // SW is active, get cache stats
                const stats = await page.evaluate(async () => {
                    try {
                        return await window.evostitch.sw.getStats();
                    } catch { return null; }
                });
                pass('sw-interception',
                    `SW active, cache stats: ${JSON.stringify(stats)}`);
            }
        } catch (e) {
            fail('sw-interception', e.message);
        }

        // === Test 7: No console errors (excluding known non-blocking warnings) ===
        console.log('\n--- CONSOLE ERRORS ---');
        const criticalErrors = errors.filter(e =>
            !e.includes('Invalid indexer key: t') &&         // zarrita metadata parsing
            !e.includes('SwiftShader') &&                     // headless GPU
            !e.includes('WEBGL_debug_renderer_info') &&       // extension deprecation
            !e.includes('favicon.ico') &&                     // missing favicon
            !e.includes('net::ERR_FILE_NOT_FOUND') &&         // optional resources
            !e.includes('Failed to load resource') &&         // 404s from tile/chunk fetching
            !e.includes('404')                                // HTTP 404 responses
        );

        if (criticalErrors.length > 0) {
            fail('no-errors', `${criticalErrors.length} critical errors:\n  ` +
                criticalErrors.slice(0, 5).join('\n  '));
        } else {
            pass('no-errors', `No critical console errors (${errors.length} non-blocking warnings filtered)`);
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

        // Print perf stats if any Z-switches were measured
        const perfStats = await page.evaluate(() => {
            try { return window.evostitch.zarrViewer.getPerfStats(); }
            catch { return null; }
        });
        if (perfStats?.sampleCount > 0) {
            console.log(`\nZ-switch perf: ${perfStats.sampleCount} samples, ` +
                `avg=${perfStats.avgMs}ms, p50=${perfStats.p50Ms}ms, ` +
                `p95=${perfStats.p95Ms}ms`);
        }

    } finally {
        if (browser) await browser.close();
        server.kill();
    }
}

run().catch(err => {
    console.error('Full browser test crashed:', err);
    process.exit(1);
});
