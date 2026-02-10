// W7 Spike Test: Viv 0.19 + deck.gl 9 browser compatibility
// Tests loadOmeZarr with IDR + R2 datasets, Deck creation, MultiscaleImageLayer render

const { chromium } = require('playwright');
const http = require('http');

const PORT = 8765;
const TIMEOUT = 60000; // 60s total

function waitForServer(port, maxWait = 10000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        function tryConnect() {
            if (Date.now() - start > maxWait) {
                reject(new Error(`Server not ready after ${maxWait}ms`));
                return;
            }
            const req = http.get(`http://localhost:${port}/spike-test.html`, res => {
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

    let browser;
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

        // Collect console output
        const logs = [];
        page.on('console', msg => {
            const text = msg.text();
            logs.push(text);
            process.stdout.write(`[browser] ${text}\n`);
        });

        page.on('pageerror', err => {
            process.stderr.write(`[page-error] ${err.message}\n`);
        });

        console.log(`Opening http://localhost:${PORT}/spike-test.html ...`);
        await page.goto(`http://localhost:${PORT}/spike-test.html`, { timeout: TIMEOUT });

        // Wait for spike test to complete
        console.log('Waiting for spike test to complete (up to 60s)...');
        await page.waitForFunction(() => window._spikeDone === true, { timeout: TIMEOUT });

        // Get results
        const results = await page.evaluate(() => window._spikeResults);
        console.log('\n=== SPIKE TEST RESULTS ===');
        console.log(JSON.stringify(results, null, 2));

        const passed = Object.values(results).filter(v => v === 'PASS').length;
        const failed = Object.values(results).filter(v => v === 'FAIL').length;
        console.log(`\n${passed} passed, ${failed} failed`);

        if (failed > 0) {
            console.log('\nFAILED TESTS:');
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
    console.error('Spike test crashed:', err);
    process.exit(1);
});
