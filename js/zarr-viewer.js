// evostitch Zarr Viewer - OME-Zarr 3D Explorer using Viv/deck.gl
// ES module for viewing OME-Zarr data with Z-stack navigation

// Import from local bundle (built via npm run build:zarr)
import { loadOmeZarr, MultiscaleImageLayer, Deck, OrthographicView } from 'zarr-viewer-bundle';

// Configuration
const CONFIG = {
    // Default demo data URL - IDR v0.3 dataset (known to work with Viv/vizarr)
    // See: http://viv.gehlenborglab.org
    defaultZarrUrl: 'https://minio-dev.openmicroscopy.org/idr/v0.3/idr0062-blin-nuclearsegmentation/6001240.zarr',
    // evostitch data URL
    evositchBaseUrl: 'https://pub-db7ffa4b7df04b76aaae379c13562977.r2.dev/',
    // Debug logging
    debug: true
};

// Loading indicator helper (uses loading-indicator.js if available)
const loadingUI = {
    show() {
        if (window.evostitch?.loadingIndicator) {
            window.evostitch.loadingIndicator.show();
        }
    },
    hide() {
        if (window.evostitch?.loadingIndicator) {
            window.evostitch.loadingIndicator.hide();
        }
    },
    setProgress(xy, z) {
        if (window.evostitch?.loadingIndicator) {
            window.evostitch.loadingIndicator.setProgress(xy, z);
        }
    }
};

// State
let state = {
    deck: null,
    loader: null,
    metadata: null,
    axes: null,
    currentZ: 0,
    zCount: 1,
    selections: [{ z: 0, c: 0 }],
    initialized: false,
    pixelSizeX: 1,  // µm per pixel (X axis)
    pixelSizeY: 1,  // µm per pixel (Y axis)
    pixelSizeZ: 1,  // µm per Z-plane
    initialViewState: null,  // Stored for reset view
    zTransitionEnabled: true,  // Enable smooth Z-plane transitions
    zTransitionDuration: 100,  // Transition duration in ms (quick fade-in on swap)
    zSwitchGeneration: 0,      // Generation counter for stale Z-switch detection
    zLoadingTimerId: null,       // Delayed loading indicator timer
    // Jank prevention: throttling state for DOM updates during zoom/pan
    scaleBarUpdatePending: false,
    scaleBarLastUpdate: 0,
    coordUpdatePending: false,
    lastMouseX: 0,
    lastMouseY: 0,
    // Channel settings (brightness/contrast)
    channelSettings: [],  // Array of { visible, min, max, defaultMin, defaultMax }
    channelControlsExpanded: true
};

// Throttle config for DOM updates during animations (ms)
const SCALE_BAR_THROTTLE_MS = 100;

// Performance tracking
let perfStats = {
    zSwitchTimes: [],      // Array of Z-switch durations (ms)
    zSwitchStart: null,    // Timestamp when Z-switch started
    pendingZSwitch: false, // Whether a Z-switch is in progress
    maxSamples: 100        // Keep last N samples
};

/**
 * Record start of Z-switch for timing
 */
function perfStartZSwitch() {
    perfStats.zSwitchStart = performance.now();
    perfStats.pendingZSwitch = true;
}

/**
 * Record end of Z-switch and calculate duration
 */
function perfEndZSwitch() {
    if (!perfStats.pendingZSwitch || perfStats.zSwitchStart === null) {
        return;
    }

    const duration = performance.now() - perfStats.zSwitchStart;
    perfStats.zSwitchTimes.push(duration);

    // Keep only last N samples
    if (perfStats.zSwitchTimes.length > perfStats.maxSamples) {
        perfStats.zSwitchTimes.shift();
    }

    perfStats.pendingZSwitch = false;
    perfStats.zSwitchStart = null;

    log(`Z-switch completed in ${duration.toFixed(1)}ms`);
}

/**
 * Get performance statistics
 * @returns {Object} Performance stats including Z-switch timing
 */
function getPerfStats() {
    const times = perfStats.zSwitchTimes;
    if (times.length === 0) {
        return {
            sampleCount: 0,
            avgMs: null,
            minMs: null,
            maxMs: null,
            p50Ms: null,
            p95Ms: null,
            lastMs: null
        };
    }

    // Calculate stats
    const sorted = [...times].sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const avg = sum / times.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const last = times[times.length - 1];

    return {
        sampleCount: times.length,
        avgMs: Math.round(avg),
        minMs: Math.round(min),
        maxMs: Math.round(max),
        p50Ms: Math.round(p50),
        p95Ms: Math.round(p95),
        lastMs: Math.round(last)
    };
}

/**
 * Log performance summary to console
 */
function logPerfSummary() {
    const stats = getPerfStats();
    if (stats.sampleCount === 0) {
        console.log('[evostitch] ZarrViewer: No Z-switch measurements yet');
        return stats;
    }

    console.log(`[evostitch] ZarrViewer Performance:`);
    console.log(`  Z-switch timing (${stats.sampleCount} samples):`);
    console.log(`    Average: ${stats.avgMs}ms`);
    console.log(`    Min: ${stats.minMs}ms, Max: ${stats.maxMs}ms`);
    console.log(`    p50: ${stats.p50Ms}ms, p95: ${stats.p95Ms}ms`);
    return stats;
}

/**
 * Clear performance statistics
 */
function clearPerfStats() {
    perfStats.zSwitchTimes = [];
    perfStats.zSwitchStart = null;
    perfStats.pendingZSwitch = false;
    log('Performance stats cleared');
}

