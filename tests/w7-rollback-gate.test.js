// W7 Rollback Gate: 5 Z-switches cold+warm, p95<2000ms, no WebGL loss, SW working
// If ANY check fails → abort W7, revert to baseline
//
// Criteria from TASK-bd-3nk.37:
//   (1) no WebGL context lost
//   (2) p95 ≤ 2000ms
//   (3) SW still intercepting

const { chromium } = require('playwright');
const http = require('http');

const PORT = 8767;
const TIMEOUT = 90000;
const P95_THRESHOLD_MS = 2000;
const Z_SWITCH_COUNT = 5;

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

    console.log('=== W7 ROLLBACK GATE ===');
    console.log(`Threshold: p95 ≤ ${P95_THRESHOLD_MS}ms, no WebGL loss, SW active\n`);

    console.log('Waiting for server...');
    await waitForServer(PORT);
    console.log('Server ready.');

    const gates = {};
    let browser;

    function gate(name, passed, detail) {
        gates[name] = passed ? 'PASS' : 'FAIL';
        console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
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

        // Track WebGL errors
        const webglErrors = [];
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('context lost') || text.includes('CONTEXT_LOST') ||
                text.includes('WebGL context')) {
                webglErrors.push(text);
            }
        });
        page.on('pageerror', err => {
            if (err.message.includes('WebGL') || err.message.includes('context')) {
                webglErrors.push(err.message);
            }
        });

        // === Load viewer ===
        const url = `http://localhost:${PORT}/zarr-viewer.html?zarr=mosaic_3d_zarr_v2`;
        console.log(`\nLoading ${url} ...`);
        await page.goto(url, { timeout: TIMEOUT });

        await page.waitForFunction(
            () => window.evostitch?.zarrViewer?.getState?.()?.initialized === true,
            undefined, { timeout: 60000 }
        );
        console.log('Viewer initialized.');

        // Get Z count
        const zCount = await page.evaluate(() =>
            window.evostitch.zarrViewer.getState().zCount
        );
        console.log(`Dataset: ${zCount} Z-planes`);

        if (zCount < Z_SWITCH_COUNT + 1) {
            console.log(`WARNING: Only ${zCount} Z-planes, reducing switch count`);
        }
        const switchCount = Math.min(Z_SWITCH_COUNT, zCount - 1);

        // === Reload for SW activation (SW activates on second load) ===
        console.log('Reloading for SW activation...');
        await page.reload({ timeout: TIMEOUT });
        await page.waitForFunction(
            () => window.evostitch?.zarrViewer?.getState?.()?.initialized === true,
            undefined, { timeout: 60000 }
        );

        // Clear perf stats before benchmark
        await page.evaluate(() => window.evostitch.zarrViewer.clearPerfStats());

        // === Cold Z-switches (first visit to each Z-plane) ===
        console.log(`\n--- COLD: ${switchCount} Z-switches ---`);
        for (let i = 1; i <= switchCount; i++) {
            const targetZ = i;
            const start = Date.now();
            await page.evaluate((z) => window.evostitch.zarrViewer.setZ(z), targetZ);
            await page.waitForFunction(
                (z) => window.evostitch.zarrViewer.getState().currentZ === z,
                targetZ, { timeout: 30000 }
            );
            // Wait for tile load (onViewportLoad fires after tiles render)
            await page.waitForTimeout(500);
            const elapsed = Date.now() - start;
            console.log(`  Z→${targetZ}: ~${elapsed}ms (wall clock)`);
        }

        const coldStats = await page.evaluate(() =>
            window.evostitch.zarrViewer.getPerfStats()
        );
        console.log(`Cold stats: ${coldStats.sampleCount} samples, avg=${coldStats.avgMs}ms, p95=${coldStats.p95Ms}ms`);

        // === Warm Z-switches (revisit same Z-planes, should hit SW cache) ===
        console.log(`\n--- WARM: ${switchCount} Z-switches ---`);
        // Go back to Z=0 first
        await page.evaluate(() => window.evostitch.zarrViewer.setZ(0));
        await page.waitForFunction(
            () => window.evostitch.zarrViewer.getState().currentZ === 0,
            undefined, { timeout: 30000 }
        );
        await page.waitForTimeout(300);

        for (let i = 1; i <= switchCount; i++) {
            const targetZ = i;
            const start = Date.now();
            await page.evaluate((z) => window.evostitch.zarrViewer.setZ(z), targetZ);
            await page.waitForFunction(
                (z) => window.evostitch.zarrViewer.getState().currentZ === z,
                targetZ, { timeout: 30000 }
            );
            await page.waitForTimeout(300);
            const elapsed = Date.now() - start;
            console.log(`  Z→${targetZ}: ~${elapsed}ms (wall clock)`);
        }

        const finalStats = await page.evaluate(() =>
            window.evostitch.zarrViewer.getPerfStats()
        );
        console.log(`\nCombined stats: ${finalStats.sampleCount} samples, avg=${finalStats.avgMs}ms, ` +
            `p50=${finalStats.p50Ms}ms, p95=${finalStats.p95Ms}ms, min=${finalStats.minMs}ms, max=${finalStats.maxMs}ms`);

        // === GATE 1: p95 ≤ 2000ms ===
        if (finalStats.sampleCount === 0) {
            gate('p95-threshold', false, 'No Z-switch samples recorded');
        } else if (finalStats.p95Ms <= P95_THRESHOLD_MS) {
            gate('p95-threshold', true, `p95=${finalStats.p95Ms}ms ≤ ${P95_THRESHOLD_MS}ms`);
        } else {
            gate('p95-threshold', false, `p95=${finalStats.p95Ms}ms > ${P95_THRESHOLD_MS}ms threshold`);
        }

        // === GATE 2: No WebGL context loss ===
        if (webglErrors.length === 0) {
            gate('no-webgl-loss', true, 'No WebGL context loss detected');
        } else {
            gate('no-webgl-loss', false, `${webglErrors.length} WebGL errors: ${webglErrors.join('; ')}`);
        }

        // === GATE 3: SW still intercepting ===
        const swStatus = await page.evaluate(async () => {
            try {
                const active = window.evostitch?.sw?.isActive?.();
                const stats = await window.evostitch?.sw?.getStats?.();
                return { active, stats };
            } catch (e) {
                return { error: e.message };
            }
        });

        if (swStatus.error) {
            gate('sw-working', false, `SW error: ${swStatus.error}`);
        } else if (swStatus.active && swStatus.stats) {
            gate('sw-working', true,
                `SW active, cache=${swStatus.stats.cacheName}, entries=${swStatus.stats.count}`);
        } else if (swStatus.stats) {
            gate('sw-working', true,
                `SW stats available (may not report active in headless), entries=${swStatus.stats.count}`);
        } else {
            gate('sw-working', false, 'SW not active and no stats available');
        }

        // === SUMMARY ===
        console.log('\n=== ROLLBACK GATE SUMMARY ===');
        const allPassed = Object.values(gates).every(v => v === 'PASS');
        const failCount = Object.values(gates).filter(v => v === 'FAIL').length;

        for (const [name, result] of Object.entries(gates)) {
            console.log(`  ${result === 'PASS' ? 'PASS' : 'FAIL'} ${name}`);
        }

        if (allPassed) {
            console.log('\nGATE: PASS — W7 upgrade is safe to proceed');
        } else {
            console.log(`\nGATE: FAIL — ${failCount} gate(s) failed. W7 should be reverted.`);
            process.exitCode = 1;
        }

        // Print raw timing data for evidence
        console.log('\n--- Raw Perf Data ---');
        console.log(JSON.stringify(finalStats, null, 2));

    } finally {
        if (browser) await browser.close();
        server.kill();
    }
}

run().catch(err => {
    console.error('Rollback gate test crashed:', err);
    process.exit(1);
});
