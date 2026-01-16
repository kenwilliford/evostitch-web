// evostitch Quality Adaptation - W4 Adaptive Quality
// Adjusts tile quality based on network conditions
// Slow network: limits zoom to lower-resolution tiles
// Progressive enhancement: upgrades to full quality as bandwidth allows
// User override: manual quality setting

(function() {
    'use strict';

    // Quality levels with their zoom constraints
    const QUALITY = {
        HIGH: 'high',      // Full resolution, no constraints
        MEDIUM: 'medium',  // Skip top 2 zoom levels
        LOW: 'low',        // Skip top 4 zoom levels
        AUTO: 'auto'       // Determined by network speed
    };

    // Configuration
    const CONFIG = {
        // Levels to skip from max for each quality
        levelReduction: {
            high: 0,
            medium: 2,
            low: 4
        },
        // Network speed to quality mapping
        networkToQuality: {
            fast: QUALITY.HIGH,
            medium: QUALITY.MEDIUM,
            slow: QUALITY.LOW,
            unknown: QUALITY.MEDIUM  // Conservative default
        },
        // Delay before attempting quality upgrade (ms)
        upgradeDelay: 5000,
        // Minimum tiles loaded at current quality before considering upgrade
        minTilesBeforeUpgrade: 20,
        // Enable debug logging
        debug: false
    };

    // State
    let viewer = null;
    let currentQuality = QUALITY.AUTO;
    let effectiveQuality = QUALITY.HIGH;  // Actual quality being used
    let originalMaxZoomPixelRatio = null;
    let networkListener = null;
    let upgradeTimeout = null;
    let tilesLoadedAtCurrentQuality = 0;
    let enabled = false;
    let manualOverride = false;  // True if user set quality manually
    let qualityChangeListeners = [];
    let maxSourceLevel = null;  // Cache the source's max level

    /**
     * Initialize quality adaptation with an OpenSeadragon viewer
     * @param {OpenSeadragon.Viewer} osdViewer - The OpenSeadragon viewer instance
     * @param {Object} options - Configuration options
     * @returns {boolean} True if initialization successful
     */
    function init(osdViewer, options = {}) {
        if (!osdViewer) {
            console.error('[evostitch] QualityAdapt: Invalid viewer instance');
            return false;
        }

        viewer = osdViewer;
        originalMaxZoomPixelRatio = viewer.maxZoomPixelRatio;

        // Apply any custom config
        if (options.levelReduction) {
            Object.assign(CONFIG.levelReduction, options.levelReduction);
        }
        if (options.upgradeDelay) {
            CONFIG.upgradeDelay = options.upgradeDelay;
        }

        // Set up network detection listener
        if (window.evostitch && window.evostitch.networkDetect) {
            window.evostitch.networkDetect.init();
            networkListener = window.evostitch.networkDetect.addChangeListener(onNetworkChange);
        }

        // Set up tile loaded handler for progressive enhancement
        viewer.addHandler('tile-loaded', onTileLoaded);

        // Wait for first image to be opened to get source info
        viewer.addHandler('open', onViewerOpen);
        viewer.addHandler('add-item', onItemAdded);

        enabled = true;

        // Set initial quality based on current network
        updateEffectiveQuality();

        log('Initialized, effectiveQuality=' + effectiveQuality);
        return true;
    }

    /**
     * Handle viewer open event
     */
    function onViewerOpen() {
        cacheSourceMaxLevel();
        applyQualityConstraints();
    }

    /**
     * Handle item added event (for multi-image/Z-stack viewers)
     */
    function onItemAdded() {
        cacheSourceMaxLevel();
        applyQualityConstraints();
    }

    /**
     * Cache the maximum source level for zoom calculations
     */
    function cacheSourceMaxLevel() {
        if (!viewer || !viewer.world) return;

        const itemCount = viewer.world.getItemCount();
        if (itemCount === 0) return;

        // Use first item's source to determine max level
        const item = viewer.world.getItemAt(0);
        if (item && item.source) {
            maxSourceLevel = item.source.maxLevel;
            log('Cached maxSourceLevel=' + maxSourceLevel);
        }
    }

    /**
     * Handle network speed change
     * @param {string} newSpeed - New network speed classification
     * @param {string} oldSpeed - Previous network speed classification
     */
    function onNetworkChange(newSpeed, oldSpeed) {
        log('Network changed: ' + oldSpeed + ' -> ' + newSpeed);

        // Only react if in auto mode
        if (currentQuality !== QUALITY.AUTO || manualOverride) {
            return;
        }

        updateEffectiveQuality();
        applyQualityConstraints();

        // Reset upgrade timer
        scheduleUpgradeCheck();
    }

    /**
     * Handle tile loaded event for progressive enhancement
     * @param {Object} event - OpenSeadragon tile-loaded event
     */
    function onTileLoaded(event) {
        tilesLoadedAtCurrentQuality++;

        // Record tile load time for network detection fallback
        if (window.evostitch && window.evostitch.networkDetect) {
            const tile = event && event.tile;
            if (tile) {
                // Get tile URL (use getUrl() to avoid deprecation warning)
                const tileUrl = tile.getUrl ? tile.getUrl() : tile.url;

                // Use PerformanceResourceTiming API to get actual load time
                if (tileUrl && typeof performance !== 'undefined' && performance.getEntriesByName) {
                    const entries = performance.getEntriesByName(tileUrl, 'resource');
                    if (entries.length > 0) {
                        // Use most recent entry (in case of retries)
                        const timing = entries[entries.length - 1];
                        const loadTimeMs = Math.round(timing.duration);
                        window.evostitch.networkDetect.recordTileLoad(loadTimeMs);
                    }
                }
            }
        }
    }

    /**
     * Update effective quality based on network speed
     */
    function updateEffectiveQuality() {
        if (currentQuality !== QUALITY.AUTO) {
            effectiveQuality = currentQuality;
            return;
        }

        // Get current network speed
        let speed = 'unknown';
        if (window.evostitch && window.evostitch.networkDetect) {
            speed = window.evostitch.networkDetect.getSpeed();
        }

        const oldEffective = effectiveQuality;
        effectiveQuality = CONFIG.networkToQuality[speed] || QUALITY.MEDIUM;

        if (effectiveQuality !== oldEffective) {
            log('Effective quality changed: ' + oldEffective + ' -> ' + effectiveQuality);
            tilesLoadedAtCurrentQuality = 0;
            notifyQualityChange(effectiveQuality, oldEffective);
        }
    }

    /**
     * Apply zoom constraints based on current quality
     */
    function applyQualityConstraints() {
        if (!viewer) return;

        const levelReduction = CONFIG.levelReduction[effectiveQuality] || 0;

        if (levelReduction === 0) {
            // High quality - restore original zoom
            viewer.maxZoomPixelRatio = originalMaxZoomPixelRatio;
            log('Quality HIGH: maxZoomPixelRatio restored to ' + originalMaxZoomPixelRatio);
        } else {
            // Calculate reduced max zoom
            // Each level reduction halves the available resolution
            const reductionFactor = Math.pow(2, levelReduction);
            const newMaxZoom = originalMaxZoomPixelRatio / reductionFactor;
            viewer.maxZoomPixelRatio = Math.max(0.25, newMaxZoom);  // Don't go below 0.25

            log('Quality ' + effectiveQuality.toUpperCase() + ': maxZoomPixelRatio=' +
                viewer.maxZoomPixelRatio + ' (reduced by ' + levelReduction + ' levels)');

            // If currently zoomed beyond new limit, zoom out
            const currentZoom = viewer.viewport.getZoom();
            const maxAllowedZoom = viewer.viewport.getMaxZoom();
            if (currentZoom > maxAllowedZoom) {
                viewer.viewport.zoomTo(maxAllowedZoom, null, true);
                log('Zoomed out to comply with quality constraint');
            }
        }
    }

    /**
     * Schedule an upgrade check after delay
     */
    function scheduleUpgradeCheck() {
        if (upgradeTimeout) {
            clearTimeout(upgradeTimeout);
        }

        // Only schedule if not at highest quality
        if (effectiveQuality === QUALITY.HIGH) {
            return;
        }

        upgradeTimeout = setTimeout(function() {
            checkForUpgrade();
        }, CONFIG.upgradeDelay);
    }

    /**
     * Check if we should upgrade quality
     */
    function checkForUpgrade() {
        if (!enabled || manualOverride) return;
        if (currentQuality !== QUALITY.AUTO) return;
        if (effectiveQuality === QUALITY.HIGH) return;

        // Need enough tiles loaded to assess performance
        if (tilesLoadedAtCurrentQuality < CONFIG.minTilesBeforeUpgrade) {
            log('Not enough tiles loaded for upgrade check (' +
                tilesLoadedAtCurrentQuality + '/' + CONFIG.minTilesBeforeUpgrade + ')');
            scheduleUpgradeCheck();
            return;
        }

        // Check network conditions
        if (window.evostitch && window.evostitch.networkDetect) {
            const speed = window.evostitch.networkDetect.getSpeed();
            const targetQuality = CONFIG.networkToQuality[speed] || QUALITY.MEDIUM;

            // Only upgrade if network improved
            if (getQualityRank(targetQuality) > getQualityRank(effectiveQuality)) {
                log('Network improved, upgrading quality: ' + effectiveQuality + ' -> ' + targetQuality);
                const oldQuality = effectiveQuality;
                effectiveQuality = targetQuality;
                tilesLoadedAtCurrentQuality = 0;
                applyQualityConstraints();
                notifyQualityChange(effectiveQuality, oldQuality);

                // Continue checking for further upgrades
                if (effectiveQuality !== QUALITY.HIGH) {
                    scheduleUpgradeCheck();
                }
            } else {
                // Network hasn't improved, check again later
                scheduleUpgradeCheck();
            }
        }
    }

    /**
     * Get numeric rank for quality comparison (higher = better)
     * @param {string} quality - Quality level
     * @returns {number} Rank (0-2)
     */
    function getQualityRank(quality) {
        switch (quality) {
            case QUALITY.HIGH: return 2;
            case QUALITY.MEDIUM: return 1;
            case QUALITY.LOW: return 0;
            default: return 1;
        }
    }

    /**
     * Manually set quality level (user override)
     * @param {string} quality - Quality level: 'high', 'medium', 'low', or 'auto'
     */
    function setQuality(quality) {
        // Normalize input: convert to string and lowercase for consistent comparison
        quality = String(quality).toLowerCase();

        if (!QUALITY[quality.toUpperCase()] && quality !== QUALITY.AUTO) {
            console.error('[evostitch] QualityAdapt: Invalid quality level: ' + quality);
            return;
        }

        const oldQuality = currentQuality;
        currentQuality = quality;
        manualOverride = (quality !== QUALITY.AUTO);

        log('Quality set to ' + quality + (manualOverride ? ' (manual override)' : ''));

        // Update effective quality
        const oldEffective = effectiveQuality;
        updateEffectiveQuality();

        if (effectiveQuality !== oldEffective) {
            applyQualityConstraints();
            notifyQualityChange(effectiveQuality, oldEffective);
        }

        // Reset or start upgrade checking
        if (quality === QUALITY.AUTO) {
            scheduleUpgradeCheck();
        } else if (upgradeTimeout) {
            clearTimeout(upgradeTimeout);
            upgradeTimeout = null;
        }
    }

    /**
     * Get current quality setting
     * @returns {string} Current quality level
     */
    function getQuality() {
        return currentQuality;
    }

    /**
     * Get effective quality (what's actually being used)
     * @returns {string} Effective quality level
     */
    function getEffectiveQuality() {
        return effectiveQuality;
    }

    /**
     * Check if manual override is active
     * @returns {boolean} True if user manually set quality
     */
    function isManualOverride() {
        return manualOverride;
    }

    /**
     * Add a listener for quality changes
     * @param {function} callback - Called with (newQuality, oldQuality) on change
     * @returns {function} Unsubscribe function
     */
    function addChangeListener(callback) {
        if (typeof callback !== 'function') {
            return function() {};
        }

        qualityChangeListeners.push(callback);

        return function unsubscribe() {
            const index = qualityChangeListeners.indexOf(callback);
            if (index !== -1) {
                qualityChangeListeners.splice(index, 1);
            }
        };
    }

    /**
     * Notify all listeners of a quality change
     * @param {string} newQuality - New quality level
     * @param {string} oldQuality - Previous quality level
     */
    function notifyQualityChange(newQuality, oldQuality) {
        qualityChangeListeners.forEach(function(callback) {
            try {
                callback(newQuality, oldQuality);
            } catch (e) {
                console.error('[evostitch] QualityAdapt listener error:', e);
            }
        });
    }

    /**
     * Get detailed state for debugging
     * @returns {Object} Current state
     */
    function getState() {
        return {
            enabled: enabled,
            currentQuality: currentQuality,
            effectiveQuality: effectiveQuality,
            manualOverride: manualOverride,
            maxSourceLevel: maxSourceLevel,
            maxZoomPixelRatio: viewer ? viewer.maxZoomPixelRatio : null,
            originalMaxZoomPixelRatio: originalMaxZoomPixelRatio,
            levelReduction: CONFIG.levelReduction[effectiveQuality],
            tilesLoadedAtCurrentQuality: tilesLoadedAtCurrentQuality,
            upgradeScheduled: upgradeTimeout !== null,
            networkSpeed: window.evostitch && window.evostitch.networkDetect ?
                window.evostitch.networkDetect.getSpeed() : 'unavailable'
        };
    }

    /**
     * Destroy the quality adapter and clean up
     */
    function destroy() {
        if (!enabled) return;

        // Remove network listener
        if (networkListener) {
            networkListener();
            networkListener = null;
        }

        // Clear timeout
        if (upgradeTimeout) {
            clearTimeout(upgradeTimeout);
            upgradeTimeout = null;
        }

        // Remove viewer handlers
        if (viewer) {
            viewer.removeHandler('tile-loaded', onTileLoaded);
            viewer.removeHandler('open', onViewerOpen);
            viewer.removeHandler('add-item', onItemAdded);

            // Restore original zoom constraint
            if (originalMaxZoomPixelRatio !== null) {
                viewer.maxZoomPixelRatio = originalMaxZoomPixelRatio;
            }
        }

        // Clear state
        qualityChangeListeners = [];
        enabled = false;

        log('Destroyed');
    }

    /**
     * Debug logging
     */
    function log(message) {
        if (CONFIG.debug) {
            console.log('[evostitch] QualityAdapt: ' + message);
        }
    }

    // Expose public API
    window.evostitch = window.evostitch || {};
    window.evostitch.qualityAdapt = {
        init: init,
        setQuality: setQuality,
        getQuality: getQuality,
        getEffectiveQuality: getEffectiveQuality,
        isManualOverride: isManualOverride,
        addChangeListener: addChangeListener,
        getState: getState,
        destroy: destroy,
        setDebug: function(enabled) { CONFIG.debug = enabled; },
        // Expose constants for testing and UI
        QUALITY: QUALITY,
        CONFIG: CONFIG
    };

})();