// DOM elements
let elements = {
    viewer: null,
    zSlider: null,
    zDepth: null,
    zIndex: null,
    coordDisplay: null,
    description: null,
    zoomInBtn: null,
    zoomOutBtn: null,
    homeBtn: null,
    scaleBar: null,
    scaleBarLine: null,
    scaleBarLabel: null,
    channelControls: null,
    channelControlsToggle: null,
    channelList: null
};

/**
 * Initialize DOM element references
 */
function initElements() {
    elements.viewer = document.getElementById('viewer');
    elements.zSlider = document.getElementById('z-slider');
    elements.zDepth = document.getElementById('z-depth');
    elements.zIndex = document.getElementById('z-index');
    elements.coordDisplay = document.getElementById('coord-display');
    elements.description = document.getElementById('mosaic-description');
    elements.zoomInBtn = document.getElementById('zoom-in-btn');
    elements.zoomOutBtn = document.getElementById('zoom-out-btn');
    elements.homeBtn = document.getElementById('home-btn');
    elements.scaleBar = document.getElementById('scale-bar');
    elements.scaleBarLine = elements.scaleBar?.querySelector('.scale-bar-line');
    elements.scaleBarLabel = elements.scaleBar?.querySelector('.scale-bar-label');
    elements.channelControls = document.getElementById('channel-controls');
    elements.channelControlsToggle = document.getElementById('channel-controls-toggle');
    elements.channelList = document.getElementById('channel-list');
}

/**
 * Get Zarr URL from URL parameters or use default
 * @returns {string} Zarr URL to load
 */
function getZarrUrl() {
    const params = new URLSearchParams(window.location.search);
    const zarrParam = params.get('zarr');

    if (zarrParam) {
        // If it's a full URL, use as-is
        if (zarrParam.startsWith('http')) {
            return zarrParam;
        }
        // Otherwise, treat as relative to evostitch base
        // bioformats2raw layout puts data in /0/ subdirectory
        return CONFIG.evositchBaseUrl + zarrParam + '/0/';
    }

    return CONFIG.defaultZarrUrl;
}

/**
 * Initialize the deck.gl viewer
 */
function initDeck() {
    const container = elements.viewer;
    if (!container) {
        console.error('[evostitch] Zarr viewer container not found');
        return false;
    }

    // Initial view state - keyed by view ID for named views
    state.viewState = {
        target: [0, 0, 0],
        zoom: -2
    };

    state.deck = new Deck({
        parent: container,
        views: [new OrthographicView({ id: 'ortho', controller: true })],
        initialViewState: state.viewState,
        onViewStateChange: ({ viewState }) => {
            // Apply zoom clamping if render-opt module is active
            if (window.evostitch?.zarrRenderOpt?.isInitialized?.()) {
                viewState = window.evostitch.zarrRenderOpt.handleViewStateChange(state.deck, viewState);
                state.viewState = viewState;
            } else {
                state.viewState = viewState;
                state.deck.setProps({ viewState });
            }
            updateScaleBar();
        },
        layers: []
    });

    log('Deck.gl initialized');
    return true;
}

/**
 * Extract pixel sizes from OME-Zarr metadata
 * @param {Object} metadata - OME-Zarr metadata
 * @param {Array} axes - Axes names array
 */
function extractPixelSizes(metadata, axes) {
    // Default to 1 µm/pixel if not specified
    state.pixelSizeX = 1;
    state.pixelSizeY = 1;
    state.pixelSizeZ = 1;

    const multiscales = metadata?.multiscales?.[0];
    if (!multiscales) return;

    // Try to get scale from coordinateTransformations (OME-Zarr v0.3+)
    const datasets = multiscales.datasets;
    if (datasets && datasets[0]?.coordinateTransformations) {
        const transforms = datasets[0].coordinateTransformations;
        const scaleTransform = transforms.find(t => t.type === 'scale');
        if (scaleTransform?.scale) {
            const scale = scaleTransform.scale;
            // Map scale values to axes
            axes.forEach((axis, idx) => {
                if (idx < scale.length) {
                    if (axis === 'x') state.pixelSizeX = scale[idx];
                    else if (axis === 'y') state.pixelSizeY = scale[idx];
                    else if (axis === 'z') state.pixelSizeZ = scale[idx];
                }
            });
            log(`Pixel sizes from coordinateTransformations: X=${state.pixelSizeX}µm, Y=${state.pixelSizeY}µm, Z=${state.pixelSizeZ}µm`);
        }
    }

    // Also check axes for unit info (some datasets store it there)
    if (multiscales.axes) {
        multiscales.axes.forEach(axisInfo => {
            if (typeof axisInfo === 'object' && axisInfo.unit) {
                log(`Axis ${axisInfo.name}: unit=${axisInfo.unit}`);
            }
        });
    }
}

/**
 * Update channel controls from OME-Zarr omero metadata
 * Creates visibility toggles and brightness/contrast sliders per channel
 * @param {Object} metadata - OME-Zarr metadata
 */
