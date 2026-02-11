/**
 * jpeg-zarr-codec.js - Browser JPEG codec for zarrita
 *
 * Decodes JPEG-compressed zarr chunks using native browser APIs.
 * Implements the zarrita codec interface for codec ID "imagecodecs_jpeg".
 *
 * Decode path: JPEG bytes -> createImageBitmap -> OffscreenCanvas -> R channel extraction
 * For grayscale JPEG, R=G=B=luminance, so extracting R gives the original pixel values
 * (subject to JPEG lossy compression artifacts).
 *
 * Depends on: zarr-viewer-bundle.js (registry export from zarrita)
 */
(function() {
    'use strict';

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
         * Called by zarrita's load_codecs when it resolves a codec from the registry.
         * @param {Object} config - Codec configuration from .zarray (e.g., {level: 95})
         * @returns {ImagecodecsJpegCodec} Codec instance
         */
        static fromConfig(config /*, meta */) {
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
        encode(/* data */) {
            throw new Error('JPEG encoding is not supported in the browser codec.');
        }

        /**
         * Decode JPEG bytes to raw grayscale pixel data.
         * @param {Uint8Array} data - Raw JPEG bytes from a zarr chunk
         * @returns {Promise<Uint8Array>} Decoded grayscale pixel values
         */
        async decode(data) {
            var blob = new Blob([data], { type: 'image/jpeg' });
            var bmp = await createImageBitmap(blob, {
                colorSpaceConversion: 'none',
            });

            var w = bmp.width;
            var h = bmp.height;
            var canvas = new OffscreenCanvas(w, h);
            var ctx = canvas.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            bmp.close();

            var imageData = ctx.getImageData(0, 0, w, h);
            var rgba = imageData.data;

            // Extract R channel (= luminance for grayscale JPEG)
            var pixels = new Uint8Array(w * h);
            for (var i = 0; i < pixels.length; i++) {
                pixels[i] = rgba[i * 4];
            }

            return pixels;
        }
    }

    // Expose for use by zarr-viewer.js and test pages
    window._ImagecodecsJpegCodec = ImagecodecsJpegCodec;
})();
