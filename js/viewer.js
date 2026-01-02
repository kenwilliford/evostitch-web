// evostitch OpenSeadragon viewer with adaptive scale bar

(function() {
    'use strict';

    // Tile server configuration
    const TILES_BASE_URL = 'https://pub-db7ffa4b7df04b76aaae379c13562977.r2.dev';

    // Parse mosaic ID from URL
    const params = new URLSearchParams(window.location.search);
    const mosaicId = params.get('mosaic');

    if (!mosaicId) {
        document.getElementById('mosaic-title').textContent = 'Error: No mosaic specified';
        return;
    }

    // Configuration - will be loaded from metadata.json
    let metadata = null;
    let viewer = null;
    let scaleUmPerPixel = null;

    // Scale bar configuration
    const SCALE_BAR_STEPS = [
        { value: 10, label: '10 µm' },
        { value: 20, label: '20 µm' },
        { value: 50, label: '50 µm' },
        { value: 100, label: '100 µm' },
        { value: 200, label: '200 µm' },
        { value: 500, label: '500 µm' },
        { value: 1000, label: '1 mm' },
        { value: 2000, label: '2 mm' },
        { value: 5000, label: '5 mm' },
        { value: 10000, label: '10 mm' },
    ];

    const SCALE_BAR_MIN_WIDTH = 60;  // pixels
    const SCALE_BAR_MAX_WIDTH = 150; // pixels

    // Initialize viewer
    async function init() {
        try {
            // Load metadata from R2
            const metadataUrl = `${TILES_BASE_URL}/${mosaicId}/metadata.json`;
            const response = await fetch(metadataUrl);
            if (!response.ok) {
                throw new Error(`Failed to load metadata: ${response.status}`);
            }
            metadata = await response.json();

            // Update title
            document.getElementById('mosaic-title').textContent = metadata.title || mosaicId;
            document.title = `${metadata.title || mosaicId} - evostitch`;

            // Get scale (µm per pixel)
            if (metadata.scale) {
                scaleUmPerPixel = (metadata.scale.x + metadata.scale.y) / 2;
            }

            // Initialize OpenSeadragon with R2 tile source
            const dziUrl = `${TILES_BASE_URL}/${mosaicId}/${metadata.title || mosaicId}.dzi`;
            viewer = OpenSeadragon({
                id: 'viewer',
                tileSources: dziUrl,
                prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/',
                showNavigator: true,
                navigatorPosition: 'TOP_RIGHT',
                navigatorSizeRatio: 0.15,
                animationTime: 0.3,
                blendTime: 0.1,
                constrainDuringPan: true,
                maxZoomPixelRatio: 2,
                minZoomImageRatio: 0.5,
                visibilityRatio: 0.5,
                zoomPerScroll: 1.2,
            });

            // Set up event handlers
            viewer.addHandler('zoom', updateScaleBar);
            viewer.addHandler('open', updateScaleBar);
            viewer.addHandler('animation', updateCoordinates);

            // Mouse move for coordinates
            viewer.addHandler('canvas-press', updateCoordinates);

            const canvas = viewer.canvas;
            canvas.addEventListener('mousemove', function(e) {
                updateCoordinatesFromEvent(e);
            });

            // Fullscreen button
            document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);

        } catch (error) {
            console.error('Viewer initialization failed:', error);
            document.getElementById('mosaic-title').textContent = `Error: ${error.message}`;
        }
    }

    function updateScaleBar() {
        if (!viewer || !scaleUmPerPixel) return;

        const scaleBar = document.getElementById('scale-bar');
        const scaleLine = scaleBar.querySelector('.scale-bar-line');
        const scaleLabel = scaleBar.querySelector('.scale-bar-label');

        // Get current zoom level
        const zoom = viewer.viewport.getZoom(true);
        const containerWidth = viewer.viewport.getContainerSize().x;
        const imageWidth = metadata.width;

        // Calculate µm per screen pixel at current zoom
        const screenPixelsPerImagePixel = (zoom * containerWidth) / imageWidth;
        const umPerScreenPixel = scaleUmPerPixel / screenPixelsPerImagePixel;

        // Find best scale bar size
        let bestStep = SCALE_BAR_STEPS[0];
        for (const step of SCALE_BAR_STEPS) {
            const barWidth = step.value / umPerScreenPixel;
            if (barWidth >= SCALE_BAR_MIN_WIDTH && barWidth <= SCALE_BAR_MAX_WIDTH) {
                bestStep = step;
                break;
            }
            if (barWidth < SCALE_BAR_MIN_WIDTH) {
                bestStep = step;
            }
        }

        // Update scale bar display
        const barWidth = bestStep.value / umPerScreenPixel;
        scaleLine.style.width = `${Math.round(barWidth)}px`;
        scaleLabel.textContent = bestStep.label;
    }

    function updateCoordinates() {
        // Called during animation - uses center of viewport
        if (!viewer || !scaleUmPerPixel) return;

        const center = viewer.viewport.getCenter(true);
        const imagePoint = viewer.viewport.viewportToImageCoordinates(center);

        displayCoordinates(imagePoint.x, imagePoint.y);
    }

    function updateCoordinatesFromEvent(e) {
        if (!viewer || !scaleUmPerPixel) return;

        const webPoint = new OpenSeadragon.Point(e.offsetX, e.offsetY);
        const viewportPoint = viewer.viewport.pointFromPixel(webPoint);
        const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);

        displayCoordinates(imagePoint.x, imagePoint.y);
    }

    function displayCoordinates(pixelX, pixelY) {
        // Convert to µm (QuPath-style: origin top-left, Y down)
        const umX = pixelX * scaleUmPerPixel;
        const umY = pixelY * scaleUmPerPixel;

        const display = document.getElementById('coord-display');

        // Format based on magnitude
        if (umX > 1000 || umY > 1000) {
            display.textContent = `X: ${(umX / 1000).toFixed(2)} mm, Y: ${(umY / 1000).toFixed(2)} mm`;
        } else {
            display.textContent = `X: ${umX.toFixed(1)} µm, Y: ${umY.toFixed(1)} µm`;
        }
    }

    function toggleFullscreen() {
        const elem = document.documentElement;

        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    // Start initialization
    init();
})();