function updateChannelControls(metadata) {
    if (!elements.channelControls || !elements.channelList) {
        return;
    }

    const omero = metadata?.omero;
    if (!omero?.channels || omero.channels.length === 0) {
        // No channel info available - keep controls hidden
        return;
    }

    // Initialize channel settings from metadata
    state.channelSettings = omero.channels.map(ch => {
        const minVal = ch.window?.start ?? 0;
        const maxVal = ch.window?.end ?? 65535;
        return {
            visible: true,
            min: minVal,
            max: maxVal,
            defaultMin: minVal,
            defaultMax: maxVal
        };
    });

    // Clear existing items
    elements.channelList.innerHTML = '';

    // Create item for each channel
    omero.channels.forEach((channel, idx) => {
        const item = document.createElement('div');
        item.className = 'channel-item';

        // Header row with visibility, color, and name
        const header = document.createElement('div');
        header.className = 'channel-header';

        // Visibility checkbox
        const visibility = document.createElement('input');
        visibility.type = 'checkbox';
        visibility.className = 'channel-visibility';
        visibility.checked = true;
        visibility.title = 'Toggle visibility';
        visibility.addEventListener('change', () => {
            state.channelSettings[idx].visible = visibility.checked;
            updateLayer();
            log(`Channel ${idx} visibility: ${visibility.checked}`);
        });

        // Color swatch
        const colorSwatch = document.createElement('div');
        colorSwatch.className = 'channel-color';
        const colorHex = channel.color || 'FFFFFF';
        colorSwatch.style.backgroundColor = `#${colorHex}`;

        // Channel name
        const nameLabel = document.createElement('span');
        nameLabel.className = 'channel-name';
        nameLabel.textContent = channel.label || `Channel ${idx + 1}`;
        nameLabel.title = channel.label || `Channel ${idx + 1}`;

        header.appendChild(visibility);
        header.appendChild(colorSwatch);
        header.appendChild(nameLabel);
        item.appendChild(header);

        // Sliders container
        const sliders = document.createElement('div');
        sliders.className = 'channel-sliders';

        // Min slider (black point / brightness)
        const minRow = createSliderRow('B', 0, 65535, state.channelSettings[idx].min, (val) => {
            state.channelSettings[idx].min = val;
            // Ensure min doesn't exceed max
            if (val >= state.channelSettings[idx].max) {
                state.channelSettings[idx].min = state.channelSettings[idx].max - 1;
            }
            updateLayer();
        });
        sliders.appendChild(minRow);

        // Max slider (white point / contrast)
        const maxRow = createSliderRow('C', 0, 65535, state.channelSettings[idx].max, (val) => {
            state.channelSettings[idx].max = val;
            // Ensure max doesn't go below min
            if (val <= state.channelSettings[idx].min) {
                state.channelSettings[idx].max = state.channelSettings[idx].min + 1;
            }
            updateLayer();
        });
        sliders.appendChild(maxRow);

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'channel-reset-btn';
        resetBtn.textContent = 'Reset';
        resetBtn.title = 'Reset to default values';
        resetBtn.addEventListener('click', () => {
            state.channelSettings[idx].min = state.channelSettings[idx].defaultMin;
            state.channelSettings[idx].max = state.channelSettings[idx].defaultMax;
            state.channelSettings[idx].visible = true;
            // Update slider values in UI
            const sliderInputs = item.querySelectorAll('.channel-slider');
            const sliderValues = item.querySelectorAll('.channel-slider-value');
            if (sliderInputs[0]) {
                sliderInputs[0].value = state.channelSettings[idx].min;
                sliderValues[0].textContent = state.channelSettings[idx].min;
            }
            if (sliderInputs[1]) {
                sliderInputs[1].value = state.channelSettings[idx].max;
                sliderValues[1].textContent = state.channelSettings[idx].max;
            }
            visibility.checked = true;
            updateLayer();
            log(`Channel ${idx} reset to defaults`);
        });
        sliders.appendChild(resetBtn);

        item.appendChild(sliders);
        elements.channelList.appendChild(item);
    });

    // Set up toggle button for expand/collapse
    if (elements.channelControlsToggle) {
        elements.channelControlsToggle.addEventListener('click', toggleChannelControls);
    }

    // Show the controls
    elements.channelControls.style.display = 'block';
    log(`Channel controls updated: ${omero.channels.length} channels`);
}

/**
 * Create a slider row for brightness/contrast control
 * @param {string} label - Short label (B for brightness/black point, C for contrast/white point)
 * @param {number} min - Minimum slider value
 * @param {number} max - Maximum slider value
 * @param {number} value - Initial value
 * @param {Function} onChange - Callback when value changes
 * @returns {HTMLElement} The slider row element
 */
function createSliderRow(label, min, max, value, onChange) {
    const row = document.createElement('div');
    row.className = 'channel-slider-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'channel-slider-label';
    labelEl.textContent = label;
    labelEl.title = label === 'B' ? 'Black point (brightness)' : 'White point (contrast)';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'channel-slider';
    slider.min = min;
    slider.max = max;
    slider.value = value;

    const valueEl = document.createElement('span');
    valueEl.className = 'channel-slider-value';
    valueEl.textContent = value;

    slider.addEventListener('input', () => {
        const val = parseInt(slider.value, 10);
        valueEl.textContent = val;
        onChange(val);
    });

    row.appendChild(labelEl);
    row.appendChild(slider);
    row.appendChild(valueEl);
    return row;
}

/**
 * Toggle channel controls expand/collapse
 */
function toggleChannelControls() {
    state.channelControlsExpanded = !state.channelControlsExpanded;
    if (elements.channelControls) {
        elements.channelControls.classList.toggle('collapsed', !state.channelControlsExpanded);
    }
    log(`Channel controls ${state.channelControlsExpanded ? 'expanded' : 'collapsed'}`);
}

/**
 * Update coordinate display based on mouse position (core implementation)
 * @param {number} screenX - Mouse X position relative to viewer
 * @param {number} screenY - Mouse Y position relative to viewer
 */
