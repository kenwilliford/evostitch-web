// evostitch Loading Indicator - Dual-arc progress ring for tile loading
// Outer arc: XY tile completion, Inner arc: Z-plane readiness

(function() {
    'use strict';

    // Configuration
    const SHOW_DELAY_MS = 300;  // Don't show for fast loads
    const APPEAR_DURATION_MS = 200;
    const DISAPPEAR_DURATION_MS = 300;

    // SVG dimensions
    const SIZE = 32;
    const CENTER = 18;  // Viewbox center
    const OUTER_RADIUS = 14;
    const INNER_RADIUS = 10;
    const STROKE_WIDTH = 2;

    // Colors (match CSS variables)
    const ACCENT_COLOR = '#3282b8';
    const ACCENT_FADED = 'rgba(50,130,184,0.7)';
    const TRACK_COLOR = 'rgba(100,100,100,0.3)';
    const BG_COLOR = 'rgba(0,0,0,0.6)';

    // State
    let container = null;
    let xyProgressEl = null;
    let zProgressEl = null;
    let announcer = null;
    let showTimer = null;
    let isLoading = false;
    let currentXY = 0;
    let currentZ = 0;
    let initialized = false;

    // Calculate stroke-dashoffset for a given progress (0-1)
    function calcDashoffset(radius, progress) {
        const circumference = 2 * Math.PI * radius;
        return circumference * (1 - progress);
    }

    // Create the SVG element
    function createSVG() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 36 36');
        svg.setAttribute('width', SIZE);
        svg.setAttribute('height', SIZE);
        svg.setAttribute('role', 'progressbar');
        svg.setAttribute('aria-valuemin', '0');
        svg.setAttribute('aria-valuemax', '100');
        svg.setAttribute('aria-valuenow', '0');
        svg.setAttribute('aria-label', 'Loading tiles: 0% complete');

        // Background circle
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bg.setAttribute('cx', CENTER);
        bg.setAttribute('cy', CENTER);
        bg.setAttribute('r', '17');
        bg.setAttribute('fill', BG_COLOR);
        svg.appendChild(bg);

        // Outer track (XY)
        const outerTrack = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        outerTrack.setAttribute('cx', CENTER);
        outerTrack.setAttribute('cy', CENTER);
        outerTrack.setAttribute('r', OUTER_RADIUS);
        outerTrack.setAttribute('fill', 'none');
        outerTrack.setAttribute('stroke', TRACK_COLOR);
        outerTrack.setAttribute('stroke-width', STROKE_WIDTH);
        svg.appendChild(outerTrack);

        // Outer progress (XY tiles)
        const outerProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        outerProgress.setAttribute('cx', CENTER);
        outerProgress.setAttribute('cy', CENTER);
        outerProgress.setAttribute('r', OUTER_RADIUS);
        outerProgress.setAttribute('fill', 'none');
        outerProgress.setAttribute('stroke', ACCENT_COLOR);
        outerProgress.setAttribute('stroke-width', STROKE_WIDTH);
        outerProgress.setAttribute('stroke-linecap', 'round');
        const outerCirc = 2 * Math.PI * OUTER_RADIUS;
        outerProgress.setAttribute('stroke-dasharray', outerCirc.toFixed(2));
        outerProgress.setAttribute('stroke-dashoffset', outerCirc.toFixed(2));
        outerProgress.setAttribute('transform', `rotate(-90 ${CENTER} ${CENTER})`);
        outerProgress.classList.add('xy-progress');
        svg.appendChild(outerProgress);
        xyProgressEl = outerProgress;

        // Inner track (Z-planes)
        const innerTrack = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        innerTrack.setAttribute('cx', CENTER);
        innerTrack.setAttribute('cy', CENTER);
        innerTrack.setAttribute('r', INNER_RADIUS);
        innerTrack.setAttribute('fill', 'none');
        innerTrack.setAttribute('stroke', TRACK_COLOR);
        innerTrack.setAttribute('stroke-width', STROKE_WIDTH);
        svg.appendChild(innerTrack);

        // Inner progress (Z-planes)
        const innerProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        innerProgress.setAttribute('cx', CENTER);
        innerProgress.setAttribute('cy', CENTER);
        innerProgress.setAttribute('r', INNER_RADIUS);
        innerProgress.setAttribute('fill', 'none');
        innerProgress.setAttribute('stroke', ACCENT_FADED);
        innerProgress.setAttribute('stroke-width', STROKE_WIDTH);
        innerProgress.setAttribute('stroke-linecap', 'round');
        const innerCirc = 2 * Math.PI * INNER_RADIUS;
        innerProgress.setAttribute('stroke-dasharray', innerCirc.toFixed(2));
        innerProgress.setAttribute('stroke-dashoffset', innerCirc.toFixed(2));
        innerProgress.setAttribute('transform', `rotate(-90 ${CENTER} ${CENTER})`);
        innerProgress.classList.add('z-progress');
        svg.appendChild(innerProgress);
        zProgressEl = innerProgress;

        return svg;
    }

    // Create screen reader announcer
    function createAnnouncer() {
        const div = document.createElement('div');
        div.id = 'loading-announcer';
        div.className = 'visually-hidden';
        div.setAttribute('role', 'status');
        div.setAttribute('aria-live', 'polite');
        return div;
    }

    // Update ARIA attributes
    function updateARIA() {
        if (!container) return;
        const svg = container.querySelector('svg');
        if (!svg) return;

        const combinedProgress = Math.round((currentXY * 0.7 + currentZ * 0.3) * 100);
        svg.setAttribute('aria-valuenow', combinedProgress);
        svg.setAttribute('aria-label', `Loading tiles: ${combinedProgress}% complete`);
    }

    // Initialize the loading indicator
    function init() {
        if (initialized) return;

        // Create container
        container = document.createElement('div');
        container.className = 'loading-indicator';
        container.appendChild(createSVG());

        // Create announcer for screen readers
        announcer = createAnnouncer();
        document.body.appendChild(announcer);

        // Add to DOM
        document.body.appendChild(container);

        initialized = true;
        console.log('[evostitch] Loading indicator initialized');
    }

    // Show the indicator (with delay)
    function show() {
        if (!initialized) init();
        isLoading = true;

        // Clear any existing timer
        if (showTimer) {
            clearTimeout(showTimer);
        }

        // Delay showing to avoid flash on fast loads
        showTimer = setTimeout(function() {
            if (isLoading && container) {
                container.classList.add('visible');
                if (announcer) {
                    announcer.textContent = 'Loading tiles...';
                }
            }
        }, SHOW_DELAY_MS);
    }

    // Hide the indicator
    function hide() {
        isLoading = false;

        // Clear pending show timer
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }

        if (container) {
            container.classList.remove('visible');
        }

        // Reset progress for next load
        currentXY = 0;
        currentZ = 0;
        if (xyProgressEl) {
            const outerCirc = 2 * Math.PI * OUTER_RADIUS;
            xyProgressEl.setAttribute('stroke-dashoffset', outerCirc.toFixed(2));
        }
        if (zProgressEl) {
            const innerCirc = 2 * Math.PI * INNER_RADIUS;
            zProgressEl.setAttribute('stroke-dashoffset', innerCirc.toFixed(2));
        }
        updateARIA();
    }

    // Set progress values (0-1 for each)
    function setProgress(xy, z) {
        if (!initialized) init();

        // Clamp values
        currentXY = Math.max(0, Math.min(1, xy));
        currentZ = Math.max(0, Math.min(1, z));

        // Update XY arc
        if (xyProgressEl) {
            const offset = calcDashoffset(OUTER_RADIUS, currentXY);
            xyProgressEl.setAttribute('stroke-dashoffset', offset.toFixed(2));
        }

        // Update Z arc
        if (zProgressEl) {
            const offset = calcDashoffset(INNER_RADIUS, currentZ);
            zProgressEl.setAttribute('stroke-dashoffset', offset.toFixed(2));
        }

        // Update accessibility
        updateARIA();

        // Auto-hide at 100%
        if (currentXY >= 1 && currentZ >= 1) {
            hide();
        }
    }

    // Get current state (for debugging)
    function getState() {
        return {
            initialized: initialized,
            isLoading: isLoading,
            visible: container ? container.classList.contains('visible') : false,
            xyProgress: currentXY,
            zProgress: currentZ
        };
    }

    // Expose API
    window.evostitch = window.evostitch || {};
    window.evostitch.loadingIndicator = {
        init: init,
        show: show,
        hide: hide,
        setProgress: setProgress,
        getState: getState
    };

})();
