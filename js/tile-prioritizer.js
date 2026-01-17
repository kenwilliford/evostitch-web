// evostitch Tile Prioritizer - W2 Request Prioritization
// Prioritizes viewport tiles over prefetch, current Z-plane over adjacent planes
// Implements Z-aware prefetching for adjacent planes within viewport bounds

(function() {
    'use strict';

    // Priority levels (lower = higher priority)
    const PRIORITY = {
        VIEWPORT_CURRENT_Z: 1,   // Tiles visible in viewport on current Z-plane
        VIEWPORT_ADJACENT_Z: 2,  // Tiles visible in viewport on adjacent Z-planes
        PREFETCH: 3,             // Preloaded tiles outside viewport or far Z-planes
        DEFAULT: 2               // Default when priority can't be determined
    };

    // Configuration
    const CONFIG = {
        // Job limit during animation (reduces queue congestion)
        animatingJobLimit: 2,
        // Job limit when idle (allows faster prefetch)
        idleJobLimit: 6,
        // How long after animation ends before restoring idle limit (ms)
        idleRestoreDelay: 100,
        // Maximum pending jobs in queue (prevents unbounded growth)
        maxPendingJobs: 50,
        // Enable debug logging
        debug: false,
        // Enable diagnostic logging (always logs processQueue activity)
        diagnostic: false,
        // Z-aware prefetching settings
        prefetch: {
            // Prefetch Z±1 planes
            zRadius: 1,
            // Minimum viewport change (0-1) to trigger prefetch cancellation
            viewportChangeThreshold: 0.3,
            // Delay before starting prefetch after viewport settles (ms)
            prefetchDelay: 150
        }
    };

    // State tracking
    let viewer = null;
    let originalJobLimit = null;
    let isAnimating = false;
    let idleRestoreTimeout = null;
    let currentZPlane = 0;
    let zPlaneCount = 1;
    let enabled = false;

    // Priority queue for pending jobs
    let pendingJobs = [];
    let originalAddJob = null;
    let processingQueue = false;

    // Z-aware prefetching state
    let lastPrefetchBounds = null;
    let prefetchTimeout = null;
    let prefetchedZPlanes = new Set();

    // Z-velocity tracking for predictive prefetch
    let lastZChangeTime = 0;
    let lastZPlane = 0;
    let zVelocity = 0; // planes per second, positive = forward, negative = backward

    // Heartbeat interval for processing queue when no OSD events fire
    let heartbeatIntervalId = null;
    const HEARTBEAT_INTERVAL_MS = 500;

    // Resolution fix state to prevent infinite loops
    // Tracks last fix attempt per Z-plane and zoom level
    let resolutionFixState = {
        lastAttemptZ: -1,
        lastAttemptZoom: -1,
        lastAttemptTime: 0,
        // Minimum time between fix attempts for same Z/zoom (ms)
        cooldownMs: 2000
    };

    /**
     * Initialize the tile prioritizer with an OpenSeadragon viewer
     * @param {OpenSeadragon.Viewer} osdViewer - The OpenSeadragon viewer instance
     * @param {Object} options - Configuration options
     * @param {number} options.currentZ - Current Z-plane index (default 0)
     * @param {number} options.zCount - Total Z-plane count (default 1)
     */
    function init(osdViewer, options = {}) {
        if (!osdViewer || !osdViewer.imageLoader) {
            console.error('[evostitch] TilePrioritizer: Invalid viewer instance');
            return false;
        }

        viewer = osdViewer;
        currentZPlane = options.currentZ || 0;
        zPlaneCount = options.zCount || 1;
        lastZPlane = currentZPlane; // Initialize to match currentZPlane to avoid artificial velocity on first Z-change

        // Store original job limit
        originalJobLimit = viewer.imageLoader.jobLimit;

        // Wrap ImageLoader.addJob to intercept tile requests
        wrapImageLoader();

        // Set up animation event handlers
        setupAnimationHandlers();

        enabled = true;
        log('Initialized with jobLimit=' + originalJobLimit + ', zCount=' + zPlaneCount);
        return true;
    }

    /**
     * Wrap the ImageLoader's addJob method to implement priority queue
     */
    function wrapImageLoader() {
        const imageLoader = viewer.imageLoader;
        originalAddJob = imageLoader.addJob.bind(imageLoader);

        imageLoader.addJob = function(options) {
            // Calculate priority for this job
            const priority = calculatePriority(options);

            // Log tile Z-plane for diagnostic purposes
            const tile = options.tile;
            const tiledImage = tile ? tile.tiledImage : null;
            const tileUrl = tile ? (tile.getUrl ? tile.getUrl() : tile.url) : null;
            const tileZPlane = tiledImage ? getTileZPlane(tiledImage) : getZPlaneFromUrl(tileUrl);
            logDiagnostic('addJob', {
                zPlane: tileZPlane,
                currentZ: currentZPlane,
                priority: priority,
                level: tile ? tile.level : 'unknown',
                isCurrentZ: tileZPlane === currentZPlane,
                hasTile: !!tile,
                hasTiledImage: !!tiledImage,
                usedUrlFallback: !tiledImage && tileZPlane >= 0,
                tileUrl: tileUrl || 'no-tile'
            });

            // Add to priority queue
            pendingJobs.push({
                options: options,
                priority: priority,
                timestamp: Date.now()
            });

            // Sort by priority (stable sort - preserves order within same priority)
            pendingJobs.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return a.priority - b.priority;
                }
                return a.timestamp - b.timestamp;
            });

            // Drop lowest priority jobs if over limit
            if (pendingJobs.length > CONFIG.maxPendingJobs) {
                const dropped = pendingJobs.length - CONFIG.maxPendingJobs;
                pendingJobs = pendingJobs.slice(0, CONFIG.maxPendingJobs);
                log('Queue limit exceeded, dropped ' + dropped + ' lowest priority jobs');
            }

            log('Job queued with priority ' + priority + ', queue size: ' + pendingJobs.length);

            // Start heartbeat to ensure queue gets processed even without OSD events
            startHeartbeat();

            // Process queue
            processQueue();
        };
    }

    /**
     * Calculate priority for a tile job
     * @param {Object} jobOptions - The job options passed to addJob
     * @returns {number} Priority level (lower = higher priority)
     */
    function calculatePriority(jobOptions) {
        // Extract tile info
        const tile = jobOptions.tile;
        if (!tile) {
            return PRIORITY.DEFAULT;
        }

        // Get the tile's tiledImage (Z-plane)
        let tiledImage = tile.tiledImage;
        let tileZPlane = -1;

        if (tiledImage) {
            // Normal path: get Z-plane from tiledImage
            tileZPlane = getTileZPlane(tiledImage);
        } else {
            // Fallback: extract Z-plane from tile URL (handles OSD timing quirk)
            // URL pattern: .../z_XX/... where XX is the zero-padded Z-plane index
            const tileUrl = tile.getUrl ? tile.getUrl() : tile.url;
            tileZPlane = getZPlaneFromUrl(tileUrl);
        }

        // If we still can't determine Z-plane, use default priority
        if (tileZPlane < 0) {
            return PRIORITY.DEFAULT;
        }

        // Check if tile is in the current viewport
        // When tiledImage is unavailable, assume in viewport (conservative)
        const inViewport = tiledImage ? isTileInViewport(tile, tiledImage) : true;

        // Assign priority based on Z-plane and viewport visibility
        if (inViewport) {
            if (tileZPlane === currentZPlane) {
                return PRIORITY.VIEWPORT_CURRENT_Z;
            }
            // Adjacent Z-planes (within ±1)
            if (Math.abs(tileZPlane - currentZPlane) <= 1) {
                return PRIORITY.VIEWPORT_ADJACENT_Z;
            }
        }

        return PRIORITY.PREFETCH;
    }

    /**
     * Extract Z-plane index from tile URL
     * Matches evostitch URL pattern: .../z_XX/... where XX is zero-padded
     * @param {string} url - The tile URL
     * @returns {number} Z-plane index, or -1 if not found
     */
    function getZPlaneFromUrl(url) {
        if (!url) return -1;

        // Match /z_XX/ pattern (e.g., /z_00/, /z_05/, /z_12/)
        const match = url.match(/\/z_(\d+)\//);
        if (match) {
            return parseInt(match[1], 10);
        }
        return -1;
    }

    /**
     * Get the Z-plane index for a tiledImage
     * @param {OpenSeadragon.TiledImage} tiledImage
     * @returns {number} Z-plane index
     */
    function getTileZPlane(tiledImage) {
        if (!viewer.world) return 0;

        const itemCount = viewer.world.getItemCount();
        for (let i = 0; i < itemCount; i++) {
            if (viewer.world.getItemAt(i) === tiledImage) {
                return i;
            }
        }
        return 0;
    }

    /**
     * Check if a tile is within the current viewport
     * @param {OpenSeadragon.Tile} tile
     * @param {OpenSeadragon.TiledImage} tiledImage
     * @returns {boolean}
     */
    function isTileInViewport(tile, tiledImage) {
        if (!viewer.viewport || !tile.bounds) {
            return true; // Assume in viewport if we can't determine
        }

        try {
            // Get tile bounds in viewport coordinates
            const tileBounds = tiledImage.imageToViewportRectangle(tile.bounds);
            const viewportBounds = viewer.viewport.getBounds(true);

            // Check intersection
            return tileBounds.intersects(viewportBounds);
        } catch (e) {
            // If bounds calculation fails, assume in viewport
            return true;
        }
    }

    /**
     * Process the priority queue, dispatching jobs up to the current limit
     */
    function processQueue() {
        const pendingCount = pendingJobs.length;

        if (processingQueue || pendingCount === 0) {
            logDiagnostic('processQueue SKIP', {
                reason: processingQueue ? 'already processing' : 'queue empty',
                pendingJobs: pendingCount
            });
            return;
        }

        processingQueue = true;

        const imageLoader = viewer.imageLoader;
        const currentLimit = imageLoader.jobLimit;
        const currentJobs = imageLoader.jobsInProgress || 0;
        const availableSlots = Math.max(0, currentLimit - currentJobs);

        logDiagnostic('processQueue START', {
            pendingJobs: pendingCount,
            currentJobs: currentJobs,
            jobLimit: currentLimit,
            availableSlots: availableSlots
        });

        // Dispatch jobs up to available slots
        const toDispatch = Math.min(availableSlots, pendingJobs.length);
        for (let i = 0; i < toDispatch; i++) {
            const job = pendingJobs.shift();
            if (job) {
                log('Dispatching job with priority ' + job.priority);
                originalAddJob(job.options);
            }
        }

        processingQueue = false;

        logDiagnostic('processQueue END', {
            dispatched: toDispatch,
            remainingJobs: pendingJobs.length
        });

        // If there are still pending jobs and we couldn't dispatch any,
        // we'll process again when a job completes
        if (pendingJobs.length > 0 && toDispatch === 0) {
            // Schedule retry - jobs will complete and free slots
            logDiagnostic('processQueue RETRY scheduled', { delay: '50ms' });
            setTimeout(processQueue, 50);
        }

        // Stop heartbeat if queue is empty
        if (pendingJobs.length === 0) {
            stopHeartbeat();
        }
    }

    /**
     * Get the current tile level being drawn for a TiledImage
     * Returns the highest level that has tiles currently drawn in the viewport
     */
    function getDrawnTileLevel(tiledImage) {
        if (!tiledImage || !tiledImage.lastDrawn) {
            return -1;
        }
        let maxLevel = -1;
        for (let i = 0; i < tiledImage.lastDrawn.length; i++) {
            const tile = tiledImage.lastDrawn[i];
            if (tile && tile.level > maxLevel) {
                maxLevel = tile.level;
            }
        }
        return maxLevel;
    }

    /**
     * Calculate the needed tile level for current viewport zoom
     * This is the level that would provide ~1:1 pixel mapping
     */
    function getNeededTileLevel(tiledImage) {
        if (!tiledImage || !tiledImage.source || !viewer || !viewer.viewport) {
            return -1;
        }
        const source = tiledImage.source;
        const maxLevel = source.maxLevel;

        // Get viewport zoom
        const viewportZoom = viewer.viewport.getZoom(true);

        // Calculate what level gives us 1:1 pixels
        // At zoom=1, the image fits the container. Each level doubles resolution.
        const containerWidth = viewer.container.clientWidth;
        const imageWidth = source.width;

        // Pixels per viewport unit at current zoom
        const viewportWidth = viewer.viewport.getBounds(true).width;
        const pixelsPerUnit = containerWidth / viewportWidth;

        // Image units per viewport unit
        const imageUnitsPerViewportUnit = imageWidth;

        // Needed level: log2 of (pixels we need / pixels at level 0)
        const level0Size = source.getTileWidth ? source.getTileWidth(0) : 256;
        const neededScale = pixelsPerUnit / (imageWidth / Math.pow(2, maxLevel));
        const neededLevel = Math.ceil(Math.log2(neededScale));

        return Math.min(Math.max(0, neededLevel), maxLevel);
    }

    /**
     * Check resolution state of current Z-plane
     * Returns object with drawnLevel, neededLevel, and whether there's a mismatch
     */
    function checkResolutionState() {
        if (!viewer || !viewer.world) {
            return { drawnLevel: -1, neededLevel: -1, mismatch: false };
        }

        const tiledImage = viewer.world.getItemAt(currentZPlane);
        if (!tiledImage) {
            return { drawnLevel: -1, neededLevel: -1, mismatch: false };
        }

        const drawnLevel = getDrawnTileLevel(tiledImage);
        const neededLevel = getNeededTileLevel(tiledImage);
        const mismatch = drawnLevel >= 0 && neededLevel >= 0 && drawnLevel < neededLevel;

        return {
            drawnLevel: drawnLevel,
            neededLevel: neededLevel,
            maxLevel: tiledImage.source ? tiledImage.source.maxLevel : -1,
            mismatch: mismatch,
            fullyLoaded: tiledImage.getFullyLoaded ? tiledImage.getFullyLoaded() : false
        };
    }

    /**
     * Trigger resolution fix when mismatch detected
     * Clears OSD's coverage tracking to force re-request of higher-res tiles
     * Returns true if fix was triggered, false if skipped (cooldown or no viewer)
     */
    function triggerResolutionFix() {
        if (!viewer || !viewer.world || !viewer.viewport) {
            return false;
        }

        const tiledImage = viewer.world.getItemAt(currentZPlane);
        if (!tiledImage) {
            return false;
        }

        const currentZoom = viewer.viewport.getZoom(true);
        const now = performance.now();

        // Check cooldown: don't retry same Z/zoom within cooldown period
        const sameZ = resolutionFixState.lastAttemptZ === currentZPlane;
        const sameZoom = Math.abs(resolutionFixState.lastAttemptZoom - currentZoom) < 0.5;
        const withinCooldown = (now - resolutionFixState.lastAttemptTime) < resolutionFixState.cooldownMs;

        if (sameZ && sameZoom && withinCooldown) {
            logDiagnostic('triggerResolutionFix SKIPPED', {
                reason: 'cooldown',
                z: currentZPlane,
                zoom: currentZoom.toFixed(2),
                timeSinceLastAttempt: Math.round(now - resolutionFixState.lastAttemptTime) + 'ms'
            });
            return false;
        }

        // Record this attempt
        resolutionFixState.lastAttemptZ = currentZPlane;
        resolutionFixState.lastAttemptZoom = currentZoom;
        resolutionFixState.lastAttemptTime = now;

        // Clear OSD's coverage tracking to force tile re-requests
        // Coverage is a nested dict: coverage[level][x][y] = boolean
        // Clearing it makes OSD think no tiles are loaded, triggering new requests
        if (tiledImage._coverage) {
            tiledImage._coverage = {};
        }

        // Mark TiledImage as needing redraw
        tiledImage._needsDraw = true;

        // Trigger OSD to recalculate and request tiles
        viewer.forceRedraw();

        logDiagnostic('triggerResolutionFix TRIGGERED', {
            z: currentZPlane,
            zoom: currentZoom.toFixed(2),
            action: 'cleared coverage, forced redraw'
        });

        return true;
    }

    /**
     * Start heartbeat interval to process queue when no OSD events fire
     * Called when jobs are added to ensure queue gets processed
     */
    function startHeartbeat() {
        if (heartbeatIntervalId !== null) {
            return; // Already running
        }

        heartbeatIntervalId = setInterval(function() {
            // Always check resolution state for diagnostics
            const resState = checkResolutionState();

            if (pendingJobs.length > 0) {
                logDiagnostic('heartbeat TICK', {
                    pendingJobs: pendingJobs.length,
                    resolution: resState
                });
                processQueue();
            } else {
                // Queue is empty - check for resolution mismatch
                // Only trigger fix when fully loaded (no in-flight tiles)
                // Otherwise mismatch is expected during normal loading
                if (resState.mismatch && resState.fullyLoaded) {
                    logDiagnostic('heartbeat RESOLUTION_MISMATCH', {
                        currentZ: currentZPlane,
                        drawnLevel: resState.drawnLevel,
                        neededLevel: resState.neededLevel,
                        maxLevel: resState.maxLevel,
                        fullyLoaded: resState.fullyLoaded
                    });

                    // Attempt to fix resolution mismatch
                    const fixTriggered = triggerResolutionFix();
                    if (fixTriggered) {
                        // Keep heartbeat running to monitor if fix worked
                        // Don't stop yet - give OSD time to request new tiles
                        return;
                    }
                    // Fix was skipped (cooldown) - stop heartbeat
                }
                // Queue drained and no mismatch (or fix on cooldown), stop heartbeat
                stopHeartbeat();
            }
        }, HEARTBEAT_INTERVAL_MS);

        logDiagnostic('heartbeat STARTED', { interval: HEARTBEAT_INTERVAL_MS + 'ms' });
    }

    /**
     * Stop heartbeat interval when queue is empty
     */
    function stopHeartbeat() {
        if (heartbeatIntervalId === null) {
            return; // Not running
        }

        clearInterval(heartbeatIntervalId);
        heartbeatIntervalId = null;
        logDiagnostic('heartbeat STOPPED', { reason: 'queue empty' });
    }

    /**
     * Set up event handlers for animation state tracking
     */
    function setupAnimationHandlers() {
        // Animation start events
        viewer.addHandler('animation-start', onAnimationStart);
        viewer.addHandler('pan', onAnimationStart);
        viewer.addHandler('zoom', onAnimationStart);

        // Animation end event
        viewer.addHandler('animation-finish', onAnimationFinish);

        // Tile loaded event - process queue when slots free up
        viewer.addHandler('tile-loaded', onTileLoaded);
        viewer.addHandler('tile-load-failed', onTileLoaded);
    }

    /**
     * Handle animation start - reduce concurrent requests and cancel prefetch
     */
    function onAnimationStart() {
        if (isAnimating) return;

        isAnimating = true;

        // Clear any pending idle restore
        if (idleRestoreTimeout) {
            clearTimeout(idleRestoreTimeout);
            idleRestoreTimeout = null;
        }

        // Cancel any pending prefetch during animation
        if (prefetchTimeout) {
            clearTimeout(prefetchTimeout);
            prefetchTimeout = null;
        }

        // Clear prefetch jobs if viewport changed significantly
        if (hasViewportChangedSignificantly()) {
            clearPrefetchJobs();
        }

        // Reduce job limit during animation
        viewer.imageLoader.jobLimit = CONFIG.animatingJobLimit;
        log('Animation started, jobLimit reduced to ' + CONFIG.animatingJobLimit);
    }

    /**
     * Handle animation finish - restore job limit and schedule prefetch
     */
    function onAnimationFinish() {
        if (!isAnimating) return;

        // Delay restoring to avoid thrashing during rapid interactions
        idleRestoreTimeout = setTimeout(function() {
            isAnimating = false;
            viewer.imageLoader.jobLimit = CONFIG.idleJobLimit;
            log('Animation finished, jobLimit restored to ' + CONFIG.idleJobLimit);

            // Process any pending jobs with full capacity
            processQueue();

            // Schedule prefetch for adjacent Z-planes after viewport settles
            schedulePrefetch();
        }, CONFIG.idleRestoreDelay);
    }

    /**
     * Handle tile loaded - process queue as slots free up
     */
    function onTileLoaded() {
        // Small delay to let OSD update its internal state
        setTimeout(processQueue, 10);
    }

    /**
     * Update the current Z-plane (call when user changes Z)
     * @param {number} z - New Z-plane index
     */
    function setCurrentZ(z) {
        if (z === currentZPlane) return;

        const oldZ = currentZPlane;
        currentZPlane = z;

        // Update Z-velocity tracking
        const now = performance.now();
        const dt = now - lastZChangeTime;

        if (dt < 500 && lastZChangeTime > 0) {
            // Recent change - calculate velocity (planes per second)
            zVelocity = (z - lastZPlane) / dt * 1000;
        } else {
            // No recent change or first change - reset velocity
            zVelocity = 0;
        }

        lastZChangeTime = now;
        lastZPlane = z;

        log('Z-plane changed from ' + oldZ + ' to ' + z + ', velocity=' + zVelocity.toFixed(1) + ' planes/sec');

        // Log resolution state for new Z-plane
        const resState = checkResolutionState();
        logDiagnostic('setCurrentZ RESOLUTION', {
            newZ: z,
            oldZ: oldZ,
            drawnLevel: resState.drawnLevel,
            neededLevel: resState.neededLevel,
            maxLevel: resState.maxLevel,
            mismatch: resState.mismatch,
            fullyLoaded: resState.fullyLoaded,
            pendingJobs: pendingJobs.length
        });

        // Clear prefetched planes since current Z changed
        prefetchedZPlanes.clear();

        // Reset resolution fix state for new Z-plane
        // This allows immediate fix attempt if mismatch detected
        resolutionFixState.lastAttemptZ = -1;

        // Re-prioritize pending jobs
        reprioritizeQueue();

        // Schedule prefetch for adjacent Z-planes
        schedulePrefetch();
    }

    /**
     * Re-sort the pending queue based on current state
     */
    function reprioritizeQueue() {
        pendingJobs.forEach(function(job) {
            job.priority = calculatePriority(job.options);
        });

        pendingJobs.sort(function(a, b) {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            return a.timestamp - b.timestamp;
        });

        log('Queue reprioritized, ' + pendingJobs.length + ' jobs pending');
    }

    /**
     * Clear the pending queue (e.g., on significant viewport change)
     */
    function clearQueue() {
        const cleared = pendingJobs.length;
        pendingJobs = [];
        log('Queue cleared, ' + cleared + ' jobs removed');
    }

    /**
     * Clear only prefetch jobs from the queue (priority === PREFETCH)
     * Called when viewport changes significantly to avoid loading stale tiles
     */
    function clearPrefetchJobs() {
        const beforeCount = pendingJobs.length;
        pendingJobs = pendingJobs.filter(function(job) {
            return job.priority !== PRIORITY.PREFETCH;
        });
        const cleared = beforeCount - pendingJobs.length;
        if (cleared > 0) {
            log('Cleared ' + cleared + ' prefetch jobs from queue');
        }
        prefetchedZPlanes.clear();
    }

    /**
     * Schedule prefetch for adjacent Z-planes within current viewport bounds
     * Called after Z-plane change or viewport settles
     */
    function schedulePrefetch() {
        // Cancel any pending prefetch
        if (prefetchTimeout) {
            clearTimeout(prefetchTimeout);
            prefetchTimeout = null;
        }

        // Don't prefetch during animation
        if (isAnimating) {
            return;
        }

        // Delay prefetch to allow viewport to settle
        prefetchTimeout = setTimeout(function() {
            triggerZPrefetch();
        }, CONFIG.prefetch.prefetchDelay);
    }

    /**
     * Predict which Z-planes to prefetch based on current velocity
     * @returns {number[]} Array of Z-plane indices to prefetch
     */
    function predictPrefetchPlanes() {
        const planes = [];

        if (Math.abs(zVelocity) < 1) {
            // Slow or stopped navigation: prefetch ±1 (default behavior)
            if (currentZPlane > 0) planes.push(currentZPlane - 1);
            if (currentZPlane < zPlaneCount - 1) planes.push(currentZPlane + 1);
        } else {
            // Fast navigation: prefetch in velocity direction
            const direction = Math.sign(zVelocity);
            // Depth scales with speed: 1-5 planes ahead
            const depth = Math.min(5, Math.ceil(Math.abs(zVelocity) / 2));

            for (let i = 1; i <= depth; i++) {
                const targetZ = currentZPlane + direction * i;
                if (targetZ >= 0 && targetZ < zPlaneCount) {
                    planes.push(targetZ);
                }
            }

            // Also prefetch 1 plane in opposite direction (for direction reversal)
            const oppositeZ = currentZPlane - direction;
            if (oppositeZ >= 0 && oppositeZ < zPlaneCount) {
                planes.push(oppositeZ);
            }
        }

        return planes;
    }

    /**
     * Trigger predictive prefetch for Z-planes based on navigation velocity
     */
    function triggerZPrefetch() {
        if (!viewer || !viewer.viewport || !viewer.world) {
            return;
        }

        const bounds = viewer.viewport.getBounds(true);
        lastPrefetchBounds = bounds;

        const planesToPrefetch = predictPrefetchPlanes();

        for (let i = 0; i < planesToPrefetch.length; i++) {
            const targetZ = planesToPrefetch[i];

            // Skip if already prefetched for this viewport
            if (prefetchedZPlanes.has(targetZ)) continue;

            const tiledImage = viewer.world.getItemAt(targetZ);
            if (!tiledImage) continue;

            // Request tiles within viewport bounds for this Z-plane
            requestTilesInBounds(tiledImage, bounds, targetZ);
            prefetchedZPlanes.add(targetZ);
        }

        const velocityInfo = Math.abs(zVelocity) >= 1
            ? 'velocity=' + zVelocity.toFixed(1) + ' planes/sec'
            : 'slow/idle';
        log('Prefetch triggered for Z-planes ' + JSON.stringify(planesToPrefetch) +
            ' (' + velocityInfo + ', current=' + currentZPlane + ')');
    }

    /**
     * Request tiles within specified viewport bounds for a tiledImage
     * @param {OpenSeadragon.TiledImage} tiledImage - The tiled image (Z-plane)
     * @param {OpenSeadragon.Rect} bounds - Viewport bounds
     * @param {number} zPlane - Z-plane index for logging
     */
    function requestTilesInBounds(tiledImage, bounds, zPlane) {
        if (!tiledImage || !tiledImage.source) {
            return;
        }

        // Enable preloading for this tiledImage so tiles load even at opacity 0
        // setPreload is a boolean flag - only needs to be set once per tiledImage
        tiledImage.setPreload(true);

        // Force a redraw cycle to trigger OpenSeadragon's tile loading system
        // This makes OSD calculate needed tiles and queue them through our wrapped addJob
        viewer.forceRedraw();

        log('Prefetch triggered for Z=' + zPlane + ' via forceRedraw');
    }

    /**
     * Check if viewport has changed significantly from last prefetch
     * @returns {boolean} True if viewport changed beyond threshold
     */
    function hasViewportChangedSignificantly() {
        if (!lastPrefetchBounds || !viewer || !viewer.viewport) {
            return true;
        }

        const currentBounds = viewer.viewport.getBounds(true);

        // Calculate overlap ratio
        const intersection = lastPrefetchBounds.intersection(currentBounds);
        if (!intersection) {
            return true;
        }

        const lastArea = lastPrefetchBounds.width * lastPrefetchBounds.height;
        const currentArea = currentBounds.width * currentBounds.height;
        const intersectionArea = intersection.width * intersection.height;

        // Use minimum of overlap with both bounds
        const overlapRatio = Math.min(
            intersectionArea / lastArea,
            intersectionArea / currentArea
        );

        return overlapRatio < (1 - CONFIG.prefetch.viewportChangeThreshold);
    }

    /**
     * Cancel pending prefetch and clear prefetched state
     */
    function cancelPrefetch() {
        if (prefetchTimeout) {
            clearTimeout(prefetchTimeout);
            prefetchTimeout = null;
        }
        clearPrefetchJobs();
        log('Prefetch cancelled');
    }

    /**
     * Disable the prioritizer and restore original behavior
     */
    function destroy() {
        if (!enabled) return;

        // Restore original addJob
        if (viewer && viewer.imageLoader && originalAddJob) {
            viewer.imageLoader.addJob = originalAddJob;
            viewer.imageLoader.jobLimit = originalJobLimit;
        }

        // Remove event handlers
        if (viewer) {
            viewer.removeHandler('animation-start', onAnimationStart);
            viewer.removeHandler('pan', onAnimationStart);
            viewer.removeHandler('zoom', onAnimationStart);
            viewer.removeHandler('animation-finish', onAnimationFinish);
            viewer.removeHandler('tile-loaded', onTileLoaded);
            viewer.removeHandler('tile-load-failed', onTileLoaded);
        }

        // Clear state
        if (idleRestoreTimeout) {
            clearTimeout(idleRestoreTimeout);
        }
        if (prefetchTimeout) {
            clearTimeout(prefetchTimeout);
        }
        stopHeartbeat();
        pendingJobs = [];
        prefetchedZPlanes.clear();
        lastPrefetchBounds = null;
        enabled = false;

        log('Destroyed');
    }

    /**
     * Get current state for debugging
     * @returns {Object} Current prioritizer state
     */
    function getState() {
        return {
            enabled: enabled,
            currentZ: currentZPlane,
            zCount: zPlaneCount,
            isAnimating: isAnimating,
            pendingJobs: pendingJobs.length,
            jobLimit: viewer ? viewer.imageLoader.jobLimit : null,
            originalJobLimit: originalJobLimit,
            queuePriorities: pendingJobs.map(function(j) { return j.priority; }),
            heartbeat: {
                active: heartbeatIntervalId !== null,
                intervalMs: HEARTBEAT_INTERVAL_MS
            },
            prefetch: {
                prefetchedZPlanes: Array.from(prefetchedZPlanes),
                hasPendingPrefetch: prefetchTimeout !== null,
                lastPrefetchBounds: lastPrefetchBounds,
                zVelocity: zVelocity,
                predictedPlanes: predictPrefetchPlanes()
            },
            resolution: checkResolutionState(),
            resolutionFix: {
                lastAttemptZ: resolutionFixState.lastAttemptZ,
                lastAttemptZoom: resolutionFixState.lastAttemptZoom,
                timeSinceAttempt: resolutionFixState.lastAttemptTime > 0
                    ? Math.round(performance.now() - resolutionFixState.lastAttemptTime) + 'ms'
                    : 'never',
                cooldownMs: resolutionFixState.cooldownMs
            }
        };
    }

    /**
     * Debug logging
     */
    function log(message) {
        if (CONFIG.debug) {
            console.log('[evostitch] TilePrioritizer: ' + message);
        }
    }

    /**
     * Diagnostic logging for processQueue activity
     * Used to diagnose tile loading stalls
     */
    function logDiagnostic(message, data) {
        if (CONFIG.diagnostic) {
            const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
            // Stringify data for Playwright console capture
            const dataStr = data ? JSON.stringify(data) : '';
            console.log('[DIAG ' + timestamp + '] ' + message + ' ' + dataStr);
        }
    }

    // Expose public API
    window.evostitch = window.evostitch || {};
    window.evostitch.tilePrioritizer = {
        init: init,
        setCurrentZ: setCurrentZ,
        clearQueue: clearQueue,
        reprioritizeQueue: reprioritizeQueue,
        destroy: destroy,
        getState: getState,
        setDebug: function(enabled) { CONFIG.debug = enabled; },
        setDiagnostic: function(enabled) { CONFIG.diagnostic = enabled; },
        // Z-aware prefetching API (W2 Step 2.3)
        schedulePrefetch: schedulePrefetch,
        cancelPrefetch: cancelPrefetch,
        triggerZPrefetch: triggerZPrefetch,
        // Resolution detection and fix API (for Z-plane resolution fix)
        checkResolutionState: checkResolutionState,
        triggerResolutionFix: triggerResolutionFix,
        // Expose constants for testing
        PRIORITY: PRIORITY,
        CONFIG: CONFIG
    };

})();