function updateCoordinatesCore(screenX, screenY) {
    if (!elements.coordDisplay || !state.viewState) {
        return;
    }

    const container = elements.viewer;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    // Convert screen to data coordinates
    // zoom = log2(scale), so scale = 2^zoom
    const scale = Math.pow(2, state.viewState.zoom);

    // Center of screen in data coordinates is target
    const centerX = state.viewState.target[0];
    const centerY = state.viewState.target[1];

    // Offset from center in screen pixels
    const offsetXScreen = screenX - containerWidth / 2;
    const offsetYScreen = screenY - containerHeight / 2;

    // Convert screen offset to data offset (divide by scale)
    const dataX = centerX + offsetXScreen / scale;
    const dataY = centerY + offsetYScreen / scale;

    // Clamp to image bounds
    const clampedX = Math.max(0, Math.min(state.imageWidth || 0, dataX));
    const clampedY = Math.max(0, Math.min(state.imageHeight || 0, dataY));

    // Convert data coordinates to µm
    const xMicrons = clampedX * state.pixelSizeX;
    const yMicrons = clampedY * state.pixelSizeY;

    // Format the display with Z plane info
    elements.coordDisplay.textContent = `X: ${xMicrons.toFixed(1)} µm, Y: ${yMicrons.toFixed(1)} µm, Z: ${state.currentZ + 1}/${state.zCount}`;

    state.coordUpdatePending = false;
}

/**
 * Update coordinate display with requestAnimationFrame batching
 * Prevents jank from rapid mousemove events during zoom/pan
 * @param {number} screenX - Mouse X position relative to viewer
 * @param {number} screenY - Mouse Y position relative to viewer
 */
function updateCoordinates(screenX, screenY) {
    // Store latest mouse position
    state.lastMouseX = screenX;
    state.lastMouseY = screenY;

    // Schedule update if not already pending
    if (!state.coordUpdatePending) {
        state.coordUpdatePending = true;
        requestAnimationFrame(() => {
            if (state.coordUpdatePending) {
                updateCoordinatesCore(state.lastMouseX, state.lastMouseY);
            }
        });
    }
}

/**
 * Update coordinate display to show only Z info (when mouse not hovering)
 */
function updateCoordinatesZOnly() {
    if (!elements.coordDisplay) return;
    elements.coordDisplay.textContent = `Z: ${state.currentZ + 1}/${state.zCount}`;
}

/**
 * Update scale bar based on current zoom level (core implementation)
 * @param {boolean} force - If true, bypass throttling
 */
function updateScaleBarCore() {
    if (!elements.scaleBar || !elements.scaleBarLine || !elements.scaleBarLabel) {
        return;
    }

    if (!state.viewState) {
        return;
    }

    // Calculate pixels per µm at current zoom
    // zoom = log2(scale), so scale = 2^zoom
    const scale = Math.pow(2, state.viewState.zoom);
    // scale tells us how many screen pixels per data pixel
    // µm per screen pixel = pixelSize / scale
    const umPerScreenPixel = state.pixelSizeX / scale;

    // Choose a "nice" scale bar value (in µm)
    // Nice values: 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, etc.
    const niceValues = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

    // Target scale bar width in pixels (aim for 80-150 pixels)
    const targetPixels = 100;
    const targetUm = targetPixels * umPerScreenPixel;

    // Find the nice value closest to our target
    let scaleBarUm = niceValues[0];
    for (const val of niceValues) {
        if (val <= targetUm * 1.5) {
            scaleBarUm = val;
        }
    }

    // Calculate actual pixel width for the chosen value
    const scaleBarPixels = scaleBarUm / umPerScreenPixel;

    // Update DOM
    elements.scaleBarLine.style.width = `${Math.round(scaleBarPixels)}px`;

    // Format label (use mm for values >= 1000 µm)
    let label;
    if (scaleBarUm >= 1000) {
        label = `${scaleBarUm / 1000} mm`;
    } else {
        label = `${scaleBarUm} µm`;
    }
    elements.scaleBarLabel.textContent = label;

    state.scaleBarLastUpdate = performance.now();
    state.scaleBarUpdatePending = false;
}

/**
 * Update scale bar with throttling to prevent jank during rapid zoom/pan
 * Uses requestAnimationFrame to batch updates
 */
function updateScaleBar() {
    const now = performance.now();
    const timeSinceLastUpdate = now - state.scaleBarLastUpdate;

    // If enough time has passed, update immediately
    if (timeSinceLastUpdate >= SCALE_BAR_THROTTLE_MS) {
        updateScaleBarCore();
        return;
    }

    // Otherwise, schedule an update if not already pending
    if (!state.scaleBarUpdatePending) {
        state.scaleBarUpdatePending = true;
        requestAnimationFrame(() => {
            // Only update if still pending (not cancelled by a forced update)
            if (state.scaleBarUpdatePending) {
                updateScaleBarCore();
            }
        });
    }
}

/**
 * Load OME-Zarr data from URL
 * @param {string} url - OME-Zarr URL
 */
