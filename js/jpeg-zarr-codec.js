/**
 * jpeg-zarr-codec.js - Browser JPEG codec for zarrita
 *
 * Decodes JPEG-compressed zarr chunks for codec ID "imagecodecs_jpeg".
 * Primary decode path: WASM libjpeg-turbo (direct grayscale, no GPU involvement)
 * Fallback decode path: Canvas (createImageBitmap -> OffscreenCanvas -> R channel)
 *
 * WASM decode: JPEG bytes -> libjpeg-turbo TJPF_GRAY -> Uint8Array (3-8ms per 512x512)
 * Canvas decode: JPEG bytes -> Blob -> createImageBitmap -> OffscreenCanvas -> R channel (40-70ms)
 *
 * Depends on:
 *   - wasm/jpeg-decode.js (Emscripten glue, defines JpegDecodeModule global) — optional
 *   - zarr-viewer-bundle.js (registry export from zarrita)
 */
(function() {
    'use strict';

    // Must match MAX_CHUNK_DIM in jpeg-decode-wrapper.c
    var MAX_CHUNK_DIM = 4096;

    // Must match JPEG_DECODE_VERSION in jpeg-decode-wrapper.c
    var JPEG_DECODE_VERSION = 1;

    // Explicit init state machine (per review F5)
    // States: 'uninitialized' -> 'initializing' -> 'ready' | 'failed'
    var wasmState = 'uninitialized';
    var wasmModule = null;
    var wasmInitPromise = null;
    var initError = null;

    // Pre-allocated WASM buffers for the hot path
    var inputBufPtr = 0;
    var inputBufSize = 0;
    var outputBufPtr = 0;
    var outputBufSize = 0;
    var widthPtr = 0;
    var heightPtr = 0;

    // Decode telemetry (per review F2, Q3)
    var decodeCount = 0;
    var fallbackCount = 0;
    var totalDecodeMs = 0;

    /**
     * Initialize WASM module. Called once, idempotent.
     * One-way degrade: once 'failed', always uses canvas.
     * @returns {Promise<boolean>} true if WASM ready, false if fallback
     */
    function initWasm() {
        if (wasmState === 'ready') return Promise.resolve(true);
        if (wasmState === 'failed') return Promise.resolve(false);
        if (wasmInitPromise) return wasmInitPromise;

        wasmState = 'initializing';
        wasmInitPromise = _doInitWasm();
        return wasmInitPromise;
    }

    async function _doInitWasm() {
        try {
            if (typeof JpegDecodeModule !== 'function') {
                console.warn('[jpeg-codec] WASM module not found, using canvas fallback');
                wasmState = 'failed';
                initError = 'JpegDecodeModule not defined';
                return false;
            }

            wasmModule = await JpegDecodeModule();

            // Version coherency check (per review R3)
            var wasmVersion = wasmModule._jpeg_decode_version();
            if (wasmVersion !== JPEG_DECODE_VERSION) {
                console.warn('[jpeg-codec] WASM version mismatch: JS=' +
                    JPEG_DECODE_VERSION + ' WASM=' + wasmVersion);
            }

            var ret = wasmModule._jpeg_decode_init();
            if (ret !== 0) {
                console.error('[jpeg-codec] WASM init failed:', ret);
                wasmState = 'failed';
                initError = 'jpeg_decode_init returned ' + ret;
                return false;
            }

            // Pre-allocate buffers for 512x512 chunks
            inputBufSize = 512 * 1024;
            inputBufPtr = wasmModule._malloc(inputBufSize);
            outputBufSize = 512 * 512;
            outputBufPtr = wasmModule._malloc(outputBufSize);
            widthPtr = wasmModule._malloc(4);
            heightPtr = wasmModule._malloc(4);

            if (!inputBufPtr || !outputBufPtr || !widthPtr || !heightPtr) {
                console.error('[jpeg-codec] WASM buffer allocation failed');
                wasmState = 'failed';
                initError = 'buffer allocation failed';
                return false;
            }

            wasmState = 'ready';
            console.log('[jpeg-codec] WASM libjpeg-turbo decoder ready');
            return true;
        } catch (err) {
            console.warn('[jpeg-codec] WASM init error, using canvas fallback:', err);
            wasmState = 'failed';
            initError = String(err);
            return false;
        }
    }

    /**
     * Decode via WASM libjpeg-turbo (grayscale direct).
     * @param {Uint8Array} data - JPEG bytes
     * @returns {Uint8Array} Grayscale pixel data
     */
    function decodeWasm(data) {
        var t0 = performance.now();

        // Grow input buffer if needed
        if (data.byteLength > inputBufSize) {
            wasmModule._free(inputBufPtr);
            inputBufSize = data.byteLength + 1024;
            inputBufPtr = wasmModule._malloc(inputBufSize);
        }

        wasmModule.HEAPU8.set(data, inputBufPtr);

        var ret = wasmModule._jpeg_decode_gray(
            inputBufPtr, data.byteLength,
            outputBufPtr, outputBufSize,
            widthPtr, heightPtr
        );

        if (ret === -3) {
            // Output buffer too small — grow to max and retry.
            // C wrapper doesn't write dimensions to output pointers on -3,
            // but rejects dimensions > MAX_CHUNK_DIM with -2, so this is the upper bound.
            wasmModule._free(outputBufPtr);
            outputBufSize = MAX_CHUNK_DIM * MAX_CHUNK_DIM;
            outputBufPtr = wasmModule._malloc(outputBufSize);

            // Reinit decompressor — tjDecompressHeader3 leaves handle in
            // "header parsed" state after -3, which corrupts subsequent calls.
            wasmModule._jpeg_decode_destroy();
            wasmModule._jpeg_decode_init();

            // Re-copy input data (HEAPU8 may have been invalidated by memory growth)
            wasmModule.HEAPU8.set(data, inputBufPtr);

            ret = wasmModule._jpeg_decode_gray(
                inputBufPtr, data.byteLength,
                outputBufPtr, outputBufSize,
                widthPtr, heightPtr
            );
        }

        if (ret !== 0) {
            throw new Error('WASM JPEG decode failed: error ' + ret);
        }

        var width = wasmModule.HEAP32[widthPtr >> 2];
        var height = wasmModule.HEAP32[heightPtr >> 2];
        var pixelCount = width * height;

        // JS dimension guard (per review R4, Q1)
        if (width > MAX_CHUNK_DIM || height > MAX_CHUNK_DIM) {
            console.warn('[jpeg-codec] Unexpected dimensions: ' + width + 'x' + height);
        }

        var pixels = new Uint8Array(pixelCount);
        pixels.set(wasmModule.HEAPU8.subarray(outputBufPtr, outputBufPtr + pixelCount));

        var elapsed = performance.now() - t0;
        decodeCount++;
        totalDecodeMs += elapsed;

        return pixels;
    }

    /**
     * Decode via canvas (fallback path).
     * @param {Uint8Array} data - JPEG bytes
     * @returns {Promise<Uint8Array>} Grayscale pixel data
     */
    async function decodeCanvas(data) {
        fallbackCount++;
        var blob = new Blob([data], { type: 'image/jpeg' });
        var bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        var w = bmp.width;
        var h = bmp.height;
        var canvas = new OffscreenCanvas(w, h);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        var imageData = ctx.getImageData(0, 0, w, h);
        var rgba = imageData.data;
        var pixels = new Uint8Array(w * h);
        for (var i = 0; i < pixels.length; i++) {
            pixels[i] = rgba[i * 4];
        }
        return pixels;
    }

    /**
     * ImagecodecsJpegCodec - zarrita-compatible JPEG decoder
     *
     * Registry key: "imagecodecs_jpeg" (matches Python imagecodecs.numcodecs.Jpeg compressor ID)
     * Kind: bytes_to_bytes (compressor/decompressor in zarr v2 pipeline)
     */
    class ImagecodecsJpegCodec {
        constructor(config) {
            this._config = config || {};
        }

        /**
         * Factory method required by zarrita codec interface.
         * @param {Object} config - Codec configuration from .zarray (e.g., {level: 95})
         * @returns {ImagecodecsJpegCodec} Codec instance
         */
        static fromConfig(config) {
            return new ImagecodecsJpegCodec(config);
        }

        /** @returns {string} Codec kind for zarrita pipeline classification */
        get kind() {
            return 'bytes_to_bytes';
        }

        /**
         * Encoding is not supported in the browser.
         * @throws {Error} Always throws
         */
        encode() {
            throw new Error('JPEG encoding is not supported in the browser codec.');
        }

        /**
         * Decode JPEG bytes to raw grayscale pixel data.
         * Uses WASM libjpeg-turbo if available, canvas fallback otherwise.
         * @param {Uint8Array} data - Raw JPEG bytes from a zarr chunk
         * @returns {Promise<Uint8Array>} Decoded grayscale pixel values
         */
        async decode(data) {
            await initWasm();

            if (wasmState === 'ready') {
                return decodeWasm(data);
            } else {
                return decodeCanvas(data);
            }
        }
    }

    // Expose codec class and WASM init for zarr-viewer.js and test pages
    window._ImagecodecsJpegCodec = ImagecodecsJpegCodec;
    window._jpegWasmInit = initWasm;

    // Telemetry API (per review Q3)
    if (!window.evostitch) window.evostitch = {};
    window.evostitch.jpegCodec = {
        getState: function() {
            return {
                wasmState: wasmState,
                initError: initError,
                decodeCount: decodeCount,
                fallbackCount: fallbackCount,
                avgDecodeMs: decodeCount > 0 ? (totalDecodeMs / decodeCount).toFixed(2) : null
            };
        }
    };
})();
