// evostitch Browser Decode Strategy
// Detects browser capabilities and provides optimal decode path

(function() {
    'use strict';

    // Cached detection results
    let detectionDone = false;
    let canUseWorkers = false;
    let browserType = 'unknown';

    // Detect browser type
    function detectBrowser() {
        if (detectionDone) return;

        // Chrome/Chromium detection
        if (window.chrome && navigator.userAgent.indexOf('Chrome') !== -1) {
            browserType = 'chromium';
        }
        // Firefox detection
        else if (typeof InstallTrigger !== 'undefined' || navigator.userAgent.indexOf('Firefox') !== -1) {
            browserType = 'firefox';
        }
        // Safari detection (must be after Chrome check since Chrome on iOS reports Safari)
        else if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
            browserType = 'safari';
        }
        // Edge (Chromium-based)
        else if (navigator.userAgent.indexOf('Edg') !== -1) {
            browserType = 'chromium';
        }

        // Check Web Worker and createImageBitmap support
        canUseWorkers = typeof Worker !== 'undefined' &&
                        typeof createImageBitmap !== 'undefined';

        detectionDone = true;

        console.log(`[evostitch] Browser detected: ${browserType}, workers: ${canUseWorkers}`);
    }

    // Get the recommended decode strategy
    function getStrategy() {
        detectBrowser();

        if (canUseWorkers) {
            // All modern browsers support worker-based decode with createImageBitmap
            // Chrome/Chromium has best performance with fetch → blob → createImageBitmap
            // Firefox/Safari also support this, though Image.decode() is an alternative
            return 'worker';
        }

        // Fallback for very old browsers
        return 'main-thread';
    }

    // Decode image on main thread (fallback)
    // Uses Image.decode() for async decoding when available
    async function decodeMainThread(url) {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        // Set async decoding hint
        if ('decoding' in img) {
            img.decoding = 'async';
        }

        return new Promise(function(resolve, reject) {
            img.onload = async function() {
                try {
                    // Use decode() if available for off-thread decode
                    if (typeof img.decode === 'function') {
                        await img.decode();
                    }

                    // Convert to ImageBitmap if supported
                    if (typeof createImageBitmap !== 'undefined') {
                        const bitmap = await createImageBitmap(img);
                        resolve(bitmap);
                    } else {
                        // Ultimate fallback: return the image element
                        resolve(img);
                    }
                } catch (err) {
                    reject(err);
                }
            };

            img.onerror = function() {
                reject(new Error('Failed to load image: ' + url));
            };

            img.src = url;
        });
    }

    // Initialize detection
    function init() {
        detectBrowser();
    }

    // Get detection results
    function getInfo() {
        detectBrowser();
        return {
            browser: browserType,
            canUseWorkers: canUseWorkers,
            strategy: getStrategy()
        };
    }

    // Expose API
    window.evostitch = window.evostitch || {};
    window.evostitch.browserDecode = {
        init: init,
        getStrategy: getStrategy,
        getInfo: getInfo,
        decodeMainThread: decodeMainThread
    };

})();