async function loadZarr(url) {
    log('Loading OME-Zarr from: ' + url);
    state.zarrStoreUrl = url;

    // Show loading indicator
    loadingUI.show();
    loadingUI.setProgress(0.1, 0);  // Initial progress

    if (elements.description) {
        elements.description.textContent = 'Loading Zarr data...';
    }

    try {
        // type: "multiscales" is required for OME-NGFF format
        const result = await loadOmeZarr(url, { type: "multiscales" });
        loadingUI.setProgress(0.5, 0.5);  // Metadata loaded
        state.loader = result;

        // Extract metadata
        if (result.metadata) {
            state.metadata = result.metadata;
            log('Metadata loaded: ' + JSON.stringify(Object.keys(result.metadata)));
        }

        // Get dimensions from metadata or data shape
        const data = result.data || result;
        const metadata = result.metadata;

        // Determine axes order from metadata
        let axes = ['t', 'c', 'z', 'y', 'x']; // default assumption
        if (metadata?.multiscales?.[0]?.axes) {
            const axesInfo = metadata.multiscales[0].axes;
            // axes can be array of strings or array of objects with 'name' property
            axes = axesInfo.map(a => typeof a === 'string' ? a : a.name);
            log('Axes from metadata: ' + JSON.stringify(axes));
        }
        state.axes = axes;

        // Extract pixel sizes from coordinate transformations
        extractPixelSizes(metadata, axes);

        // Update channel controls from omero metadata
        updateChannelControls(metadata);

        if (Array.isArray(data) && data.length > 0) {
            const shape = data[0].shape;
            log('Data shape: ' + JSON.stringify(shape));

            // Find Z dimension index based on axes
            const zIndex = axes.indexOf('z');
            if (zIndex >= 0 && zIndex < shape.length) {
                state.zCount = shape[zIndex];
            } else if (shape.length === 3) {
                // Assume [z, y, x] for 3D data
                state.zCount = shape[0];
            } else {
                state.zCount = 1;
            }
            log('Z-planes detected: ' + state.zCount);

            // Set up selections based on axes (exclude y, x)
            state.selections = [{}];
            axes.forEach((axis, idx) => {
                if (axis !== 'y' && axis !== 'x') {
                    state.selections[0][axis] = 0;
                }
            });
            log('Initial selections: ' + JSON.stringify(state.selections));
        }

        if (elements.description) {
            elements.description.textContent = `Loaded: ${state.zCount} Z-planes`;
        }

        // Update Z slider range
        updateZSlider();

        // Center view on the image
        if (Array.isArray(data) && data.length > 0) {
            const shape = data[0].shape;
            // Get x and y dimensions (last two in axes order)
            const xIdx = axes.indexOf('x');
            const yIdx = axes.indexOf('y');
            const width = xIdx >= 0 ? shape[xIdx] : shape[shape.length - 1];
            const height = yIdx >= 0 ? shape[yIdx] : shape[shape.length - 2];
            log('Image dimensions: ' + width + ' x ' + height);

            // Store dimensions for later use
            state.imageWidth = width;
            state.imageHeight = height;

            // Calculate zoom to fit image in view
            const container = elements.viewer;
            const containerWidth = container?.offsetWidth || 800;
            const containerHeight = container?.offsetHeight || 600;
            const scaleX = containerWidth / width;
            const scaleY = containerHeight / height;
            const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to add margin
            const zoom = Math.log2(scale);
            log('Calculated zoom: ' + zoom);

            // Update view state to center on image
            state.viewState = {
                target: [width / 2, height / 2, 0],
                zoom: zoom
            };
            // Store initial view state for reset functionality
            state.initialViewState = { ...state.viewState };
            state.deck.setProps({ viewState: state.viewState });

            // Update scale bar with initial zoom
            updateScaleBar();
        }

        // Initialize optimization modules if available
        initOptimizationModules();

        // Mark load progress complete (tiles will trigger final completion)
        loadingUI.setProgress(0.8, 0.8);
        return true;
    } catch (error) {
        console.error('[evostitch] Failed to load OME-Zarr:', error);
        loadingUI.hide();  // Hide on error
        if (elements.description) {
            elements.description.textContent = 'Error loading Zarr: ' + error.message;
        }
        return false;
    }
}

/**
 * Initialize optimization modules (prefetch, render-opt, cache) if available.
 * These are loaded as IIFE scripts and attach to window.evostitch.
 */
function initOptimizationModules() {
    const loaderData = state.loader?.data || state.loader;

    // Initialize zarr cache layer
    if (window.evostitch?.zarrCache) {
        try {
            window.evostitch.zarrCache.init({
                baseUrl: CONFIG.evositchBaseUrl,
                maxCacheSize: 500 * 1024 * 1024, // 500MB
                maxConcurrent: 8
            });
            log('Zarr cache module initialized');
        } catch (e) {
            console.warn('[evostitch] Failed to init zarr-cache:', e);
        }
    }

    // Initialize zarr prefetch engine
    // Pass the full zarr store URL so prefetch URLs match Viv's actual fetch URLs
    if (window.evostitch?.zarrPrefetch) {
        try {
            window.evostitch.zarrPrefetch.init({
                zarrStoreUrl: state.zarrStoreUrl || CONFIG.evositchBaseUrl,
                baseUrl: CONFIG.evositchBaseUrl,
                zCount: state.zCount,
                axes: state.axes,
                loaderData: loaderData
            });
            log('Zarr prefetch module initialized');
        } catch (e) {
            console.warn('[evostitch] Failed to init zarr-prefetch:', e);
        }
    }

    // Initialize render optimization (debounce, zoom cap, RAF batching)
    if (window.evostitch?.zarrRenderOpt) {
        try {
            window.evostitch.zarrRenderOpt.init({
                deck: state.deck,
                loader: loaderData,
                metadata: state.metadata,
                axes: state.axes
            });
            log('Zarr render-opt module initialized');
        } catch (e) {
            console.warn('[evostitch] Failed to init zarr-render-opt:', e);
        }
    }
}

/**
 * Update the visualization layer
 */
