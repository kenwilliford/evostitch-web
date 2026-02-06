/**
 * zarr-render-opt.js - Rendering optimizations for Zarr/deck.gl viewer
 *
 * Eliminates unnecessary work during Z-plane navigation by:
 * 1. Debouncing rapid Z-scrolling to only render the final position
 * 2. Calculating zoom caps from OME-Zarr metadata
 * 3. Batching deck.gl setProps calls into single RAF frames
 * 4. Tracking layer recreation vs update statistics
 *
 * Depends on: zarr-viewer-bundle.js (MultiscaleImageLayer, Deck)
 */
(function() {
    'use strict';

    // ---------- Configuration ----------

    const CONFIG = {
        /** ms to wait before committing a Z-switch during rapid scrolling */
        zDebounceMs: 50,
        /** Minimum ms between consecutive setProps calls (RAF batching) */
        batchIntervalMs: 0, // 0 = one per RAF
        /** Maximum zoom overshoot past native resolution (in zoom levels) */
        maxZoomOvershoot: 1.0,
        /** Enable debug logging */
        debug: false
    };

    // ---------- State ----------

    let state = {
        initialized: false,
        deck: null,
        loader: null,
        metadata: null,
        axes: null,

        // Debounce state for Z-switches
        pendingZ: null,
        zDebounceTimer: null,
        zDebounceCallback: null,

        // RAF batching state
        pendingProps: null,
        rafId: null,

        // Zoom cap
        maxZoom: Infinity,
        nativeZoom: 0,

        // Stats
        stats: {
            layerRecreations: 0,
            zSwitchCount: 0,
            zSwitchDebouncedCount: 0,
            zSwitchTotalMs: 0,
            zSwitchStartTime: null,
            batchedSetPropsCount: 0,
            droppedSetPropsCount: 0
        }
    };

    // ---------- Debug logging ----------

    function log(msg) {
        if (CONFIG.debug) {
            console.log('[evostitch] zarrRenderOpt: ' + msg);
        }
    }

    // ---------- Core: Z-switch debouncing ----------

    /**
     * Debounced Z-switch. During rapid scrolling (e.g., holding arrow key or
     * dragging Z-slider fast), intermediate Z values are dropped and only the
     * final resting position triggers an actual layer update.
     *
     * @param {number} z - Target Z-plane index
     * @param {Object} channelSettings - Current channel settings for the layer
     * @param {Function} commitFn - Function to call with (z, channelSettings)
     *   when the debounce settles. This should perform the actual updateLayer().
     */
    function updateZ(z, channelSettings, commitFn) {
        state.stats.zSwitchCount++;

        // If there's a pending Z that hasn't committed yet, it gets replaced
        if (state.zDebounceTimer !== null) {
            clearTimeout(state.zDebounceTimer);
            state.stats.zSwitchDebouncedCount++;
            log('Z debounce: dropped intermediate Z=' + state.pendingZ + ', replaced with Z=' + z);
        }

        state.pendingZ = z;
        state.zDebounceCallback = commitFn;

        // Start timing from first Z request in a burst
        if (state.stats.zSwitchStartTime === null) {
            state.stats.zSwitchStartTime = performance.now();
        }

        state.zDebounceTimer = setTimeout(function() {
            var finalZ = state.pendingZ;
            var cb = state.zDebounceCallback;

            state.zDebounceTimer = null;
            state.pendingZ = null;
            state.zDebounceCallback = null;

            log('Z debounce: committing Z=' + finalZ);
            state.stats.layerRecreations++;

            if (cb) {
                cb(finalZ, channelSettings);
            }

            // Record timing
            if (state.stats.zSwitchStartTime !== null) {
                var elapsed = performance.now() - state.stats.zSwitchStartTime;
                state.stats.zSwitchTotalMs += elapsed;
                state.stats.zSwitchStartTime = null;
            }
        }, CONFIG.zDebounceMs);
    }

    /**
     * Cancel any pending debounced Z-switch (e.g., on destroy).
     */
    function cancelPendingZ() {
        if (state.zDebounceTimer !== null) {
            clearTimeout(state.zDebounceTimer);
            state.zDebounceTimer = null;
            state.pendingZ = null;
            state.zDebounceCallback = null;
            state.stats.zSwitchStartTime = null;
        }
    }

    /**
     * Check if a Z update is currently pending (debounce not yet settled).
     * @returns {boolean}
     */
    function isZPending() {
        return state.zDebounceTimer !== null;
    }

    // ---------- Core: Zoom cap from OME-Zarr metadata ----------

    /**
     * Calculate the maximum zoom level from OME-Zarr metadata.
     *
     * deck.gl zoom = log2(screenPixels / dataPixels). At zoom 0, one data pixel
     * maps to one screen pixel. Zooming past 0 shows sub-pixel interpolation
     * (over-zoom). The pyramid's coarsest level is at negative zoom.
     *
     * Viv's MultiscaleImageLayer already sets maxZoom: 0 on its internal
     * TileLayer (see MultiscaleImageLayerBase construction). However, the deck.gl
     * OrthographicView controller doesn't enforce this. This function calculates
     * the appropriate maxZoom for the view controller.
     *
     * @param {Object} metadata - OME-Zarr metadata object
     * @param {Array} loaderData - Array of resolution levels from the loader
     * @returns {number} maxZoom value for deck.gl OrthographicView
     */
    function calculateMaxZoom(metadata, loaderData) {
        // Viv internally uses maxZoom: 0 for the TileLayer, meaning zoom level 0
        // is 1:1 native resolution. Allow a small overshoot for user comfort.
        var nativeZoom = 0;

        // If we have loader data, we can compute from the pyramid structure
        if (loaderData && loaderData.length > 0) {
            // The highest resolution level is at index 0
            // The number of pyramid levels determines the min zoom
            // Native resolution is at zoom 0 in Viv's coordinate system
            nativeZoom = 0;
            log('Native zoom from pyramid: ' + nativeZoom + ' (' + loaderData.length + ' levels)');
        }

        state.nativeZoom = nativeZoom;
        state.maxZoom = nativeZoom + CONFIG.maxZoomOvershoot;

        log('Max zoom set to ' + state.maxZoom + ' (native=' + nativeZoom + ', overshoot=' + CONFIG.maxZoomOvershoot + ')');
        return state.maxZoom;
    }

    /**
     * Clamp a zoom value to the computed maximum.
     * @param {number} zoom - Requested zoom level
     * @returns {number} Clamped zoom level
     */
    function clampZoom(zoom) {
        if (zoom > state.maxZoom) {
            log('Zoom clamped: ' + zoom.toFixed(2) + ' -> ' + state.maxZoom.toFixed(2));
            return state.maxZoom;
        }
        return zoom;
    }

    /**
     * Get the max zoom value. Returns Infinity if not yet calculated.
     * @returns {number}
     */
    function getMaxZoom() {
        return state.maxZoom;
    }

    // ---------- Core: RAF-batched setProps ----------

    /**
     * Batch multiple deck.gl setProps calls into a single requestAnimationFrame.
     *
     * When multiple state changes happen in the same frame (e.g., viewState +
     * layers), calling setProps for each one causes redundant renders. This
     * function merges all pending updates and applies them in one RAF callback.
     *
     * @param {Object} deck - The deck.gl Deck instance
     * @param {Object} props - Props object to merge (same format as deck.setProps)
     */
    function batchSetProps(deck, props) {
        if (!deck) return;

        // Merge into pending props
        if (state.pendingProps === null) {
            state.pendingProps = {};
        }
        Object.assign(state.pendingProps, props);

        state.stats.batchedSetPropsCount++;

        // Schedule a single RAF to flush all pending props
        if (state.rafId === null) {
            state.rafId = requestAnimationFrame(function() {
                var merged = state.pendingProps;
                state.pendingProps = null;
                state.rafId = null;

                if (merged !== null) {
                    deck.setProps(merged);
                    log('Batched setProps flushed: ' + Object.keys(merged).join(', '));
                }
            });
        } else {
            state.stats.droppedSetPropsCount++;
            log('setProps merged into pending batch');
        }
    }

    /**
     * Cancel any pending RAF batch (e.g., on destroy).
     */
    function cancelBatch() {
        if (state.rafId !== null) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
            state.pendingProps = null;
        }
    }

    // ---------- Core: View state coalescing ----------

    /**
     * Coalesce rapid view state changes (zoom/pan) with zoom clamping.
     *
     * Intended as a drop-in for the onViewStateChange callback. Applies zoom
     * cap and batches the setProps call.
     *
     * @param {Object} deck - Deck instance
     * @param {Object} viewState - New view state from deck.gl
     * @returns {Object} The (possibly clamped) view state
     */
    function handleViewStateChange(deck, viewState) {
        // Apply zoom cap
        if (state.maxZoom !== Infinity) {
            viewState = Object.assign({}, viewState, {
                zoom: clampZoom(viewState.zoom)
            });
        }

        // Use batched setProps to coalesce rapid changes
        batchSetProps(deck, { viewState: viewState });

        return viewState;
    }

    // ---------- Initialization / teardown ----------

    /**
     * Initialize the render optimization module.
     *
     * @param {Object} config - Configuration
     * @param {Object} config.deck - deck.gl Deck instance
     * @param {Array}  config.loader - Viv loader data array
     * @param {Object} config.metadata - OME-Zarr metadata
     * @param {Array}  [config.axes] - Axes names array
     */
    function init(config) {
        if (!config) {
            console.error('[evostitch] zarrRenderOpt.init: config required');
            return;
        }

        state.deck = config.deck || null;
        state.loader = config.loader || null;
        state.metadata = config.metadata || null;
        state.axes = config.axes || null;

        // Calculate zoom cap if we have metadata
        if (state.loader) {
            var loaderData = state.loader.data || state.loader;
            calculateMaxZoom(state.metadata, Array.isArray(loaderData) ? loaderData : null);
        }

        state.initialized = true;
        log('Initialized');
    }

    /**
     * Get current statistics.
     * @returns {Object} Stats object
     */
    function getStats() {
        var s = state.stats;
        var avgMs = s.layerRecreations > 0
            ? Math.round(s.zSwitchTotalMs / s.layerRecreations)
            : null;

        return {
            layerRecreations: s.layerRecreations,
            zSwitchCount: s.zSwitchCount,
            zSwitchDebouncedCount: s.zSwitchDebouncedCount,
            zSwitchAvgMs: avgMs,
            batchedSetPropsCount: s.batchedSetPropsCount,
            droppedSetPropsCount: s.droppedSetPropsCount,
            maxZoom: state.maxZoom,
            nativeZoom: state.nativeZoom,
            isZPending: isZPending()
        };
    }

    /**
     * Enable or disable debug logging.
     * @param {boolean} enabled
     */
    function setDebug(enabled) {
        CONFIG.debug = !!enabled;
        log('Debug ' + (CONFIG.debug ? 'enabled' : 'disabled'));
    }

    /**
     * Get the current debounce interval.
     * @returns {number} ms
     */
    function getDebounceMs() {
        return CONFIG.zDebounceMs;
    }

    /**
     * Set the Z debounce interval.
     * @param {number} ms - Debounce interval in milliseconds
     */
    function setDebounceMs(ms) {
        if (typeof ms === 'number' && ms >= 0) {
            CONFIG.zDebounceMs = ms;
            log('Z debounce set to ' + ms + 'ms');
        }
    }

    /**
     * Set the max zoom overshoot past native resolution.
     * @param {number} levels - Zoom levels past native (e.g., 1.0)
     */
    function setMaxZoomOvershoot(levels) {
        if (typeof levels === 'number' && levels >= 0) {
            CONFIG.maxZoomOvershoot = levels;
            state.maxZoom = state.nativeZoom + levels;
            log('Max zoom overshoot set to ' + levels + ', maxZoom=' + state.maxZoom);
        }
    }

    /**
     * Check whether the module has been initialized.
     * @returns {boolean}
     */
    function isInitialized() {
        return state.initialized;
    }

    /**
     * Destroy the module and clean up timers.
     */
    function destroy() {
        cancelPendingZ();
        cancelBatch();
        state.initialized = false;
        state.deck = null;
        state.loader = null;
        state.metadata = null;
        state.axes = null;
        log('Destroyed');
    }

    // ---------- Public API ----------

    window.evostitch = window.evostitch || {};
    window.evostitch.zarrRenderOpt = {
        init: init,
        isInitialized: isInitialized,
        updateZ: updateZ,
        cancelPendingZ: cancelPendingZ,
        isZPending: isZPending,
        calculateMaxZoom: calculateMaxZoom,
        clampZoom: clampZoom,
        getMaxZoom: getMaxZoom,
        setMaxZoomOvershoot: setMaxZoomOvershoot,
        batchSetProps: batchSetProps,
        cancelBatch: cancelBatch,
        handleViewStateChange: handleViewStateChange,
        getStats: getStats,
        setDebug: setDebug,
        getDebounceMs: getDebounceMs,
        setDebounceMs: setDebounceMs,
        destroy: destroy
    };

    log('Module loaded');
})();
