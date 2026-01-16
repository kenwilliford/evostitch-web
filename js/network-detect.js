// evostitch Network Detection - W4 Adaptive Quality
// Detects network conditions using Navigator.connection API or tile load timing fallback
// Classifies network as: fast / medium / slow

(function() {
    'use strict';

    // Network speed classifications
    const NETWORK_SPEED = {
        FAST: 'fast',
        MEDIUM: 'medium',
        SLOW: 'slow',
        UNKNOWN: 'unknown'
    };

    // Configuration
    const CONFIG = {
        // Navigator.connection effective type mappings
        connectionTypeMapping: {
            '4g': NETWORK_SPEED.FAST,
            '3g': NETWORK_SPEED.MEDIUM,
            '2g': NETWORK_SPEED.SLOW,
            'slow-2g': NETWORK_SPEED.SLOW
        },
        // Navigator.connection downlink thresholds (Mbps)
        downlinkThresholds: {
            fast: 5,    // >= 5 Mbps = fast
            medium: 1   // >= 1 Mbps = medium, < 1 = slow
        },
        // Tile load time thresholds for fallback detection (ms)
        tileLoadThresholds: {
            fast: 150,   // <= 150ms avg = fast
            medium: 500  // <= 500ms avg = medium, > 500ms = slow
        },
        // Minimum samples needed for reliable fallback classification
        minSamples: 5,
        // Maximum samples to keep (prevents unbounded growth)
        maxSamples: 100,
        // Enable debug logging
        debug: false
    };

    // State
    let currentSpeed = NETWORK_SPEED.UNKNOWN;
    let connectionApiSupported = false;
    let listeners = [];

    // Fallback detection state
    let tileLoadSamples = [];

    // Hysteresis state - prevents rapid oscillation
    let pendingState = null;        // State we're trending toward
    let consecutiveCount = 0;       // How many times we've classified to pendingState
    const HYSTERESIS_THRESHOLD = 3; // Required consecutive classifications before state change

    /**
     * Initialize network detection
     * Checks Navigator.connection API support and sets up change listeners
     * @returns {boolean} True if initialization successful
     */
    function init() {
        // Check for Navigator.connection API support
        connectionApiSupported = !!(navigator.connection ||
            navigator.mozConnection ||
            navigator.webkitConnection);

        if (connectionApiSupported) {
            const connection = navigator.connection ||
                navigator.mozConnection ||
                navigator.webkitConnection;

            // Set initial speed from connection API
            currentSpeed = classifyFromConnectionApi(connection);
            log('Initialized with connection API, speed=' + currentSpeed);

            // Listen for connection changes
            if (connection.addEventListener) {
                connection.addEventListener('change', onConnectionChange);
            }
        } else {
            log('Navigator.connection API not supported, will use fallback detection');
            currentSpeed = NETWORK_SPEED.UNKNOWN;
        }

        return true;
    }

    /**
     * Classify network speed from Navigator.connection API
     * @param {NetworkInformation} connection - Navigator.connection object
     * @returns {string} Network speed classification
     */
    function classifyFromConnectionApi(connection) {
        if (!connection) {
            return NETWORK_SPEED.UNKNOWN;
        }

        // First try effectiveType (most reliable when available)
        if (connection.effectiveType) {
            const mapped = CONFIG.connectionTypeMapping[connection.effectiveType];
            if (mapped) {
                log('Classified by effectiveType: ' + connection.effectiveType + ' -> ' + mapped);
                return mapped;
            }
        }

        // Fallback to downlink speed if available
        if (typeof connection.downlink === 'number') {
            const downlink = connection.downlink;
            if (downlink >= CONFIG.downlinkThresholds.fast) {
                log('Classified by downlink: ' + downlink + ' Mbps -> fast');
                return NETWORK_SPEED.FAST;
            } else if (downlink >= CONFIG.downlinkThresholds.medium) {
                log('Classified by downlink: ' + downlink + ' Mbps -> medium');
                return NETWORK_SPEED.MEDIUM;
            } else {
                log('Classified by downlink: ' + downlink + ' Mbps -> slow');
                return NETWORK_SPEED.SLOW;
            }
        }

        // If saveData is enabled, assume slow/constrained
        if (connection.saveData) {
            log('saveData enabled, classifying as slow');
            return NETWORK_SPEED.SLOW;
        }

        return NETWORK_SPEED.UNKNOWN;
    }

    /**
     * Handle connection change event
     */
    function onConnectionChange() {
        const connection = navigator.connection ||
            navigator.mozConnection ||
            navigator.webkitConnection;

        const newSpeed = classifyFromConnectionApi(connection);

        if (newSpeed !== currentSpeed) {
            const oldSpeed = currentSpeed;
            currentSpeed = newSpeed;
            log('Network speed changed: ' + oldSpeed + ' -> ' + newSpeed);
            notifyListeners(newSpeed, oldSpeed);
        }
    }

    /**
     * Record a tile load time for fallback classification
     * Call this when a tile finishes loading to help detect network speed
     * @param {number} loadTimeMs - Time taken to load the tile in milliseconds
     */
    function recordTileLoad(loadTimeMs) {
        if (connectionApiSupported) {
            // Connection API available, no need for fallback
            return;
        }

        if (typeof loadTimeMs !== 'number' || loadTimeMs < 0) {
            return;
        }

        tileLoadSamples.push({
            time: loadTimeMs,
            timestamp: Date.now()
        });

        // Keep only recent samples (last 30 seconds) and enforce max limit
        const cutoff = Date.now() - 30000;
        tileLoadSamples = tileLoadSamples.filter(function(s) {
            return s.timestamp > cutoff;
        });

        // Drop oldest samples if over limit
        if (tileLoadSamples.length > CONFIG.maxSamples) {
            tileLoadSamples = tileLoadSamples.slice(-CONFIG.maxSamples);
        }

        // Try to classify once we have enough samples
        if (tileLoadSamples.length >= CONFIG.minSamples) {
            classifyFromTileLoads();
        }
    }

    /**
     * Classify network speed from recorded tile load times
     * Uses hysteresis to prevent rapid oscillation - requires HYSTERESIS_THRESHOLD
     * consecutive classifications to a new state before transitioning.
     */
    function classifyFromTileLoads() {
        if (tileLoadSamples.length < CONFIG.minSamples) {
            return;
        }

        // Calculate average tile load time
        const total = tileLoadSamples.reduce(function(sum, s) {
            return sum + s.time;
        }, 0);
        const avg = total / tileLoadSamples.length;

        let classifiedSpeed;
        if (avg <= CONFIG.tileLoadThresholds.fast) {
            classifiedSpeed = NETWORK_SPEED.FAST;
        } else if (avg <= CONFIG.tileLoadThresholds.medium) {
            classifiedSpeed = NETWORK_SPEED.MEDIUM;
        } else {
            classifiedSpeed = NETWORK_SPEED.SLOW;
        }

        // If classified to current state, reset hysteresis
        if (classifiedSpeed === currentSpeed) {
            pendingState = null;
            consecutiveCount = 0;
            return;
        }

        // If classified to a new pending state, reset counter
        if (classifiedSpeed !== pendingState) {
            pendingState = classifiedSpeed;
            consecutiveCount = 1;
            log('New pending state: ' + pendingState + ' (1/' + HYSTERESIS_THRESHOLD + ')');
            return;
        }

        // Same pending state - increment counter
        consecutiveCount++;
        log('Pending state: ' + pendingState + ' (' + consecutiveCount + '/' + HYSTERESIS_THRESHOLD + ')');

        // Only transition after threshold consecutive classifications
        if (consecutiveCount >= HYSTERESIS_THRESHOLD) {
            const oldSpeed = currentSpeed;
            currentSpeed = classifiedSpeed;
            pendingState = null;
            consecutiveCount = 0;
            log('Network speed classified from tile loads (avg=' + Math.round(avg) + 'ms): ' + oldSpeed + ' -> ' + currentSpeed);
            notifyListeners(currentSpeed, oldSpeed);
        }
    }

    /**
     * Get current network speed classification
     * @returns {string} One of: 'fast', 'medium', 'slow', 'unknown'
     */
    function getSpeed() {
        return currentSpeed;
    }

    /**
     * Check if network is slow
     * @returns {boolean} True if network is classified as slow
     */
    function isSlow() {
        return currentSpeed === NETWORK_SPEED.SLOW;
    }

    /**
     * Check if network is fast
     * @returns {boolean} True if network is classified as fast
     */
    function isFast() {
        return currentSpeed === NETWORK_SPEED.FAST;
    }

    /**
     * Add a listener for network speed changes
     * @param {function} callback - Called with (newSpeed, oldSpeed) on change
     * @returns {function} Unsubscribe function
     */
    function addChangeListener(callback) {
        if (typeof callback !== 'function') {
            return function() {};
        }

        listeners.push(callback);

        return function unsubscribe() {
            const index = listeners.indexOf(callback);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        };
    }

    /**
     * Notify all listeners of a speed change
     * @param {string} newSpeed - New network speed
     * @param {string} oldSpeed - Previous network speed
     */
    function notifyListeners(newSpeed, oldSpeed) {
        listeners.forEach(function(callback) {
            try {
                callback(newSpeed, oldSpeed);
            } catch (e) {
                console.error('[evostitch] NetworkDetect listener error:', e);
            }
        });
    }

    /**
     * Get detailed network information
     * @returns {Object} Network state and diagnostics
     */
    function getInfo() {
        const info = {
            speed: currentSpeed,
            connectionApiSupported: connectionApiSupported,
            fallbackSamples: tileLoadSamples.length
        };

        if (connectionApiSupported) {
            const connection = navigator.connection ||
                navigator.mozConnection ||
                navigator.webkitConnection;

            if (connection) {
                info.effectiveType = connection.effectiveType || null;
                info.downlink = connection.downlink || null;
                info.rtt = connection.rtt || null;
                info.saveData = connection.saveData || false;
            }
        } else if (tileLoadSamples.length > 0) {
            const total = tileLoadSamples.reduce(function(sum, s) {
                return sum + s.time;
            }, 0);
            info.avgTileLoadMs = Math.round(total / tileLoadSamples.length);
        }

        return info;
    }

    /**
     * Reset fallback detection (clear samples and hysteresis state)
     */
    function resetFallback() {
        tileLoadSamples = [];
        pendingState = null;
        consecutiveCount = 0;
        if (!connectionApiSupported) {
            currentSpeed = NETWORK_SPEED.UNKNOWN;
        }
        log('Fallback samples reset');
    }

    /**
     * Destroy the detector and clean up
     */
    function destroy() {
        if (connectionApiSupported) {
            const connection = navigator.connection ||
                navigator.mozConnection ||
                navigator.webkitConnection;

            if (connection && connection.removeEventListener) {
                connection.removeEventListener('change', onConnectionChange);
            }
        }

        listeners = [];
        tileLoadSamples = [];
        pendingState = null;
        consecutiveCount = 0;
        currentSpeed = NETWORK_SPEED.UNKNOWN;
        log('Destroyed');
    }

    /**
     * Debug logging
     */
    function log(message) {
        if (CONFIG.debug) {
            console.log('[evostitch] NetworkDetect: ' + message);
        }
    }

    // Expose public API
    window.evostitch = window.evostitch || {};
    window.evostitch.networkDetect = {
        init: init,
        getSpeed: getSpeed,
        isSlow: isSlow,
        isFast: isFast,
        recordTileLoad: recordTileLoad,
        addChangeListener: addChangeListener,
        getInfo: getInfo,
        resetFallback: resetFallback,
        destroy: destroy,
        setDebug: function(enabled) { CONFIG.debug = enabled; },
        // Expose constants for testing
        NETWORK_SPEED: NETWORK_SPEED,
        CONFIG: CONFIG
    };

})();