function updateLayer() {
    if (!state.deck || !state.loader) {
        return;
    }

    // Get channel count from loader data
    const loaderData = state.loader.data || state.loader;
    const channelCount = state.axes?.includes('c') ?
        loaderData[0]?.shape[state.axes.indexOf('c')] || 1 : 1;

    // Build selections array - one per channel, all at current Z
    const selections = [];
    for (let c = 0; c < channelCount; c++) {
        const sel = {};
        if (state.axes) {
            state.axes.forEach(axis => {
                if (axis !== 'y' && axis !== 'x') {
                    if (axis === 'z') {
                        sel[axis] = state.currentZ;
                    } else if (axis === 'c') {
                        sel[axis] = c;
                    } else {
                        sel[axis] = 0;  // t, etc.
                    }
                }
            });
        } else {
            sel.z = state.currentZ;
            sel.c = c;
        }
        selections.push(sel);
    }
    log('Selections: ' + JSON.stringify(selections));

    // Get contrast limits and visibility from channel settings or metadata
    let contrastLimits = [];
    let colors = [];
    let channelsVisible = [];
    const omero = state.metadata?.omero;

    if (state.channelSettings.length > 0) {
        // Use channel settings from state (user-adjusted values)
        state.channelSettings.forEach((settings, idx) => {
            contrastLimits.push([settings.min, settings.max]);
            channelsVisible.push(settings.visible);
            // Get color from metadata
            const colorHex = omero?.channels?.[idx]?.color || 'FFFFFF';
            colors.push([
                parseInt(colorHex.slice(0, 2), 16),
                parseInt(colorHex.slice(2, 4), 16),
                parseInt(colorHex.slice(4, 6), 16)
            ]);
        });
    } else if (omero?.channels) {
        // Fall back to omero metadata
        omero.channels.forEach(ch => {
            contrastLimits.push([ch.window?.start || 0, ch.window?.end || 65535]);
            channelsVisible.push(true);
            const colorHex = ch.color || 'FFFFFF';
            colors.push([
                parseInt(colorHex.slice(0, 2), 16),
                parseInt(colorHex.slice(2, 4), 16),
                parseInt(colorHex.slice(4, 6), 16)
            ]);
        });
    } else {
        // Default for unknown channels
        for (let i = 0; i < channelCount; i++) {
            contrastLimits.push([0, 65535]);
            colors.push([255, 255, 255]);
            channelsVisible.push(true);
        }
    }

    // Capture generation at layer creation time for stale detection
    const generation = state.zSwitchGeneration;

    const layer = new MultiscaleImageLayer({
        id: 'zarr-layer',
        loader: loaderData,
        selections: selections,
        contrastLimits: contrastLimits,
        colors: colors,
        channelsVisible: channelsVisible,
        dtype: 'Uint16',
        onViewportLoad: () => {
            // Ignore stale callbacks — user already moved to a different Z-plane
            if (generation !== state.zSwitchGeneration) {
                log('Viewport load ignored (stale generation ' + generation + ' != ' + state.zSwitchGeneration + ')');
                return;
            }

            // Cancel delayed loading indicator if tiles arrived fast
            if (state.zLoadingTimerId !== null) {
                clearTimeout(state.zLoadingTimerId);
                state.zLoadingTimerId = null;
            }

            // Tiles for current viewport finished loading
            loadingUI.setProgress(1, 1);  // Complete
            loadingUI.hide();
            // End Z-switch timing (if one was in progress)
            perfEndZSwitch();
            // Quick fade-in to smooth the tile swap
            endZTransition();
            log('Viewport tiles loaded');
        }
    });

    state.deck.setProps({ layers: [layer] });
    log('Layer updated for Z=' + state.currentZ + ', channels=' + channelCount);
}

/**
 * Update Z slider UI
 */
function updateZSlider() {
    if (!elements.zSlider) return;

    elements.zSlider.max = Math.max(0, state.zCount - 1);
    elements.zSlider.value = state.currentZ;

    if (elements.zIndex) {
        elements.zIndex.textContent = `(${state.currentZ + 1}/${state.zCount})`;
    }

    // Update Z depth in µm
    if (elements.zDepth) {
        const zMicrons = state.currentZ * state.pixelSizeZ;
        elements.zDepth.textContent = `${zMicrons.toFixed(1)} µm`;
    }

    // Show slider container if we have multiple Z-planes
    const container = document.getElementById('z-slider-container');
    if (container && state.zCount > 1) {
        container.style.display = 'flex';
    }
}

/**
 * Set current Z-plane
 * @param {number} z - Z-plane index
 */
function setZ(z) {
    z = Math.max(0, Math.min(state.zCount - 1, z));
    if (z === state.currentZ) return;

    // Notify prefetch engine of Z-change for predictive fetching
    if (window.evostitch?.zarrPrefetch) {
        window.evostitch.zarrPrefetch.onZChange(z);
    }

    // Use render-opt debouncing if available (drops intermediate Z values during rapid scroll)
    if (window.evostitch?.zarrRenderOpt?.isInitialized?.()) {
        window.evostitch.zarrRenderOpt.updateZ(z, state.channelSettings, function(finalZ) {
            executeZSwitch(finalZ);
        });
    } else {
        executeZSwitch(z);
    }
}

/**
 * Execute the actual Z-plane switch (called directly or via debounce)
 * @param {number} z - Z-plane index
 */
