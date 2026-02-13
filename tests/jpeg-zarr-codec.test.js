#!/usr/bin/env node
// Unit tests for jpeg-zarr-codec.js WASM integration
// Tests WASM decode correctness, canvas fallback, state machine, error handling
// Usage: node tests/jpeg-zarr-codec.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(() => {
                console.log(`\u2713 ${name}`);
                passed++;
            }).catch(error => {
                console.log(`\u2717 ${name}`);
                console.log(`  Error: ${error.message}`);
                failed++;
            });
        }
        console.log(`\u2713 ${name}`);
        passed++;
        return Promise.resolve();
    } catch (error) {
        console.log(`\u2717 ${name}`);
        console.log(`  Error: ${error.message}`);
        failed++;
        return Promise.resolve();
    }
}

// ========== File structure tests ==========

const webDir = path.join(__dirname, '..');
const codecPath = path.join(webDir, 'js', 'jpeg-zarr-codec.js');
const wasmJsPath = path.join(webDir, 'wasm', 'jpeg-decode.js');
const wasmBinPath = path.join(webDir, 'wasm', 'jpeg-decode.wasm');
const viewerHtmlPath = path.join(webDir, 'zarr-viewer.html');
const fixturesDir = path.join(webDir, 'tests', 'fixtures');

async function runTests() {
    console.log('\n=== jpeg-zarr-codec.js unit tests ===\n');

    // ---- Section 1: File structure ----
    console.log('--- File structure ---');

    await test('jpeg-zarr-codec.js exists', () => {
        assert.ok(fs.existsSync(codecPath));
    });

    await test('wasm/jpeg-decode.js exists', () => {
        assert.ok(fs.existsSync(wasmJsPath));
    });

    await test('wasm/jpeg-decode.wasm exists', () => {
        assert.ok(fs.existsSync(wasmBinPath));
    });

    await test('wasm/CHECKSUMS.sha256 exists', () => {
        assert.ok(fs.existsSync(path.join(webDir, 'wasm', 'CHECKSUMS.sha256')));
    });

    await test('wasm/LICENSE.libjpeg-turbo exists', () => {
        assert.ok(fs.existsSync(path.join(webDir, 'wasm', 'LICENSE.libjpeg-turbo')));
    });

    await test('golden test fixtures exist', () => {
        const fixtures = [
            'test-512x512-q95.jpg', 'test-512x512-q95.gray',
            'test-1x1-q95.jpg', 'test-1x1-q95.gray',
            'test-256x128-q95.jpg', 'test-256x128-q95.gray',
            'test-512x512-solid-white.jpg', 'test-512x512-solid-white.gray',
            'test-512x512-solid-black.jpg', 'test-512x512-solid-black.gray',
        ];
        for (const f of fixtures) {
            assert.ok(fs.existsSync(path.join(fixturesDir, f)), `Missing: ${f}`);
        }
    });

    // ---- Section 2: Script load order in zarr-viewer.html ----
    console.log('\n--- zarr-viewer.html script load order ---');

    const htmlSource = fs.readFileSync(viewerHtmlPath, 'utf8');

    await test('wasm/jpeg-decode.js loaded before jpeg-zarr-codec.js', () => {
        const wasmIdx = htmlSource.indexOf('wasm/jpeg-decode.js');
        const codecIdx = htmlSource.indexOf('jpeg-zarr-codec.js');
        assert.ok(wasmIdx > 0, 'wasm/jpeg-decode.js not found in HTML');
        assert.ok(codecIdx > 0, 'jpeg-zarr-codec.js not found in HTML');
        assert.ok(wasmIdx < codecIdx, 'wasm/jpeg-decode.js must come before jpeg-zarr-codec.js');
    });

    await test('jpeg-zarr-codec.js loaded before zarr-viewer.js', () => {
        const codecIdx = htmlSource.indexOf('jpeg-zarr-codec.js');
        const viewerIdx = htmlSource.indexOf('zarr-viewer.js');
        assert.ok(codecIdx < viewerIdx, 'jpeg-zarr-codec.js must come before zarr-viewer.js');
    });

    await test('wasm/jpeg-decode.js is a regular script (not module)', () => {
        // Should be <script src="wasm/jpeg-decode.js"></script> without type="module"
        const match = htmlSource.match(/<script[^>]*src="wasm\/jpeg-decode\.js"[^>]*>/);
        assert.ok(match, 'wasm/jpeg-decode.js script tag not found');
        assert.ok(!match[0].includes('type="module"'), 'wasm/jpeg-decode.js must not be type=module');
    });

    // ---- Section 3: Codec source structure ----
    console.log('\n--- Codec source structure ---');

    const codecSource = fs.readFileSync(codecPath, 'utf8');

    await test('codec is IIFE pattern', () => {
        assert.ok(codecSource.includes('(function()'), 'Must use IIFE pattern');
        assert.ok(codecSource.includes('})();'), 'Must close IIFE');
    });

    await test('codec exposes window._ImagecodecsJpegCodec', () => {
        assert.ok(codecSource.includes('window._ImagecodecsJpegCodec'));
    });

    await test('codec exposes window._jpegWasmInit', () => {
        assert.ok(codecSource.includes('window._jpegWasmInit'));
    });

    await test('codec exposes evostitch.jpegCodec.getState()', () => {
        assert.ok(codecSource.includes('window.evostitch.jpegCodec'));
        assert.ok(codecSource.includes('getState'));
    });

    await test('codec has WASM state machine', () => {
        assert.ok(codecSource.includes("'uninitialized'"));
        assert.ok(codecSource.includes("'initializing'"));
        assert.ok(codecSource.includes("'ready'"));
        assert.ok(codecSource.includes("'failed'"));
    });

    await test('codec has MAX_CHUNK_DIM = 4096', () => {
        assert.ok(codecSource.includes('MAX_CHUNK_DIM = 4096'));
    });

    await test('codec has JPEG_DECODE_VERSION = 1', () => {
        assert.ok(codecSource.includes('JPEG_DECODE_VERSION = 1'));
    });

    await test('codec has WASM decode path (decodeWasm)', () => {
        assert.ok(codecSource.includes('function decodeWasm'));
        assert.ok(codecSource.includes('wasmModule.HEAPU8.set'));
        assert.ok(codecSource.includes('_jpeg_decode_gray'));
    });

    await test('codec has canvas fallback path (decodeCanvas)', () => {
        assert.ok(codecSource.includes('async function decodeCanvas'));
        assert.ok(codecSource.includes('createImageBitmap'));
        assert.ok(codecSource.includes('OffscreenCanvas'));
    });

    await test('codec has version coherency check', () => {
        assert.ok(codecSource.includes('_jpeg_decode_version'));
        assert.ok(codecSource.includes('WASM version mismatch'));
    });

    await test('codec has input buffer growth', () => {
        assert.ok(codecSource.includes('data.byteLength > inputBufSize'));
    });

    await test('codec has output buffer growth on -3 error', () => {
        assert.ok(codecSource.includes('ret === -3'));
    });

    await test('codec has telemetry counters', () => {
        assert.ok(codecSource.includes('decodeCount'));
        assert.ok(codecSource.includes('fallbackCount'));
        assert.ok(codecSource.includes('totalDecodeMs'));
    });

    await test('codec logs WASM ready message', () => {
        assert.ok(codecSource.includes('WASM libjpeg-turbo decoder ready'));
    });

    await test('codec warns on WASM module not found', () => {
        assert.ok(codecSource.includes('WASM module not found, using canvas fallback'));
    });

    await test('codec has fromConfig factory method', () => {
        assert.ok(codecSource.includes('static fromConfig'));
    });

    await test('codec kind is bytes_to_bytes', () => {
        assert.ok(codecSource.includes("'bytes_to_bytes'"));
    });

    await test('codec throws on encode()', () => {
        assert.ok(codecSource.includes('JPEG encoding is not supported'));
    });

    await test('codec fallback sets wasmState to failed', () => {
        // When JpegDecodeModule is not available, initWasm sets wasmState='failed'
        assert.ok(codecSource.includes("wasmState = 'failed'"));
        assert.ok(codecSource.includes("initError = 'JpegDecodeModule not defined'"));
    });

    await test('codec getState returns wasmState, decodeCount, fallbackCount', () => {
        assert.ok(codecSource.includes('wasmState: wasmState'));
        assert.ok(codecSource.includes('decodeCount: decodeCount'));
        assert.ok(codecSource.includes('fallbackCount: fallbackCount'));
        assert.ok(codecSource.includes('avgDecodeMs:'));
        assert.ok(codecSource.includes('initError: initError'));
    });

    await test('codec reinits decoder after -3 (handle dirty state)', () => {
        assert.ok(codecSource.includes('_jpeg_decode_destroy()'));
        assert.ok(codecSource.includes('_jpeg_decode_init()'));
    });

    await test('C wrapper has dimension guard (MAX_CHUNK_DIM)', () => {
        const cSource = fs.readFileSync(
            path.join(webDir, 'build', 'libjpeg-turbo-wasm', 'jpeg-decode-wrapper.c'), 'utf8');
        assert.ok(cSource.includes('#define MAX_CHUNK_DIM 4096'));
        assert.ok(cSource.includes('if (width > MAX_CHUNK_DIM || height > MAX_CHUNK_DIM) return -2'));
    });

    // ---- Section 4: WASM module direct tests (Node.js) ----
    console.log('\n--- WASM module direct tests ---');

    // Load WASM module in Node.js
    // WASM was compiled with ENVIRONMENT='web,worker', so we provide the binary directly
    const JpegDecodeModule = require(wasmJsPath);
    const wasmBinary = fs.readFileSync(wasmBinPath);
    let wasmModule;

    await test('JpegDecodeModule() resolves to a module', async () => {
        wasmModule = await JpegDecodeModule({ wasmBinary: wasmBinary });
        assert.ok(wasmModule, 'Module should be truthy');
    });

    await test('WASM module exports _jpeg_decode_version', () => {
        assert.ok(typeof wasmModule._jpeg_decode_version === 'function');
    });

    await test('WASM module exports _jpeg_decode_init', () => {
        assert.ok(typeof wasmModule._jpeg_decode_init === 'function');
    });

    await test('WASM module exports _jpeg_decode_gray', () => {
        assert.ok(typeof wasmModule._jpeg_decode_gray === 'function');
    });

    await test('WASM module exports _jpeg_decode_destroy', () => {
        assert.ok(typeof wasmModule._jpeg_decode_destroy === 'function');
    });

    await test('WASM module exports _malloc and _free', () => {
        assert.ok(typeof wasmModule._malloc === 'function');
        assert.ok(typeof wasmModule._free === 'function');
    });

    await test('_jpeg_decode_version() returns 1', () => {
        assert.strictEqual(wasmModule._jpeg_decode_version(), 1);
    });

    await test('_jpeg_decode_init() returns 0 (success)', () => {
        assert.strictEqual(wasmModule._jpeg_decode_init(), 0);
    });

    await test('_jpeg_decode_init() is idempotent', () => {
        assert.strictEqual(wasmModule._jpeg_decode_init(), 0);
    });

    // ---- Section 5: WASM decode correctness (golden fixtures) ----
    console.log('\n--- WASM decode correctness ---');

    async function testDecodeFixture(name, jpgFile, grayFile, expectedWidth, expectedHeight) {
        await test(`decode ${name}: byte-exact match with djpeg reference`, () => {
            const jpegData = fs.readFileSync(path.join(fixturesDir, jpgFile));
            const expectedPixels = fs.readFileSync(path.join(fixturesDir, grayFile));

            const srcSize = jpegData.byteLength;
            const srcPtr = wasmModule._malloc(srcSize);
            const dstSize = expectedWidth * expectedHeight;
            const dstPtr = wasmModule._malloc(dstSize);
            const wPtr = wasmModule._malloc(4);
            const hPtr = wasmModule._malloc(4);

            wasmModule.HEAPU8.set(jpegData, srcPtr);

            const ret = wasmModule._jpeg_decode_gray(srcPtr, srcSize, dstPtr, dstSize, wPtr, hPtr);
            assert.strictEqual(ret, 0, `decode returned error: ${ret}`);

            const width = wasmModule.HEAP32[wPtr >> 2];
            const height = wasmModule.HEAP32[hPtr >> 2];
            assert.strictEqual(width, expectedWidth, `width: ${width} != ${expectedWidth}`);
            assert.strictEqual(height, expectedHeight, `height: ${height} != ${expectedHeight}`);

            const output = new Uint8Array(dstSize);
            output.set(wasmModule.HEAPU8.subarray(dstPtr, dstPtr + dstSize));

            // Byte-exact comparison
            assert.strictEqual(output.length, expectedPixels.length,
                `output length ${output.length} != expected ${expectedPixels.length}`);
            for (let i = 0; i < output.length; i++) {
                if (output[i] !== expectedPixels[i]) {
                    assert.fail(`Pixel mismatch at index ${i}: got ${output[i]}, expected ${expectedPixels[i]}`);
                }
            }

            wasmModule._free(srcPtr);
            wasmModule._free(dstPtr);
            wasmModule._free(wPtr);
            wasmModule._free(hPtr);
        });
    }

    await testDecodeFixture('512x512 Q=95', 'test-512x512-q95.jpg', 'test-512x512-q95.gray', 512, 512);
    await testDecodeFixture('1x1 Q=95', 'test-1x1-q95.jpg', 'test-1x1-q95.gray', 1, 1);
    await testDecodeFixture('256x128 Q=95', 'test-256x128-q95.jpg', 'test-256x128-q95.gray', 256, 128);
    await testDecodeFixture('512x512 solid white', 'test-512x512-solid-white.jpg', 'test-512x512-solid-white.gray', 512, 512);
    await testDecodeFixture('512x512 solid black', 'test-512x512-solid-black.jpg', 'test-512x512-solid-black.gray', 512, 512);

    // ---- Section 6: Buffer growth ----
    // Run before error handling tests — corrupt data can leave decompressor in dirty state
    console.log('\n--- Buffer growth ---');

    await test('output buffer too small returns -3', () => {
        const jpegData = fs.readFileSync(path.join(fixturesDir, 'test-512x512-q95.jpg'));
        const srcPtr = wasmModule._malloc(jpegData.byteLength);
        const dstPtr = wasmModule._malloc(100); // Too small for 512*512
        const wPtr = wasmModule._malloc(4);
        const hPtr = wasmModule._malloc(4);

        wasmModule.HEAPU8.set(jpegData, srcPtr);
        const ret = wasmModule._jpeg_decode_gray(srcPtr, jpegData.byteLength, dstPtr, 100, wPtr, hPtr);
        assert.strictEqual(ret, -3, `Expected -3 for small buffer, got ${ret}`);

        wasmModule._free(srcPtr);
        wasmModule._free(dstPtr);
        wasmModule._free(wPtr);
        wasmModule._free(hPtr);
    });

    await test('buffer growth: reinit + retry succeeds after -3', () => {
        const jpegData = fs.readFileSync(path.join(fixturesDir, 'test-512x512-q95.jpg'));
        const expectedPixels = fs.readFileSync(path.join(fixturesDir, 'test-512x512-q95.gray'));

        // Reinit decompressor to clear any dirty state from previous -3 test
        wasmModule._jpeg_decode_destroy();
        assert.strictEqual(wasmModule._jpeg_decode_init(), 0, 'Reinit should succeed');

        const srcPtr = wasmModule._malloc(jpegData.byteLength);
        wasmModule.HEAPU8.set(jpegData, srcPtr);
        const wPtr = wasmModule._malloc(4);
        const hPtr = wasmModule._malloc(4);

        // First attempt with small buffer → -3
        const smallDstPtr = wasmModule._malloc(100);
        let ret = wasmModule._jpeg_decode_gray(srcPtr, jpegData.byteLength, smallDstPtr, 100, wPtr, hPtr);
        assert.strictEqual(ret, -3, 'Should get -3 with small buffer');
        wasmModule._free(smallDstPtr);

        // Reinit again to clear state after -3
        wasmModule._jpeg_decode_destroy();
        assert.strictEqual(wasmModule._jpeg_decode_init(), 0, 'Reinit should succeed');

        // Retry with correctly-sized buffer
        const dstSize = 512 * 512;
        const dstPtr = wasmModule._malloc(dstSize);
        ret = wasmModule._jpeg_decode_gray(srcPtr, jpegData.byteLength, dstPtr, dstSize, wPtr, hPtr);
        assert.strictEqual(ret, 0, `Retry should succeed, got ${ret}`);

        const width = wasmModule.HEAP32[wPtr >> 2];
        const height = wasmModule.HEAP32[hPtr >> 2];
        assert.strictEqual(width, 512);
        assert.strictEqual(height, 512);

        const output = new Uint8Array(dstSize);
        output.set(wasmModule.HEAPU8.subarray(dstPtr, dstPtr + dstSize));
        for (let i = 0; i < output.length; i++) {
            if (output[i] !== expectedPixels[i]) {
                assert.fail(`Pixel mismatch at index ${i} after buffer growth`);
            }
        }

        wasmModule._free(srcPtr);
        wasmModule._free(dstPtr);
        wasmModule._free(wPtr);
        wasmModule._free(hPtr);
    });

    // ---- Section 7: Error handling ----
    // Note: corrupt data may leave decompressor in dirty state — these tests run last
    console.log('\n--- Error handling ---');

    await test('corrupt JPEG data returns error (no crash)', () => {
        const corruptData = new Uint8Array([0xFF, 0xD8, 0xFF, 0x00, 0x42, 0x43, 0x44]);
        const srcPtr = wasmModule._malloc(corruptData.byteLength);
        const dstPtr = wasmModule._malloc(512 * 512);
        const wPtr = wasmModule._malloc(4);
        const hPtr = wasmModule._malloc(4);

        wasmModule.HEAPU8.set(corruptData, srcPtr);
        const ret = wasmModule._jpeg_decode_gray(srcPtr, corruptData.byteLength, dstPtr, 512 * 512, wPtr, hPtr);
        assert.ok(ret !== 0, `Expected error code, got ${ret}`);

        wasmModule._free(srcPtr);
        wasmModule._free(dstPtr);
        wasmModule._free(wPtr);
        wasmModule._free(hPtr);
    });

    await test('truncated JPEG data returns error (no crash)', () => {
        // Take first 100 bytes of a valid JPEG
        const validJpeg = fs.readFileSync(path.join(fixturesDir, 'test-512x512-q95.jpg'));
        const truncated = validJpeg.subarray(0, 100);
        const srcPtr = wasmModule._malloc(truncated.byteLength);
        const dstPtr = wasmModule._malloc(512 * 512);
        const wPtr = wasmModule._malloc(4);
        const hPtr = wasmModule._malloc(4);

        wasmModule.HEAPU8.set(truncated, srcPtr);
        const ret = wasmModule._jpeg_decode_gray(srcPtr, truncated.byteLength, dstPtr, 512 * 512, wPtr, hPtr);
        assert.ok(ret !== 0, `Expected error for truncated JPEG, got ${ret}`);

        wasmModule._free(srcPtr);
        wasmModule._free(dstPtr);
        wasmModule._free(wPtr);
        wasmModule._free(hPtr);
    });

    await test('empty data returns error (no crash)', () => {
        const srcPtr = wasmModule._malloc(1);
        const dstPtr = wasmModule._malloc(1);
        const wPtr = wasmModule._malloc(4);
        const hPtr = wasmModule._malloc(4);

        const ret = wasmModule._jpeg_decode_gray(srcPtr, 0, dstPtr, 1, wPtr, hPtr);
        assert.ok(ret !== 0, `Expected error for empty data, got ${ret}`);

        wasmModule._free(srcPtr);
        wasmModule._free(dstPtr);
        wasmModule._free(wPtr);
        wasmModule._free(hPtr);
    });

    // ---- Section 8: Decode performance ----
    console.log('\n--- Decode performance ---');

    await test('decode 512x512 Q=95 in < 50ms', () => {
        const jpegData = fs.readFileSync(path.join(fixturesDir, 'test-512x512-q95.jpg'));
        const srcPtr = wasmModule._malloc(jpegData.byteLength);
        const dstSize = 512 * 512;
        const dstPtr = wasmModule._malloc(dstSize);
        const wPtr = wasmModule._malloc(4);
        const hPtr = wasmModule._malloc(4);

        wasmModule.HEAPU8.set(jpegData, srcPtr);

        // Warm up
        wasmModule._jpeg_decode_gray(srcPtr, jpegData.byteLength, dstPtr, dstSize, wPtr, hPtr);

        // Measure
        const runs = 10;
        const times = [];
        for (let i = 0; i < runs; i++) {
            const t0 = performance.now();
            wasmModule._jpeg_decode_gray(srcPtr, jpegData.byteLength, dstPtr, dstSize, wPtr, hPtr);
            times.push(performance.now() - t0);
        }

        times.sort((a, b) => a - b);
        const p50 = times[Math.floor(runs / 2)];
        console.log(`    p50 decode time: ${p50.toFixed(2)}ms (${runs} runs)`);
        assert.ok(p50 < 50, `p50 ${p50.toFixed(2)}ms exceeds 50ms threshold`);

        wasmModule._free(srcPtr);
        wasmModule._free(dstPtr);
        wasmModule._free(wPtr);
        wasmModule._free(hPtr);
    });

    // ---- Section 8: Cleanup ----
    console.log('\n--- Cleanup ---');

    await test('_jpeg_decode_destroy() returns 0', () => {
        assert.strictEqual(wasmModule._jpeg_decode_destroy(), 0);
    });

    await test('_jpeg_decode_destroy() is idempotent', () => {
        assert.strictEqual(wasmModule._jpeg_decode_destroy(), 0);
    });

    // ---- Summary ----
    console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===\n`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
