// evostitch Zarr 3D Loader - Explicit "Load 3D" mode for guaranteed smooth Z-focus
// Instead of fighting Viv's tile cache invalidation, this module makes cache-warming
// explicit: the user opts into 3D at a specific viewport, all Z-planes are prefetched,
// and only then does the Z-slider appear. Every Z-switch is a SW cache hit.
//
// State machine: 2D -> LOADING -> 3D_READY -> 2D
//
// Dependencies: zarr-viewport-math.js (viewport geometry), zarr-prefetch.js (resolution/chunk metadata)

(function() {
    'use strict';

    // States
    var STATE_2D = '2D';
    var STATE_LOADING = 'LOADING';
    var STATE_3D_READY = '3D_READY';

    // Configuration
    var CONFIG = {
        maxChunks: 5000,
        concurrency: 6,
        consecutiveErrorLimit: 5,
        debug: false
    };

    // State
    var state = {
        initialized: false,
        mode: STATE_2D,

        // Zarr metadata (set on init from prefetch module)
        zarrStoreUrl: '',
        zCount: 1,
        axes: [],
        getResolutionLevels: function() { return []; },
        dimensionSeparator: '/',
        channelCount: 1,

        // Captured viewport when loading started
        capturedViewState: null,
        capturedLevel: -1,
        capturedTileRange: null,

        // Prefetch orchestration
        abortController: null,
        totalChunks: 0,
        completedChunks: 0,
        consecutiveErrors: 0,
        paused: false,

        // DOM references
        elements: {},

        // Callbacks
        onModeChange: null,
        getViewState: null,
        getContainerSize: null,

        // Throttle for budget estimate updates during pan/zoom
        budgetUpdateTimer: null
    };

    // ========== Viewport Math (from shared module) ==========
    // Uses window.evostitch.viewportMath (loaded via zarr-viewport-math.js)

    var _vpm = window.evostitch && window.evostitch.viewportMath;
    if (!_vpm) {
        console.error('[evostitch] Zarr3DLoader: zarr-viewport-math.js must be loaded first');
    }

    var zoomToLevel = _vpm ? _vpm.zoomToLevel : function() { return 0; };
    var viewStateToBounds = _vpm ? _vpm.viewStateToBounds : function() { return { minX: 0, maxX: 0, minY: 0, maxY: 0 }; };
    var boundsToTileRange = _vpm ? _vpm.boundsToTileRange : function() { return { minTileX: 0, maxTileX: 0, minTileY: 0, maxTileY: 0, tileCountX: 0, tileCountY: 0 }; };

    /**
     * Generate all chunk URLs for the visible viewport across all Z-planes.
     * @param {number} levelIdx - resolution level index
     * @param {Object} tileRange - from boundsToTileRange
     * @param {number} zCount - total Z planes
     * @param {number} channelCount - number of channels
     * @returns {Array} Array of { url, z } objects
     */
    function generateChunkUrls(levelIdx, tileRange, zCount, channelCount) {
        var urls = [];
        var sep = state.dimensionSeparator;
        var base = state.zarrStoreUrl;

        for (var z = 0; z < zCount; z++) {
            for (var c = 0; c < channelCount; c++) {
                for (var ty = tileRange.minTileY; ty <= tileRange.maxTileY; ty++) {
                    for (var tx = tileRange.minTileX; tx <= tileRange.maxTileX; tx++) {
                        var coords = [];
                        for (var a = 0; a < state.axes.length; a++) {
                            var axis = state.axes[a];
                            if (axis === 't') coords.push(0);
                            else if (axis === 'c') coords.push(c);
                            else if (axis === 'z') coords.push(z);
                            else if (axis === 'y') coords.push(ty);
                            else if (axis === 'x') coords.push(tx);
                        }
                        var chunkKey = levelIdx + '/' + coords.join(sep);
                        urls.push({ url: base + '/' + chunkKey, z: z });
                    }
                }
            }
        }
        return urls;
    }

    /**
     * Calculate chunk budget for current viewport.
     * @returns {Object} { total, tilesPerPlane, withinBudget, levelIdx, tileRange }
     */
    function calculateBudget() {
        if (!state.initialized || !state.getViewState || !state.getContainerSize) {
            return { total: 0, tilesPerPlane: 0, withinBudget: false, levelIdx: -1, tileRange: null };
        }

        var viewState = state.getViewState();
        var containerSize = state.getContainerSize();
        if (!viewState || !containerSize) {
            return { total: 0, tilesPerPlane: 0, withinBudget: false, levelIdx: -1, tileRange: null };
        }

        var levels = state.getResolutionLevels();
        var numLevels = levels.length;
        if (numLevels === 0) {
            return { total: 0, tilesPerPlane: 0, withinBudget: false, levelIdx: -1, tileRange: null };
        }

        var levelIdx = zoomToLevel(viewState.zoom, numLevels);
        var levelInfo = levels[levelIdx];
        if (!levelInfo) {
            return { total: 0, tilesPerPlane: 0, withinBudget: false, levelIdx: -1, tileRange: null };
        }

        var bounds = viewStateToBounds(viewState, containerSize);
        var tileRange = boundsToTileRange(bounds, levelInfo, 1);
        var tilesPerPlane = tileRange.tileCountX * tileRange.tileCountY * state.channelCount;
        var total = tilesPerPlane * state.zCount;
        var withinBudget = total <= CONFIG.maxChunks && total > 0;

        return {
            total: total,
            tilesPerPlane: tilesPerPlane,
            withinBudget: withinBudget,
            levelIdx: levelIdx,
            tileRange: tileRange
        };
    }

    // ========== State Machine ==========

    /**
     * Transition to a new state
     * @param {string} newMode - STATE_2D, STATE_LOADING, or STATE_3D_READY
     * @param {string} [reason] - why the transition happened
     */
    function transitionTo(newMode, reason) {
        var oldMode = state.mode;
        if (oldMode === newMode) return;

        log('Transition: ' + oldMode + ' -> ' + newMode + (reason ? ' (' + reason + ')' : ''));
        state.mode = newMode;

        updateUI();

        if (state.onModeChange) {
            state.onModeChange(newMode, oldMode, reason);
        }
    }

    /**
     * Start loading 3D data for current viewport
     */
    function startLoad() {
        if (state.mode !== STATE_2D) return;

        var budget = calculateBudget();
        if (!budget.withinBudget) {
            log('Cannot start load: budget exceeded (' + budget.total + ' > ' + CONFIG.maxChunks + ')');
            return;
        }

        // Capture viewport at load time
        state.capturedViewState = Object.assign({}, state.getViewState());
        state.capturedViewState.target = state.capturedViewState.target.slice();
        state.capturedLevel = budget.levelIdx;
        state.capturedTileRange = Object.assign({}, budget.tileRange);

        // Generate all URLs
        var chunkList = generateChunkUrls(
            budget.levelIdx,
            budget.tileRange,
            state.zCount,
            state.channelCount
        );

        state.totalChunks = chunkList.length;
        state.completedChunks = 0;
        state.consecutiveErrors = 0;
        state.paused = false;

        transitionTo(STATE_LOADING);
        executePrefetch(chunkList);
    }

    /**
     * Cancel loading and return to 2D
     * @param {string} [reason] - reason for cancellation
     */
    function cancelLoad(reason) {
        if (state.mode !== STATE_LOADING) return;

        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }

        state.capturedViewState = null;
        state.capturedLevel = -1;
        state.capturedTileRange = null;

        transitionTo(STATE_2D, reason || 'cancelled');
    }

    /**
     * Exit 3D mode and return to 2D
     * @param {string} [reason] - reason for exit
     */
    function exit3D(reason) {
        if (state.mode !== STATE_3D_READY) return;

        state.capturedViewState = null;
        state.capturedLevel = -1;
        state.capturedTileRange = null;

        transitionTo(STATE_2D, reason || 'user exit');

        // Show toast on auto-exit
        if (reason && reason !== 'user exit') {
            showToast('3D exited: ' + reason);
        }
    }

    // ========== Containment Check ==========

    /**
     * Check if current viewport is still within the loaded 3D region.
     * Called on every viewState change while in 3D_READY mode.
     * @param {Object} viewState - current deck.gl viewState
     */
    function checkContainment(viewState) {
        if (state.mode !== STATE_3D_READY) return;
        if (!state.capturedViewState || state.capturedLevel < 0 || !state.capturedTileRange) return;

        var levels = state.getResolutionLevels();
        var numLevels = levels.length;
        var currentLevel = zoomToLevel(viewState.zoom, numLevels);

        // Different resolution level = different tiles needed
        if (currentLevel !== state.capturedLevel) {
            exit3D('zoom level changed');
            return;
        }

        // Check if visible tiles are within cached range
        var containerSize = state.getContainerSize();
        if (!containerSize) return;

        var bounds = viewStateToBounds(viewState, containerSize);
        var levelInfo = levels[state.capturedLevel];
        if (!levelInfo) return;

        // Compute current tile range without margin (we want to know actual visible tiles)
        var currentRange = boundsToTileRange(bounds, levelInfo, 0);

        // Check containment against captured range (which included margin)
        if (currentRange.minTileX < state.capturedTileRange.minTileX ||
            currentRange.maxTileX > state.capturedTileRange.maxTileX ||
            currentRange.minTileY < state.capturedTileRange.minTileY ||
            currentRange.maxTileY > state.capturedTileRange.maxTileY) {
            exit3D('panned outside loaded region');
        }
    }

    // ========== Prefetch Orchestrator ==========

    /**
     * Execute concurrent prefetch of all chunk URLs.
     * @param {Array} chunkList - Array of { url, z } objects
     */
    function executePrefetch(chunkList) {
        state.abortController = new AbortController();
        var signal = state.abortController.signal;
        var queue = chunkList.slice(); // copy
        var active = 0;

        function onVisibilityChange() {
            if (document.hidden) {
                state.paused = true;
                log('Prefetch paused (page hidden)');
            } else {
                state.paused = false;
                log('Prefetch resumed (page visible)');
                drain();
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange);

        function done() {
            document.removeEventListener('visibilitychange', onVisibilityChange);
        }

        function drain() {
            if (signal.aborted) { done(); return; }
            if (state.paused) return;

            while (active < CONFIG.concurrency && queue.length > 0) {
                var item = queue.shift();
                active++;
                fetchOne(item);
            }

            // All done?
            if (active === 0 && queue.length === 0) {
                done();
                onPrefetchComplete();
            }
        }

        function fetchOne(item) {
            fetch(item.url, {
                signal: signal,
                mode: 'cors',
                credentials: 'omit'
            }).then(function(resp) {
                active--;
                if (signal.aborted) return;

                if (!resp.ok) {
                    state.consecutiveErrors++;
                } else {
                    state.consecutiveErrors = 0;
                }

                state.completedChunks++;
                updateProgress();

                if (state.consecutiveErrors >= CONFIG.consecutiveErrorLimit) {
                    state.paused = true;
                    updateUI(); // show retry
                    return;
                }

                drain();
            }).catch(function(err) {
                active--;
                if (err.name === 'AbortError') return;

                state.consecutiveErrors++;
                state.completedChunks++;
                updateProgress();

                if (state.consecutiveErrors >= CONFIG.consecutiveErrorLimit) {
                    state.paused = true;
                    updateUI();
                    return;
                }

                drain();
            });
        }

        drain();
    }

    /**
     * Called when all chunks have been fetched
     */
    function onPrefetchComplete() {
        if (state.mode !== STATE_LOADING) return;
        state.abortController = null;
        log('Prefetch complete: ' + state.completedChunks + '/' + state.totalChunks);
        transitionTo(STATE_3D_READY);
    }

    /**
     * Resume after error pause
     */
    function retryLoad() {
        if (state.mode !== STATE_LOADING || !state.paused) return;
        state.paused = false;
        state.consecutiveErrors = 0;

        // Rebuild remaining queue (this is a simplified retry — refetch all remaining)
        var budget = calculateBudget();
        if (!budget.withinBudget) {
            cancelLoad('budget changed');
            return;
        }

        var remaining = generateChunkUrls(
            state.capturedLevel,
            state.capturedTileRange,
            state.zCount,
            state.channelCount
        );
        // Skip already completed count
        remaining = remaining.slice(state.completedChunks);

        if (remaining.length === 0) {
            onPrefetchComplete();
        } else {
            executePrefetch(remaining);
        }
    }

    // ========== UI Management ==========

    /**
     * Update progress display during loading
     */
    function updateProgress() {
        var pct = state.totalChunks > 0 ?
            Math.round((state.completedChunks / state.totalChunks) * 100) : 0;

        var els = state.elements;
        if (els.fill) {
            els.fill.style.width = pct + '%';
        }
        if (els.text) {
            if (state.paused) {
                els.text.textContent = 'Error - ';
            } else {
                els.text.textContent = pct + '% (' + state.completedChunks + '/' + state.totalChunks + ')';
            }
        }
    }

    /**
     * Update all UI elements based on current mode
     */
    function updateUI() {
        var els = state.elements;

        // Hide all sections
        if (els.loadBtn) els.loadBtn.style.display = 'none';
        if (els.progress) els.progress.style.display = 'none';
        if (els.sliderWrapper) els.sliderWrapper.style.display = 'none';
        if (els.retryBtn) els.retryBtn.style.display = 'none';

        if (state.mode === STATE_2D) {
            if (els.loadBtn && state.zCount > 1) {
                els.loadBtn.style.display = '';
                updateBudgetEstimate();
            }
        } else if (state.mode === STATE_LOADING) {
            if (els.progress) els.progress.style.display = '';
            if (state.paused && els.retryBtn) {
                els.retryBtn.style.display = '';
            }
            updateProgress();
        } else if (state.mode === STATE_3D_READY) {
            if (els.sliderWrapper) els.sliderWrapper.style.display = 'flex';
        }

        // Also control the outer container visibility
        var container = els.container;
        if (container) {
            container.style.display = (state.zCount > 1) ? 'flex' : 'none';
        }
    }

    /**
     * Update the chunk estimate on the Load 3D button
     */
    function updateBudgetEstimate() {
        var els = state.elements;
        if (!els.estimate || !els.loadBtn) return;

        var budget = calculateBudget();

        if (budget.total === 0) {
            els.estimate.textContent = '';
            els.loadBtn.disabled = true;
            els.loadBtn.title = 'No chunk data available';
        } else if (!budget.withinBudget) {
            els.estimate.textContent = '(~' + budget.total + ' chunks)';
            els.loadBtn.disabled = true;
            els.loadBtn.title = 'Zoom in more to enable 3D (max ' + CONFIG.maxChunks + ' chunks)';
        } else {
            els.estimate.textContent = '(~' + budget.total + ' chunks)';
            els.loadBtn.disabled = false;
            els.loadBtn.title = 'Prefetch all Z-planes for smooth virtual focus';
        }
    }

    /**
     * Show a temporary toast notification
     * @param {string} message
     */
    function showToast(message) {
        var toast = document.createElement('div');
        toast.className = 'load-3d-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Force reflow then add visible class for animation
        void toast.offsetHeight;
        toast.classList.add('visible');

        setTimeout(function() {
            toast.classList.remove('visible');
            setTimeout(function() {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 2500);
    }

    // ========== Public API ==========

    /**
     * Initialize the 3D loader module
     * @param {Object} config
     * @param {string} config.zarrStoreUrl - full zarr store URL
     * @param {number} config.zCount - total Z planes
     * @param {Array} config.axes - axes order
     * @param {Array} config.resolutionLevels - from prefetch module
     * @param {string} config.dimensionSeparator - '/' or '.'
     * @param {number} config.channelCount - number of channels
     * @param {Function} config.getViewState - returns current deck.gl viewState
     * @param {Function} config.getContainerSize - returns { width, height }
     * @param {Function} [config.onModeChange] - callback(newMode, oldMode, reason)
     * @param {Object} [config.options] - override CONFIG values
     */
    function init(config) {
        if (!config || !config.zCount || !config.getViewState || !config.getContainerSize) {
            console.error('[evostitch] Zarr3DLoader: init requires zCount, getViewState, getContainerSize');
            return false;
        }

        state.zarrStoreUrl = (config.zarrStoreUrl || '').replace(/\/$/, '');
        state.zCount = config.zCount;
        state.axes = config.axes || ['t', 'c', 'z', 'y', 'x'];
        state.getResolutionLevels = config.getResolutionLevels || function() { return config.resolutionLevels || []; };
        state.dimensionSeparator = config.dimensionSeparator || '/';
        state.channelCount = config.channelCount || 1;
        state.getViewState = config.getViewState;
        state.getContainerSize = config.getContainerSize;
        state.onModeChange = config.onModeChange || null;

        if (config.options) {
            Object.keys(config.options).forEach(function(key) {
                if (key in CONFIG) CONFIG[key] = config.options[key];
            });
        }

        // Bind DOM elements
        bindElements();

        state.initialized = true;
        state.mode = STATE_2D;

        updateUI();

        log('Initialized: zCount=' + state.zCount +
            ', levels=' + state.getResolutionLevels().length +
            ', channels=' + state.channelCount);

        return true;
    }

    /**
     * Bind DOM element references and attach event listeners
     */
    function bindElements() {
        state.elements = {
            container: document.getElementById('z-controls-container'),
            loadBtn: document.getElementById('load-3d-btn'),
            estimate: document.getElementById('load-3d-estimate'),
            progress: document.getElementById('load-3d-progress'),
            fill: document.getElementById('load-3d-fill'),
            text: document.getElementById('load-3d-text'),
            cancelBtn: document.getElementById('load-3d-cancel'),
            retryBtn: document.getElementById('load-3d-retry'),
            sliderWrapper: document.getElementById('z-slider-wrapper'),
            exitBtn: document.getElementById('exit-3d-btn')
        };

        // Attach event listeners
        if (state.elements.loadBtn) {
            state.elements.loadBtn.addEventListener('click', startLoad);
        }
        if (state.elements.cancelBtn) {
            state.elements.cancelBtn.addEventListener('click', function() {
                cancelLoad('user cancelled');
            });
        }
        if (state.elements.retryBtn) {
            state.elements.retryBtn.addEventListener('click', retryLoad);
        }
        if (state.elements.exitBtn) {
            state.elements.exitBtn.addEventListener('click', function() {
                exit3D('user exit');
            });
        }
    }

    /**
     * Called on every viewState change from deck.gl.
     * In LOADING: cancel if viewport moved.
     * In 3D_READY: check containment.
     * In 2D: update budget estimate.
     * @param {Object} viewState - deck.gl viewState
     */
    function onViewStateChange(viewState) {
        if (!state.initialized) return;

        if (state.mode === STATE_LOADING) {
            // Check if viewport moved from captured position
            if (state.capturedViewState) {
                var dZoom = Math.abs(viewState.zoom - state.capturedViewState.zoom);
                var dx = Math.abs(viewState.target[0] - state.capturedViewState.target[0]);
                var dy = Math.abs(viewState.target[1] - state.capturedViewState.target[1]);
                // Tolerance: small float rounding
                if (dZoom > 0.01 || dx > 1 || dy > 1) {
                    cancelLoad('viewport changed during load');
                }
            }
        } else if (state.mode === STATE_3D_READY) {
            checkContainment(viewState);
        } else if (state.mode === STATE_2D) {
            // Throttle: budget estimate is informational, no need to update every frame
            if (!state.budgetUpdateTimer) {
                state.budgetUpdateTimer = setTimeout(function() {
                    state.budgetUpdateTimer = null;
                    updateBudgetEstimate();
                }, 250);
            }
        }
    }

    /**
     * Get current mode
     * @returns {string} '2D', 'LOADING', or '3D_READY'
     */
    function getMode() {
        return state.mode;
    }

    /**
     * Get loading progress
     * @returns {Object} { completed, total, percent }
     */
    function getProgress() {
        return {
            completed: state.completedChunks,
            total: state.totalChunks,
            percent: state.totalChunks > 0 ?
                Math.round((state.completedChunks / state.totalChunks) * 100) : 0
        };
    }

    /**
     * Check if 3D mode is ready (Z-slider should be shown)
     * @returns {boolean}
     */
    function is3DReady() {
        return state.mode === STATE_3D_READY;
    }

    /**
     * Toggle debug logging
     * @param {boolean} enabled
     */
    function setDebug(enabled) {
        CONFIG.debug = !!enabled;
    }

    /**
     * Clean up
     */
    function destroy() {
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }
        state.initialized = false;
        state.mode = STATE_2D;
        state.capturedViewState = null;
        log('Destroyed');
    }

    /**
     * Debug logging
     */
    function log(message) {
        if (CONFIG.debug) {
            console.log('[evostitch] Zarr3DLoader: ' + message);
        }
    }

    // Expose public API
    window.evostitch = window.evostitch || {};
    window.evostitch.zarr3DLoader = {
        init: init,
        startLoad: startLoad,
        cancelLoad: cancelLoad,
        exit3D: exit3D,
        retryLoad: retryLoad,
        onViewStateChange: onViewStateChange,
        getMode: getMode,
        getProgress: getProgress,
        is3DReady: is3DReady,
        calculateBudget: calculateBudget,
        setDebug: setDebug,
        destroy: destroy,
        // Expose internals for testing
        _internals: {
            zoomToLevel: zoomToLevel,
            viewStateToBounds: viewStateToBounds,
            boundsToTileRange: boundsToTileRange,
            generateChunkUrls: generateChunkUrls,
            CONFIG: CONFIG,
            getState: function() { return state; }
        }
    };

})();