function executeZSwitch(z) {
    // Start Z-switch timing
    perfStartZSwitch();

    // Increment generation counter — stale onViewportLoad callbacks will be ignored
    state.zSwitchGeneration++;

    state.currentZ = z;

    // Smart loading indicator: only show if tiles take >150ms to load
    // This prevents the loading indicator from flashing during rapid scrubbing
    // or when tiles load quickly from the service worker cache.
    if (state.zLoadingTimerId !== null) {
        clearTimeout(state.zLoadingTimerId);
    }
    state.zLoadingTimerId = setTimeout(function() {
        state.zLoadingTimerId = null;
        // Only show loading if tiles haven't already arrived
        if (perfStats.pendingZSwitch) {
            loadingUI.show();
            loadingUI.setProgress(0.3, z / Math.max(1, state.zCount - 1));
        }
    }, 150);

    updateZSlider();
    updateLayer();
    updateCoordinatesZOnly();  // Update Z in coordinate display
    log('Z-plane set to ' + z);
}

/**
 * Zoom in by one step
 * @param {number} step - Zoom step (default 0.5)
 */
function zoomIn(step = 0.5) {
    if (!state.deck || !state.viewState) return;
    const newZoom = state.viewState.zoom + step;
    state.viewState = { ...state.viewState, zoom: newZoom };
    state.deck.setProps({ viewState: state.viewState });
    updateScaleBar();
    log('Zoom in to ' + newZoom.toFixed(2));
}

/**
 * Zoom out by one step
 * @param {number} step - Zoom step (default 0.5)
 */
function zoomOut(step = 0.5) {
    if (!state.deck || !state.viewState) return;
    const newZoom = state.viewState.zoom - step;
    state.viewState = { ...state.viewState, zoom: newZoom };
    state.deck.setProps({ viewState: state.viewState });
    updateScaleBar();
    log('Zoom out to ' + newZoom.toFixed(2));
}

/**
 * Reset view to initial centered state
 */
function resetView() {
    if (!state.deck || !state.initialViewState) return;
    state.viewState = { ...state.initialViewState };
    state.deck.setProps({ viewState: state.viewState });
    updateScaleBar();
    log('View reset to initial state');
}

/**
 * Set up event handlers
 */
function setupEventHandlers() {
    // Z slider change
    if (elements.zSlider) {
        elements.zSlider.addEventListener('input', (e) => {
            setZ(parseInt(e.target.value, 10));
        });
    }

    // Zoom button handlers
    if (elements.zoomInBtn) {
        elements.zoomInBtn.addEventListener('click', () => zoomIn());
    }
    if (elements.zoomOutBtn) {
        elements.zoomOutBtn.addEventListener('click', () => zoomOut());
    }
    if (elements.homeBtn) {
        elements.homeBtn.addEventListener('click', () => resetView());
    }

    // Keyboard shortcuts for Z navigation and zoom
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        switch (e.key) {
            case 'ArrowUp':
                setZ(state.currentZ + 1);
                e.preventDefault();
                break;
            case 'ArrowDown':
                setZ(state.currentZ - 1);
                e.preventDefault();
                break;
            case '+':
            case '=':
                zoomIn();
                e.preventDefault();
                break;
            case '-':
            case '_':
                zoomOut();
                e.preventDefault();
                break;
            case 'h':
            case 'H':
                resetView();
                e.preventDefault();
                break;
        }
    });

    // Fullscreen button
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                document.documentElement.requestFullscreen();
            }
        });
    }

    // Mouse tracking for coordinate display
    if (elements.viewer) {
        elements.viewer.addEventListener('mousemove', (e) => {
            const rect = elements.viewer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            updateCoordinates(x, y);
        });

        elements.viewer.addEventListener('mouseleave', () => {
            updateCoordinatesZOnly();
        });
    }
}

/**
 * Wait for service worker to be ready and controlling the page.
 * This ensures zarr fetch requests are intercepted by the SW cache.
 */
async function waitForServiceWorker() {
    if (!window._swReady) {
        log('No service worker registration pending');
        return false;
    }
    try {
        var reg = await window._swReady;
        if (reg) {
            log('Service worker ready and controlling page');
            return true;
        }
        return false;
    } catch (e) {
        log('Service worker wait failed: ' + e.message);
        return false;
    }
}

/**
 * Send a message to the service worker and get a response via MessageChannel
 * @param {Object} msg - Message to send
 * @returns {Promise<Object>} Response from SW
 */
function swMessage(msg) {
    return new Promise(function(resolve, reject) {
        if (!navigator.serviceWorker.controller) {
            reject(new Error('No active service worker'));
            return;
        }
        var channel = new MessageChannel();
        channel.port1.onmessage = function(event) {
            resolve(event.data);
        };
        navigator.serviceWorker.controller.postMessage(msg, [channel.port2]);
        // Timeout after 5s
        setTimeout(function() { reject(new Error('SW message timeout')); }, 5000);
    });
}

/**
 * Main initialization
 */
async function init() {
    log('Initializing Zarr viewer');

    initElements();

    if (!initDeck()) {
        return false;
    }

    setupEventHandlers();

    // Wait for service worker to be controlling the page before loading data
    await waitForServiceWorker();

    const zarrUrl = getZarrUrl();
    const loaded = await loadZarr(zarrUrl);

    if (loaded) {
        updateLayer();
        updateCoordinatesZOnly();  // Show initial Z position
        // Set up canvas transition for smooth Z-plane changes
        // Delay slightly to ensure canvas exists
        setTimeout(setupCanvasTransition, 100);
        state.initialized = true;
        log('Viewer initialized successfully');
    }

    return loaded;
}

/**
 * Get current viewer state for debugging
 * @returns {Object} Current state
 */
function getState() {
    return {
        initialized: state.initialized,
        currentZ: state.currentZ,
        zCount: state.zCount,
        hasLoader: !!state.loader,
        hasDeck: !!state.deck,
        metadata: state.metadata
    };
}

