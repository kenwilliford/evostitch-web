// evostitch Worker Tile Source
// OpenSeadragon integration for worker-based tile decoding
// Uses worker pool for off-thread createImageBitmap decoding

(function() {
    'use strict';

    // State
    let viewer = null;
    let enabled = false;
    let debug = false;
    let stats = {
        workerDecodes: 0,
        fallbackDecodes: 0,
        errors: 0
    };

    // Initialize worker tile source
    function init(osdViewer, options) {
        if (!osdViewer) {
            console.error('[evostitch] Worker tile source requires viewer instance');
            return false;
        }

        options = options || {};
        viewer = osdViewer;

        // Check dependencies
        if (!window.evostitch || !window.evostitch.workerPool) {
            console.warn('[evostitch] Worker pool not available, using fallback decoding');
            return false;
        }

        if (!window.evostitch.browserDecode) {
            console.warn('[evostitch] Browser decode module not available');
            return false;
        }

        // Check if workers are supported
        const strategy = window.evostitch.browserDecode.getStrategy();
        if (strategy !== 'worker') {
            console.warn('[evostitch] Worker-based decoding not supported, using fallback');
            return false;
        }

        // Initialize worker pool
        const poolSize = options.poolSize || (navigator.hardwareConcurrency || 4);
        window.evostitch.workerPool.init({ poolSize: Math.min(poolSize, 8) });

        // Hook into OpenSeadragon's tile download
        hookTileDownload();

        enabled = true;
        console.log('[evostitch] Worker tile source initialized (same-origin tiles only; cross-origin requires CORS)');
        return true;
    }

    // Hook into OSD tile download using custom getTileUrl
    // This approach intercepts tile requests and decodes via worker
    function hookTileDownload() {
        if (!viewer || !OpenSeadragon) return;

        // Get the viewer's image loader instance
        const imageLoader = viewer.imageLoader;
        if (!imageLoader) {
            console.warn('[evostitch] No image loader found on viewer');
            return;
        }

        // Store reference to original download function on the instance
        const originalDownload = imageLoader.addJob.bind(imageLoader);

        // Override addJob on the instance to use worker decode for tile images
        imageLoader.addJob = function(options) {
            // Only intercept tile image jobs, not other resources
            if (!enabled || !options.src || !isTileUrl(options.src)) {
                return originalDownload(options);
            }

            // Workers can't fetch cross-origin without CORS headers on the server
            // Fall back to standard loading for cross-origin tiles
            if (!isSameOrigin(options.src)) {
                log('Cross-origin tile, using standard loader: ' + options.src.substring(0, 50) + '...');
                return originalDownload(options);
            }

            // Ensure absolute URL for worker (workers don't have page URL context)
            let src = options.src;
            log('Original src: ' + src);
            if (src && !src.startsWith('http://') && !src.startsWith('https://')) {
                src = new URL(src, window.location.href).href;
                log('Converted to absolute: ' + src);
            }

            const callback = options.callback;
            const abort = options.abort;
            const timeout = options.timeout || 30000;

            // Track for abort
            let aborted = false;
            const job = {
                abort: function() {
                    aborted = true;
                    if (abort) abort();
                }
            };

            // Decode via worker pool
            const decodePromise = window.evostitch.workerPool.decode(src);

            // Set up timeout
            const timeoutId = setTimeout(function() {
                if (!aborted) {
                    job.abort();
                    log('Decode timeout: ' + src);
                    stats.errors++;
                    if (callback) callback(null);
                }
            }, timeout);

            decodePromise
                .then(function(bitmap) {
                    clearTimeout(timeoutId);
                    if (aborted) {
                        // Clean up bitmap if aborted
                        if (bitmap && bitmap.close) bitmap.close();
                        return;
                    }

                    stats.workerDecodes++;
                    log('Worker decode complete: ' + src.substring(src.lastIndexOf('/') + 1));

                    // Return ImageBitmap directly - it works with drawImage
                    // OSD's Canvas drawer can handle ImageBitmap natively
                    if (callback) callback(bitmap);
                })
                .catch(function(error) {
                    clearTimeout(timeoutId);
                    if (aborted) return;

                    stats.errors++;
                    log('Worker decode failed, falling back: ' + error.message);

                    // Fallback to original download (already bound to imageLoader)
                    stats.fallbackDecodes++;
                    return originalDownload(options);
                });

            return job;
        };
    }

    // Check if URL is a tile (not a DZI manifest or other resource)
    function isTileUrl(url) {
        // Tile URLs typically end in .jpg, .jpeg, .png, .webp
        // and are in a numbered directory structure
        return /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url) &&
               /\/\d+\/\d+_\d+\./i.test(url);
    }

    // Check if URL is same-origin (workers can't fetch cross-origin without CORS)
    function isSameOrigin(url) {
        try {
            const urlObj = new URL(url, window.location.href);
            return urlObj.origin === window.location.origin;
        } catch (e) {
            return false;
        }
    }

    // Get statistics
    function getStats() {
        return {
            enabled: enabled,
            workerDecodes: stats.workerDecodes,
            fallbackDecodes: stats.fallbackDecodes,
            errors: stats.errors,
            workerPoolState: window.evostitch.workerPool ?
                window.evostitch.workerPool.getState() : null
        };
    }

    // Enable/disable
    function setEnabled(value) {
        enabled = !!value;
        log('Worker tile source ' + (enabled ? 'enabled' : 'disabled'));
    }

    // Debug logging
    function setDebug(value) {
        debug = !!value;
        if (window.evostitch.workerPool) {
            window.evostitch.workerPool.setDebug(value);
        }
    }

    function log(message) {
        if (debug) {
            console.log('[evostitch:worker-tile-source] ' + message);
        }
    }

    // Expose API
    window.evostitch = window.evostitch || {};
    window.evostitch.workerTileSource = {
        init: init,
        getStats: getStats,
        setEnabled: setEnabled,
        setDebug: setDebug
    };

})();
