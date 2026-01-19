// evostitch OpenSeadragon viewer with adaptive scale bar and Z-stack support

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

    // Configuration - will be loaded from metadata.json and catalog.json
    let metadata = null;
    let catalogEntry = null;
    let viewer = null;
    let scaleUmPerPixel = null;

    // Z-stack state
    let currentZ = 0;
    let zCount = 1;
    let zLabels = null;
    let deviceConfig = null;

    // Device capability detection for adaptive caching
    function getDeviceConfig() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                         || (window.innerWidth < 768 && 'ontouchstart' in window);
        const deviceMemory = navigator.deviceMemory || 4; // Default 4GB if API unavailable

        // HTTP/2 detection heuristic: modern browsers on decent connections
        // HTTP/2 multiplexing allows higher concurrency without head-of-line blocking
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const isSlowConnection = connection && (
            connection.effectiveType === 'slow-2g' ||
            connection.effectiveType === '2g'
        );
        const supportsHttp2 = !isSlowConnection;

        if (isMobile || deviceMemory < 4) {
            // Mobile / Low memory: conservative settings
            return {
                tier: 'mobile',
                cacheBase: 150,
                cachePlaneMultiplier: 50,
                preloadRadius: 1,
                imageLoaderLimit: supportsHttp2 ? 4 : 2
            };
        } else if (deviceMemory < 8) {
            // Standard desktop: moderate settings
            return {
                tier: 'standard',
                cacheBase: 200,
                cachePlaneMultiplier: 80,
                preloadRadius: 2,
                imageLoaderLimit: supportsHttp2 ? 8 : 4
            };
        } else {
            // High memory desktop: aggressive settings (HTTP/2 allows 10-12)
            return {
                tier: 'high',
                cacheBase: 300,
                cachePlaneMultiplier: 100,
                preloadRadius: 2,
                imageLoaderLimit: supportsHttp2 ? 12 : 6
            };
        }
    }

    // Scale bar configuration
    const SCALE_BAR_STEPS = [
        { value: 1, label: '1 µm' },
        { value: 2, label: '2 µm' },
        { value: 5, label: '5 µm' },
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

    const SCALE_BAR_MIN_WIDTH = 30;  // pixels
    const SCALE_BAR_MAX_WIDTH = 150; // pixels

    // OpenSeadragon configuration (shared between 2D and 3D)
    const OSD_CONFIG = {
        id: 'viewer',
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
        maxImageCacheCount: 500,
        imageLoaderLimit: 4,
    };

    // Initialize viewer
    async function init() {
        try {
            // Load metadata from R2 and catalog in parallel
            const metadataUrl = `${TILES_BASE_URL}/${mosaicId}/metadata.json`;
            const [metadataResponse, catalogResponse] = await Promise.all([
                fetch(metadataUrl),
                fetch('mosaics/catalog.json')
            ]);

            if (!metadataResponse.ok) {
                throw new Error(`Failed to load metadata: ${metadataResponse.status}`);
            }
            metadata = await metadataResponse.json();

            // Get catalog entry for this mosaic
            if (catalogResponse.ok) {
                const catalog = await catalogResponse.json();
                catalogEntry = catalog.mosaics.find(m => m.id === mosaicId);
            }

            // Update title and description from catalog (fall back to metadata)
            const title = catalogEntry?.title || metadata.title || mosaicId;
            document.getElementById('mosaic-title').textContent = title;
            document.title = `${title} - evostitch`;

            if (catalogEntry?.description) {
                document.getElementById('mosaic-description').textContent = catalogEntry.description;
            }

            // Get scale (µm per pixel)
            if (metadata.scale) {
                scaleUmPerPixel = (metadata.scale.x + metadata.scale.y) / 2;
            }

            // Check for 3D mosaic
            zCount = metadata.zCount || 1;
            zLabels = metadata.zLabels || null;

            if (zCount > 1) {
                await initZStack();
            } else {
                await init2D();
            }

            // Fullscreen button
            document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);

            // Log telemetry summary from previous sessions
            window.evostitch.telemetry.logSummary();

        } catch (error) {
            console.error('Viewer initialization failed:', error);
            document.getElementById('mosaic-title').textContent = `Error: ${error.message}`;
        }
    }

    // Initialize 2D viewer (single plane)
    async function init2D() {
        // For 2D, DZI name matches the metadata name/title
        const dziName = metadata.name || metadata.title || mosaicId;
        const dziUrl = `${TILES_BASE_URL}/${mosaicId}/${dziName}.dzi`;

        // Device-aware configuration (same as 3D but simpler cache needs)
        const config = getDeviceConfig();
        window.evostitch.telemetry.setDeviceTier(config.tier);
        console.log(`[evostitch] Device tier: ${config.tier}, imageLoaderLimit: ${config.imageLoaderLimit}`);

        viewer = OpenSeadragon({
            ...OSD_CONFIG,
            tileSources: dziUrl,
            imageLoaderLimit: config.imageLoaderLimit,
        });

        // Expose viewer for external instrumentation (performance testing)
        document.getElementById('viewer').viewer = viewer;

        setupViewerHandlers();

        // Initialize coordinate display to show correct format (2D vs 3D)
        displayCoordinates(0, 0);

        // Initialize quality adaptation for network-aware loading (W4)
        // and blur-up loader for progressive tile resolution
        // Wait for viewer to open before initializing
        viewer.addOnceHandler('open', function() {
            initQualityAdapt();
            initBlurUpLoader();
        });
    }

    // Initialize 3D viewer (Z-stack)
    async function initZStack() {
        // For 3D, DZI files are always named "mosaic" per generate_dzi_3d()
        const dziName = 'mosaic';

        // Build tile sources array - all planes
        const tileSources = [];
        for (let z = 0; z < zCount; z++) {
            const zDir = `z_${String(z).padStart(2, '0')}`;
            tileSources.push(`${TILES_BASE_URL}/${mosaicId}/${zDir}/${dziName}.dzi`);
        }

        // Device-aware cache configuration
        deviceConfig = getDeviceConfig();
        const preloadWindow = deviceConfig.preloadRadius * 2 + 1; // ±radius = 2*radius+1 planes
        const preloadPlanes = Math.min(zCount, preloadWindow);
        const dynamicCacheCount = deviceConfig.cacheBase + (preloadPlanes * deviceConfig.cachePlaneMultiplier);

        console.log(`[evostitch] Device tier: ${deviceConfig.tier}, imageLoaderLimit: ${deviceConfig.imageLoaderLimit}, cache: ${dynamicCacheCount}, preload radius: ±${deviceConfig.preloadRadius}`);
        window.evostitch.telemetry.setDeviceTier(deviceConfig.tier);

        viewer = OpenSeadragon({
            ...OSD_CONFIG,
            tileSources: tileSources,
            collectionMode: false,
            sequenceMode: false,
            maxImageCacheCount: dynamicCacheCount,
            imageLoaderLimit: deviceConfig.imageLoaderLimit,
        });

        // Expose viewer for external instrumentation (performance testing)
        document.getElementById('viewer').viewer = viewer;

        // Wait for all images to be added to the world
        let imagesLoaded = 0;
        viewer.world.addHandler('add-item', function() {
            imagesLoaded++;
            if (imagesLoaded === zCount) {
                // Start at middle Z-plane (more useful default for 3D exploration)
                currentZ = Math.floor((zCount - 1) / 2);

                // All planes loaded - set visibility (only show initial plane)
                for (let z = 0; z < zCount; z++) {
                    const item = viewer.world.getItemAt(z);
                    if (item) item.setOpacity(z === currentZ ? 1 : 0);
                }
                // Initialize Z-slider UI
                initZSliderUI();

                // Initialize coordinate display to show 3D format
                displayCoordinates(0, 0);

                // Initialize tile prioritizer for request optimization (W2)
                if (window.evostitch && window.evostitch.tilePrioritizer) {
                    try {
                        window.evostitch.tilePrioritizer.init(viewer, {
                            currentZ: currentZ,
                            zCount: zCount
                        });
                    } catch (err) {
                        console.warn('[evostitch] Failed to initialize tile-prioritizer (W2):', err.message);
                    }
                } else {
                    console.warn('[evostitch] tile-prioritizer module not loaded - Z-prefetch optimization disabled');
                }

                // Initialize worker tile source for off-thread decoding (W5)
                initWorkerTileSource();

                // Initialize quality adaptation for network-aware loading (W4)
                initQualityAdapt();

                // Initialize blur-up loader for progressive tile resolution
                initBlurUpLoader();
            }
        });

        setupViewerHandlers();
    }

    // Initialize blur-up loader for progressive tile resolution
    function initBlurUpLoader() {
        if (!window.evostitch || !window.evostitch.blurUpLoader) {
            console.warn('[evostitch] blur-up-loader module not loaded - progressive tile resolution disabled');
            return;
        }

        try {
            window.evostitch.blurUpLoader.init(viewer);
        } catch (err) {
            console.warn('[evostitch] Failed to initialize blur-up-loader:', err.message);
        }
    }

    // Initialize worker tile source for off-thread decoding (W5)
    function initWorkerTileSource() {
        if (!window.evostitch || !window.evostitch.workerTileSource) {
            console.warn('[evostitch] worker-tile-source module not loaded - off-thread decoding disabled');
            return;
        }

        try {
            const success = window.evostitch.workerTileSource.init(viewer, {
                poolSize: deviceConfig ? deviceConfig.imageLoaderLimit : 4
            });
            if (!success) {
                console.warn('[evostitch] Worker tile source initialization failed - using standard decode');
            }
        } catch (err) {
            console.warn('[evostitch] Failed to initialize worker-tile-source:', err.message);
        }
    }

    // Initialize quality adaptation (W4)
    function initQualityAdapt() {
        if (!window.evostitch || !window.evostitch.qualityAdapt) {
            console.warn('[evostitch] quality-adapt module not loaded - adaptive quality disabled');
            return;
        }

        try {
            window.evostitch.qualityAdapt.init(viewer);
        } catch (err) {
            console.warn('[evostitch] Failed to initialize quality-adapt (W4):', err.message);
            return;
        }

        // Check for network-detect dependency (W3)
        if (!window.evostitch.networkDetect) {
            console.warn('[evostitch] network-detect module not loaded - network speed detection disabled');
        }

        // Set up quality selector UI
        const qualitySelect = document.getElementById('quality-select');
        const qualityIndicator = document.getElementById('quality-indicator');

        if (qualitySelect) {
            qualitySelect.addEventListener('change', function(e) {
                window.evostitch.qualityAdapt.setQuality(e.target.value);
            });
        }

        // Update indicator to show current network/quality status
        function updateQualityIndicator() {
            if (!qualityIndicator) return;

            const effectiveQuality = window.evostitch.qualityAdapt.getEffectiveQuality();
            const networkInfo = window.evostitch.networkDetect ?
                window.evostitch.networkDetect.getInfo() : { speed: 'unknown' };

            // Show network speed indicator
            qualityIndicator.className = 'quality-indicator ' + networkInfo.speed;
            qualityIndicator.textContent = '(' + networkInfo.speed + ')';
        }

        // Listen for quality changes
        window.evostitch.qualityAdapt.addChangeListener(function(newQuality, oldQuality) {
            console.log('[evostitch] Quality changed: ' + oldQuality + ' -> ' + newQuality);
            updateQualityIndicator();
        });

        // Listen for network changes
        if (window.evostitch.networkDetect) {
            window.evostitch.networkDetect.addChangeListener(function() {
                updateQualityIndicator();
            });
        }

        // Initial update
        updateQualityIndicator();
    }

    // Set up common event handlers
    function setupViewerHandlers() {
        viewer.addHandler('zoom', updateScaleBar);
        viewer.addHandler('open', updateScaleBar);
        viewer.addHandler('animation', updateCoordinates);

        // Tile load telemetry - use PerformanceResourceTiming API for accurate latency
        viewer.addHandler('tile-loaded', function(event) {
            const zoomLevel = event.tile.level;

            // Get tile URL from the tile object (use getUrl() to avoid deprecation warning)
            const tileUrl = event.tile.getUrl ? event.tile.getUrl() : event.tile.url;
            let latencyMs = 0;
            let isWarm = true;  // Default to warm if we can't measure

            if (tileUrl && typeof performance !== 'undefined' && performance.getEntriesByName) {
                const entries = performance.getEntriesByName(tileUrl, 'resource');
                if (entries.length > 0) {
                    // Use most recent entry (in case of retries)
                    const timing = entries[entries.length - 1];
                    latencyMs = Math.round(timing.duration);
                    isWarm = latencyMs < window.evostitch.telemetry.WARM_THRESHOLD_MS;
                }
                // If no entry found, tile was likely served from browser cache (very warm)
            }

            window.evostitch.telemetry.recordTileLoad(zoomLevel, latencyMs, isWarm);
        });

        // Loading indicator integration
        if (window.evostitch && window.evostitch.loadingIndicator) {
            // Show indicator when viewport starts animating (pan/zoom)
            viewer.addHandler('animation-start', function() {
                resetTileCounters();
                window.evostitch.loadingIndicator.show();
                startProgressPolling();
            });

            // Update progress after draw cycle completes (when lastDrawn is populated)
            viewer.addHandler('animation-finish', function() {
                updateLoadingProgress();
            });

            // Also update progress during tile loads for responsive feedback
            viewer.addHandler('tile-loaded', function() {
                onTileLoadingComplete();
                // Schedule progress update after next render to get accurate lastDrawn
                requestAnimationFrame(function() {
                    updateLoadingProgress();
                });
            });

            // Also track tile load failures
            viewer.addHandler('tile-load-failed', function() {
                onTileLoadingComplete();
                requestAnimationFrame(function() {
                    updateLoadingProgress();
                });
            });

            // Track fully loaded state per TiledImage for accurate completion detection
            viewer.world.addHandler('add-item', function(event) {
                const tiledImage = event.item;
                tiledImage.addHandler('fully-loaded-change', function(e) {
                    if (e.fullyLoaded) {
                        requestAnimationFrame(function() {
                            updateLoadingProgress();
                        });
                    }
                });
            });
        }

        // Mouse move for coordinates
        viewer.addHandler('canvas-press', updateCoordinates);

        const canvas = viewer.canvas;
        canvas.addEventListener('mousemove', function(e) {
            updateCoordinatesFromEvent(e);
        });
    }

    // Z-slider UI initialization
    function initZSliderUI() {
        const container = document.getElementById('z-slider-container');
        const slider = document.getElementById('z-slider');

        // Configure slider range
        slider.max = zCount - 1;
        slider.value = currentZ;

        // Update displays
        updateZDisplay();

        // Show container
        container.style.display = 'flex';

        // Show comparison link for Z-stack mosaics
        const compareLink = document.getElementById('compare-link');
        if (compareLink) {
            compareLink.style.display = '';
        }

        // Handle slider changes
        slider.addEventListener('input', handleZSliderChange);

        // Preload adjacent planes for smoother first navigation
        preloadAdjacentPlanes(currentZ);

        // Keyboard navigation for Z-planes
        document.addEventListener('keydown', handleKeyboardZ);

        // Shift+Scroll wheel navigation for Z-planes
        viewer.canvas.addEventListener('wheel', handleWheelZ, { passive: false });
    }

    function handleZSliderChange(e) {
        const newZ = parseInt(e.target.value, 10);
        setZPlane(newZ);
    }

    // Track progressive load animation state
    let progressiveLoadInterval = null;
    let zoomBackTimeout = null;

    /**
     * Force OSD to load tiles for the current viewport after Z-change.
     *
     * Problem: When changing Z-planes at max zoom, OSD has pre-loaded tiles
     * for the new TiledImage, but they're edge tiles (for pan preloading),
     * not the viewport center tiles. OSD draws lower-level tiles because
     * the correct high-level center tiles aren't loaded.
     *
     * Solution: Reset the TiledImage's tile cache and do a zoom-out-zoom-in
     * cycle. This forces OSD to load tiles fresh with correct viewport focus.
     */
    function triggerProgressiveTileLoad() {
        // Cancel any previous animations
        if (progressiveLoadInterval) {
            clearInterval(progressiveLoadInterval);
            progressiveLoadInterval = null;
        }
        if (zoomBackTimeout) {
            clearTimeout(zoomBackTimeout);
            zoomBackTimeout = null;
        }

        const vp = viewer.viewport;
        const maxZoom = vp.getMaxZoom();
        const currentZoom = vp.getZoom();
        const ti = viewer.world.getItemAt(currentZ);

        if (!ti) return;

        // Reset the TiledImage's tile cache to force fresh loading
        // This clears pre-loaded edge tiles and forces OSD to prioritize
        // viewport center tiles during the zoom animation
        ti.tilesMatrix = {};
        ti._lastResetTime = Date.now();
        ti._needsDraw = true;
        ti._loading = 0;
        if (ti._coverage) {
            ti._coverage = {};
        }
        ti._midDraw = false;
        ti._tiles = {};
        ti._lastDrawn = [];

        // Do a zoom-out-zoom-in cycle to trigger proper tile loading
        // Zoom out to 30% of max, then back to original zoom level
        const targetZoom = currentZoom;  // Remember where we were
        const zoomOutTarget = maxZoom * 0.3;

        vp.zoomTo(zoomOutTarget, null, false);  // Animated zoom out
        zoomBackTimeout = setTimeout(() => {
            zoomBackTimeout = null;
            vp.zoomTo(targetZoom, null, false);  // Animated zoom back
        }, 1500);
    }

    function setZPlane(newZ) {
        if (newZ === currentZ || newZ < 0 || newZ >= zCount) return;

        // Hide current plane
        const currentItem = viewer.world.getItemAt(currentZ);
        if (currentItem) currentItem.setOpacity(0);

        // Update currentZ BEFORE triggering tile loading so triggerProgressiveTileLoad
        // operates on the new plane
        currentZ = newZ;

        // Show new plane
        const newItem = viewer.world.getItemAt(newZ);
        if (newItem) {
            newItem.setOpacity(1);
            // Disable preload mode so OSD uses normal viewport-based tile loading
            // (preload mode may have been set when this was an adjacent plane)
            newItem.setPreload(false);

            // Force OSD to recalculate tile coverage for this TiledImage
            // When a TiledImage switches from hidden to visible, OSD may not
            // automatically recalculate which tiles are needed
            newItem._needsDraw = true;
            newItem.update();
            viewer.forceRedraw();

        }

        updateZDisplay();

        // Update tile prioritizer with new Z-plane (W2)
        if (window.evostitch && window.evostitch.tilePrioritizer) {
            window.evostitch.tilePrioritizer.setCurrentZ(newZ);
        }

        // Preload adjacent planes for smoother navigation
        preloadAdjacentPlanes(newZ);

        // Show loading indicator for Z-plane change (tiles need to load)
        if (window.evostitch && window.evostitch.loadingIndicator) {
            resetTileCounters();
            window.evostitch.loadingIndicator.show();
            startProgressPolling();
        }

        // Update loading indicator - Z window has shifted
        updateLoadingProgress();
    }

    function handleKeyboardZ(e) {
        // Ignore if user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        switch (e.key) {
            case 'ArrowUp':
            case 'PageUp':
                e.preventDefault();
                setZPlane(currentZ + 1);  // Deeper (higher Z-index)
                document.getElementById('z-slider').value = currentZ;
                break;
            case 'ArrowDown':
            case 'PageDown':
                e.preventDefault();
                setZPlane(currentZ - 1);  // Shallower (lower Z-index)
                document.getElementById('z-slider').value = currentZ;
                break;
            case 'Home':
                e.preventDefault();
                setZPlane(0);  // Surface
                document.getElementById('z-slider').value = 0;
                break;
            case 'End':
                e.preventDefault();
                setZPlane(zCount - 1);  // Deepest
                document.getElementById('z-slider').value = zCount - 1;
                break;
        }
    }

    function handleWheelZ(e) {
        // Shift+Scroll for Z-plane navigation (plain scroll = zoom)
        if (!e.shiftKey) return;

        e.preventDefault();

        // Scroll up (negative deltaY) = deeper (higher Z), scroll down = shallower
        if (e.deltaY < 0) {
            setZPlane(currentZ + 1);
        } else if (e.deltaY > 0) {
            setZPlane(currentZ - 1);
        }

        document.getElementById('z-slider').value = currentZ;
    }

    function preloadAdjacentPlanes(z) {
        const radius = deviceConfig?.preloadRadius || 2;
        for (let dz = -radius; dz <= radius; dz++) {
            const targetZ = z + dz;
            if (targetZ >= 0 && targetZ < zCount && targetZ !== z) {
                const item = viewer.world.getItemAt(targetZ);
                if (item) item.setPreload(true);
            }
        }
    }

    // Normalize unit strings to use proper µm symbol
    function normalizeUnit(text) {
        return text.replace(/um\b/g, 'µm');
    }

    function updateZDisplay() {
        const depthDisplay = document.getElementById('z-depth');
        const indexDisplay = document.getElementById('z-index');

        // Depth label from metadata or computed
        if (zLabels && zLabels[currentZ]) {
            depthDisplay.textContent = normalizeUnit(zLabels[currentZ]);
        } else {
            const spacing = metadata.zSpacing || 1;
            depthDisplay.textContent = `${(currentZ * spacing).toFixed(1)} µm`;
        }

        // Plane index (1-based for humans)
        indexDisplay.textContent = `(${currentZ + 1}/${zCount})`;
    }

    // Tile loading progress tracking
    let loadedTileCount = 0;
    let progressResetTimer = null;
    let progressPollingInterval = null;
    const PROGRESS_POLL_INTERVAL_MS = 100;  // Update indicator every 100ms during loading

    // Reset counters when viewport animation starts
    function resetTileCounters() {
        loadedTileCount = 0;
    }

    // Start polling for progress updates (ensures real-time ring updates)
    function startProgressPolling() {
        if (progressPollingInterval !== null) {
            return; // Already polling
        }

        progressPollingInterval = setInterval(function() {
            updateLoadingProgress();
        }, PROGRESS_POLL_INTERVAL_MS);
    }

    // Stop polling when loading completes
    function stopProgressPolling() {
        if (progressPollingInterval !== null) {
            clearInterval(progressPollingInterval);
            progressPollingInterval = null;
        }
    }

    // Calculate XY progress based on actual viewport tile coverage
    // Returns 0-1 indicating what fraction of needed tiles are drawn at best resolution
    function calculateXYProgress() {
        const tiledImage = viewer.world.getItemAt(zCount > 1 ? currentZ : 0);
        if (!tiledImage) return 0;

        const viewport = viewer.viewport;
        const source = tiledImage.source;
        if (!source) return 0;

        // Get viewport bounds
        const viewportBounds = viewport.getBounds();

        // Find the best level for current zoom (highest resolution needed)
        // OSD uses levels where 0 = smallest, maxLevel = full resolution
        const containerWidth = viewport.getContainerSize().x;
        const viewportWidthInViewport = viewportBounds.width;
        const pixelsPerViewportUnit = containerWidth / viewportWidthInViewport;

        // Determine which level provides adequate detail
        // We want scale where level pixels per viewport unit >= screen pixels per viewport unit
        let bestLevel = 0;
        for (let level = 0; level <= source.maxLevel; level++) {
            const levelScale = source.getLevelScale(level);
            // At this level, how many image pixels per viewport unit?
            const levelPixelsPerViewportUnit = source.width * levelScale;
            if (levelPixelsPerViewportUnit >= pixelsPerViewportUnit * 0.5) {
                bestLevel = level;
                break;
            }
            bestLevel = level;
        }

        // Check what level OSD actually drew (highest level in lastDrawn)
        const lastDrawn = tiledImage.lastDrawn || [];
        if (lastDrawn.length === 0) return 0;

        const drawnLevel = Math.max(...lastDrawn.map(t => t.level));

        // If drawn level is lower than what we need, we're still loading
        if (drawnLevel < bestLevel) {
            // Return partial progress based on how close the drawn level is
            return 0.5 * (drawnLevel / bestLevel);
        }

        // OSD drew at adequate or better resolution - check coverage at bestLevel
        // Using bestLevel (not drawnLevel) ensures we measure "adequate coverage"
        // even when OSD is loading higher-resolution tiles
        let corners;
        try {
            corners = tiledImage._getCornerTiles(
                bestLevel,
                viewportBounds.getTopLeft(),
                viewportBounds.getBottomRight()
            );
        } catch (e) {
            // Fallback if _getCornerTiles fails
            return Math.min(0.95, loadedTileCount * 0.05);
        }

        // Count needed tiles at bestLevel
        const neededTileCount = (corners.bottomRight.x - corners.topLeft.x + 1) *
                                (corners.bottomRight.y - corners.topLeft.y + 1);

        if (neededTileCount <= 0) return 1;

        // Track which bestLevel positions are covered (to avoid double-counting)
        const coveredPositions = new Set();

        for (const tile of lastDrawn) {
            if (tile.level < bestLevel) continue;  // Lower than adequate, skip

            // Map tile position to bestLevel coordinate space
            // Higher level tiles have finer grid: position at level L maps to
            // position / 2^(L - bestLevel) at bestLevel
            const levelDiff = tile.level - bestLevel;
            const mappedX = Math.floor(tile.x / Math.pow(2, levelDiff));
            const mappedY = Math.floor(tile.y / Math.pow(2, levelDiff));

            // Check if this mapped position is within viewport bounds at bestLevel
            if (mappedX >= corners.topLeft.x && mappedX <= corners.bottomRight.x &&
                mappedY >= corners.topLeft.y && mappedY <= corners.bottomRight.y) {
                coveredPositions.add(`${mappedX},${mappedY}`);
            }
        }

        return coveredPositions.size / neededTileCount;
    }

    // Calculate viewport tile coverage for any TiledImage using tilesMatrix
    // This checks if tiles needed for current viewport are actually loaded
    // Returns 0-1 coverage ratio
    function calculateTileCoverageForPlane(tiledImage) {
        if (!tiledImage || !tiledImage.source) return 0;

        const viewport = viewer.viewport;
        const source = tiledImage.source;
        const viewportBounds = viewport.getBounds();

        // Calculate bestLevel (same logic as calculateXYProgress)
        const containerWidth = viewport.getContainerSize().x;
        const viewportWidthInViewport = viewportBounds.width;
        const pixelsPerViewportUnit = containerWidth / viewportWidthInViewport;

        let bestLevel = 0;
        for (let level = 0; level <= source.maxLevel; level++) {
            const levelScale = source.getLevelScale(level);
            const levelPixelsPerViewportUnit = source.width * levelScale;
            if (levelPixelsPerViewportUnit >= pixelsPerViewportUnit * 0.5) {
                bestLevel = level;
                break;
            }
            bestLevel = level;
        }

        // Get corner tiles at bestLevel
        let corners;
        try {
            corners = tiledImage._getCornerTiles(
                bestLevel,
                viewportBounds.getTopLeft(),
                viewportBounds.getBottomRight()
            );
        } catch (e) {
            return 0;  // Can't calculate
        }

        // Count needed tiles at bestLevel
        const neededTileCount = (corners.bottomRight.x - corners.topLeft.x + 1) *
                                (corners.bottomRight.y - corners.topLeft.y + 1);

        if (neededTileCount <= 0) return 1;

        // Check tilesMatrix for loaded tiles at needed positions
        // tilesMatrix is structured as tilesMatrix[level][x][y] containing Tile objects
        const tilesMatrix = tiledImage.tilesMatrix;
        if (!tilesMatrix || !tilesMatrix[bestLevel]) return 0;

        let loadedCount = 0;
        for (let x = corners.topLeft.x; x <= corners.bottomRight.x; x++) {
            for (let y = corners.topLeft.y; y <= corners.bottomRight.y; y++) {
                const row = tilesMatrix[bestLevel][x];
                if (row && row[y]) {
                    const tile = row[y];
                    // Check if tile is loaded (OSD uses 'loaded' property)
                    if (tile.loaded) {
                        loadedCount++;
                    }
                }
            }
        }

        return loadedCount / neededTileCount;
    }

    // Calculate Z progress based on ±2 adjacent planes readiness
    // Returns 0-1 indicating what fraction of the preload window is fully loaded
    // Takes currentXYProgress to avoid redundant calculation for the current plane
    function calculateZProgress(currentXYProgress) {
        if (!viewer || zCount <= 1) {
            return 1;  // No Z-stack, always "complete"
        }

        const PRELOAD_RADIUS = 2;  // Track ±2 planes
        let readyCount = 0;
        let totalInWindow = 0;

        for (let dz = -PRELOAD_RADIUS; dz <= PRELOAD_RADIUS; dz++) {
            const targetZ = currentZ + dz;
            if (targetZ >= 0 && targetZ < zCount) {
                totalInWindow++;

                if (targetZ === currentZ) {
                    // For current Z-plane, use viewport-based progress
                    // Don't trust getFullyLoaded() which lies after Z-changes
                    if (currentXYProgress >= 0.95) {
                        readyCount++;
                    }
                } else {
                    // For adjacent planes, use viewport coverage proxy
                    // Don't trust getFullyLoaded() - check actual tile coverage
                    const item = viewer.world.getItemAt(targetZ);
                    const coverage = calculateTileCoverageForPlane(item);
                    if (coverage >= 0.95) {
                        readyCount++;
                    }
                }
            }
        }

        return totalInWindow > 0 ? readyCount / totalInWindow : 1;
    }

    // Track tile loading complete (success or failure)
    function onTileLoadingComplete() {
        loadedTileCount++;

        // Clear any pending reset since we're actively loading
        if (progressResetTimer) {
            clearTimeout(progressResetTimer);
            progressResetTimer = null;
        }
    }

    // Update loading indicator progress based on tile coverage
    function updateLoadingProgress() {
        if (!viewer || !window.evostitch || !window.evostitch.loadingIndicator) {
            return;
        }

        // Get the current TiledImage (for 3D, use currentZ; for 2D, always index 0)
        const tiledImage = viewer.world.getItemAt(zCount > 1 ? currentZ : 0);
        if (!tiledImage) {
            return;
        }

        // Calculate XY progress based on actual viewport tile coverage
        // This doesn't trust getFullyLoaded() which can lie after Z-plane changes
        const xyProgress = calculateXYProgress();

        // Calculate Z progress based on adjacent plane readiness (±2 planes)
        // Pass xyProgress so current plane uses viewport-based check, not getFullyLoaded()
        const zProgress = calculateZProgress(xyProgress);

        window.evostitch.loadingIndicator.setProgress(xyProgress, zProgress);

        // Stop polling and schedule counter reset when fully loaded
        if (xyProgress >= 1 && zProgress >= 1) {
            stopProgressPolling();
            if (progressResetTimer) {
                clearTimeout(progressResetTimer);
            }
            progressResetTimer = setTimeout(resetTileCounters, 1000);
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

        if (zCount > 1) {
            // Include Z coordinate and plane index for 3D mosaics
            let zLabel = zLabels?.[currentZ] || `${(currentZ * (metadata.zSpacing || 1)).toFixed(1)} µm`;
            zLabel = normalizeUnit(zLabel);
            const planeIndex = `(plane ${currentZ + 1}/${zCount})`;
            display.textContent = `X: ${umX.toFixed(1)} µm  Y: ${umY.toFixed(1)} µm  Z: ${zLabel} ${planeIndex}`;
        } else {
            display.textContent = `X: ${umX.toFixed(1)} µm  Y: ${umY.toFixed(1)} µm`;
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