/**
 * Debug logging
 */
function log(message) {
    if (CONFIG.debug) {
        console.log('[evostitch] ZarrViewer: ' + message);
    }
}

/**
 * Get the deck.gl canvas element for transitions
 * @returns {HTMLCanvasElement|null} The canvas element
 */
function getDeckCanvas() {
    if (!elements.viewer) return null;
    return elements.viewer.querySelector('canvas');
}

/**
 * Set up CSS transition on the deck.gl canvas
 */
function setupCanvasTransition() {
    const canvas = getDeckCanvas();
    if (canvas && state.zTransitionEnabled) {
        canvas.style.transition = `opacity ${state.zTransitionDuration}ms ease-out`;
        log('Canvas transition set up');
    }
}

/**
 * Start fade-out transition when changing Z-plane.
 * NOTE: No longer fades out. The old frame stays at full opacity until
 * new tiles are ready. This eliminates the visible "flicker" on Z-switch.
 */
function startZTransition() {
    // Intentionally empty — old frame stays visible at full opacity
    // until onViewportLoad fires. See endZTransition() for the swap.
}

/**
 * End fade-in transition when Z-plane tiles are loaded.
 * Applies a quick opacity pulse (1 -> 0.95 -> 1) to give subtle
 * visual feedback that the frame changed, without jarring flicker.
 */
function endZTransition() {
    if (!state.zTransitionEnabled) return;

    const canvas = getDeckCanvas();
    if (canvas) {
        // Quick subtle pulse: dip slightly then restore
        canvas.style.transition = 'none';
        canvas.style.opacity = '0.92';
        // Force reflow so the opacity change takes effect before transition
        void canvas.offsetHeight;
        canvas.style.transition = `opacity ${state.zTransitionDuration}ms ease-out`;
        canvas.style.opacity = '1';
        log('Z transition: fade in complete');
    }
}

/**
 * Set Z transition enabled state
 * @param {boolean} enabled - Whether transitions are enabled
 */
function setZTransition(enabled) {
    state.zTransitionEnabled = enabled;
    if (!enabled) {
        const canvas = getDeckCanvas();
        if (canvas) {
            canvas.style.transition = 'none';
            canvas.style.opacity = '1';
        }
    }
    log('Z transition ' + (enabled ? 'enabled' : 'disabled'));
}

/**
 * Get current channel settings
 * @returns {Array} Array of channel settings objects
 */
function getChannelSettings() {
    return state.channelSettings.map(s => ({ ...s }));
}

/**
 * Set channel visibility
 * @param {number} channelIndex - Channel index (0-based)
 * @param {boolean} visible - Whether channel should be visible
 */
function setChannelVisible(channelIndex, visible) {
    if (channelIndex >= 0 && channelIndex < state.channelSettings.length) {
        state.channelSettings[channelIndex].visible = visible;
        updateLayer();
        log(`Channel ${channelIndex} visibility set to ${visible}`);
    }
}

/**
 * Set channel contrast limits
 * @param {number} channelIndex - Channel index (0-based)
 * @param {number} min - Minimum value (black point)
 * @param {number} max - Maximum value (white point)
 */
function setChannelContrast(channelIndex, min, max) {
    if (channelIndex >= 0 && channelIndex < state.channelSettings.length) {
        state.channelSettings[channelIndex].min = min;
        state.channelSettings[channelIndex].max = max;
        updateLayer();
        log(`Channel ${channelIndex} contrast set to [${min}, ${max}]`);
    }
}

/**
 * Reset all channels to default settings
 */
function resetChannels() {
    state.channelSettings.forEach((settings, idx) => {
        settings.visible = true;
        settings.min = settings.defaultMin;
        settings.max = settings.defaultMax;
    });
    // Update UI sliders
    const sliders = elements.channelList?.querySelectorAll('.channel-item');
    sliders?.forEach((item, idx) => {
        const inputs = item.querySelectorAll('.channel-slider');
        const values = item.querySelectorAll('.channel-slider-value');
        const checkbox = item.querySelector('.channel-visibility');
        if (inputs[0]) {
            inputs[0].value = state.channelSettings[idx].min;
            values[0].textContent = state.channelSettings[idx].min;
        }
        if (inputs[1]) {
            inputs[1].value = state.channelSettings[idx].max;
            values[1].textContent = state.channelSettings[idx].max;
        }
        if (checkbox) {
            checkbox.checked = true;
        }
    });
    updateLayer();
    log('All channels reset to defaults');
}

// Expose SW communication API
window.evostitch = window.evostitch || {};
window.evostitch.sw = {
    getStats: function() {
        return swMessage({ type: 'getZarrCacheStats' });
    },
    clearCache: function() {
        return swMessage({ type: 'clearZarrCache' });
    },
    getCacheContents: function() {
        return swMessage({ type: 'getCacheContents' });
    },
    isActive: function() {
        return !!navigator.serviceWorker.controller;
    }
};

// Expose public API for debugging (matches IIFE pattern)
window.evostitch.zarrViewer = {
    init,
    setZ,
    zoomIn,
    zoomOut,
    resetView,
    getState,
    setDebug: (enabled) => { CONFIG.debug = enabled; },
    loadZarr,
    updateLayer,
    // Performance API
    getPerfStats,
    logPerfSummary,
    clearPerfStats,
    // Transition API
    setZTransition,
    // Channel controls API
    getChannelSettings,
    setChannelVisible,
    setChannelContrast,
    resetChannels
};

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
