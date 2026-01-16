// evostitch Blur-Up Loader - Progressive Tile Resolution
// Shows low-res placeholder while high-res tile loads for faster perceived performance
// Expected improvement: -88% time-to-first-visual on slow networks

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // Placeholder level offset from target (3 levels = 8x smaller tile)
        placeholderLevelOffset: 3,
        // Minimum level to use for placeholders (avoid requesting tiny tiles)
        minPlaceholderLevel: 0,
        // Only show placeholders for tiles loading longer than this (ms)
        // Prevents unnecessary work on fast connections
        placeholderDelayMs: 100,
        // Maximum concurrent placeholder requests
        maxConcurrentPlaceholders: 4,
        // Enable debug logging
        debug: false
    };

    // State
    let viewer = null;
    let enabled = false;
    let activePlaceholders = new Map(); // tileKey -> { element, targetTile, timeout }
    let pendingPlaceholderCount = 0;

    /**
     * Initialize the blur-up loader with an OpenSeadragon viewer
     * @param {OpenSeadragon.Viewer} osdViewer - The OpenSeadragon viewer instance
     * @param {Object} options - Optional configuration overrides
     */
    function init(osdViewer, options) {
        if (!osdViewer) {
            console.error('[evostitch] BlurUpLoader: Invalid viewer instance');
            return false;
        }

        viewer = osdViewer;

        // Apply options
        if (options) {
            Object.assign(CONFIG, options);
        }

        // Set up event handlers
        setupEventHandlers();

        enabled = true;
        log('Initialized with placeholderLevelOffset=' + CONFIG.placeholderLevelOffset);
        return true;
    }

    /**
     * Set up OpenSeadragon event handlers for tile loading
     */
    function setupEventHandlers() {
        // When a tile starts loading, schedule placeholder display
        viewer.addHandler('tile-loading', onTileLoading);

        // When tile finishes loading, remove placeholder
        viewer.addHandler('tile-loaded', onTileLoaded);

        // When tile fails to load, also remove placeholder
        viewer.addHandler('tile-load-failed', onTileLoadFailed);

        // Clean up on viewport changes (removes stale placeholders)
        viewer.addHandler('animation-start', onAnimationStart);
    }

    /**
     * Generate a unique key for a tile
     * @param {OpenSeadragon.Tile} tile
     * @returns {string} Unique tile key
     */
    function getTileKey(tile) {
        // Use tile position and level to create unique key
        return tile.level + '_' + tile.x + '_' + tile.y + '_' + (tile.tiledImage ? viewer.world.getIndexOfItem(tile.tiledImage) : 0);
    }

    /**
     * Handle tile-loading event - schedule placeholder display
     * @param {Object} event - OpenSeadragon tile-loading event
     */
    function onTileLoading(event) {
        const tile = event.tile;
        const tiledImage = event.tiledImage;

        if (!tile || !tiledImage) return;

        // Skip if placeholder level would be too low
        const placeholderLevel = tile.level - CONFIG.placeholderLevelOffset;
        if (placeholderLevel < CONFIG.minPlaceholderLevel) {
            log('Skipping placeholder for tile at level ' + tile.level + ' (placeholder level too low)');
            return;
        }

        // Skip if we have too many concurrent placeholders
        if (pendingPlaceholderCount >= CONFIG.maxConcurrentPlaceholders) {
            log('Skipping placeholder (max concurrent reached)');
            return;
        }

        const tileKey = getTileKey(tile);

        // Don't create duplicate placeholders
        if (activePlaceholders.has(tileKey)) {
            return;
        }

        // Schedule placeholder display after delay
        // This avoids showing placeholders for tiles that load quickly
        const timeout = setTimeout(function() {
            showPlaceholder(tile, tiledImage, placeholderLevel);
        }, CONFIG.placeholderDelayMs);

        // Track this pending placeholder
        activePlaceholders.set(tileKey, {
            element: null,
            targetTile: tile,
            tiledImage: tiledImage,
            timeout: timeout,
            placeholderLevel: placeholderLevel
        });
        pendingPlaceholderCount++;

        log('Scheduled placeholder for tile ' + tileKey + ' at level ' + placeholderLevel);
    }

    /**
     * Show a placeholder for a loading tile
     * @param {OpenSeadragon.Tile} tile - The target tile
     * @param {OpenSeadragon.TiledImage} tiledImage - The tiled image
     * @param {number} placeholderLevel - Level to use for placeholder
     */
    function showPlaceholder(tile, tiledImage, placeholderLevel) {
        const tileKey = getTileKey(tile);
        const placeholder = activePlaceholders.get(tileKey);

        if (!placeholder) return;

        // Clear the timeout since we're now showing the placeholder
        placeholder.timeout = null;

        // Calculate which placeholder tile covers the target tile's area
        // At 3 levels lower, each placeholder tile covers 8x8 target tiles
        const levelDiff = tile.level - placeholderLevel;
        const scale = Math.pow(2, levelDiff);
        const placeholderX = Math.floor(tile.x / scale);
        const placeholderY = Math.floor(tile.y / scale);

        // Get the TileSource to build the URL
        const source = tiledImage.source;
        if (!source || !source.getTileUrl) {
            log('No tile source available for placeholder');
            return;
        }

        // Get placeholder tile URL
        const placeholderUrl = source.getTileUrl(placeholderLevel, placeholderX, placeholderY);
        if (!placeholderUrl) {
            log('Could not get placeholder URL');
            return;
        }

        // Create placeholder image element
        const img = document.createElement('img');
        img.className = 'blur-up-placeholder';
        img.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;opacity:0.8;';

        // Calculate position in viewport coordinates
        const tileBounds = tile.bounds;
        if (!tileBounds) {
            log('No tile bounds available');
            return;
        }

        // Convert tile bounds to viewport rectangle
        const viewportRect = tiledImage.imageToViewportRectangle(tileBounds.x, tileBounds.y, tileBounds.width, tileBounds.height);

        // Convert to pixel coordinates relative to canvas
        const topLeft = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(viewportRect.x, viewportRect.y));
        const bottomRight = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(viewportRect.x + viewportRect.width, viewportRect.y + viewportRect.height));

        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;

        img.style.left = topLeft.x + 'px';
        img.style.top = topLeft.y + 'px';
        img.style.width = width + 'px';
        img.style.height = height + 'px';
        img.style.zIndex = '1'; // Above canvas but below UI

        // Add to viewer container
        img.src = placeholderUrl;
        img.onerror = function() {
            // Silently handle missing placeholder tiles
            log('Placeholder failed to load: ' + placeholderUrl);
            removePlaceholder(tileKey);
        };

        viewer.container.appendChild(img);
        placeholder.element = img;

        log('Showing placeholder for tile ' + tileKey + ' from level ' + placeholderLevel);
    }

    /**
     * Handle tile-loaded event - remove placeholder
     * @param {Object} event - OpenSeadragon tile-loaded event
     */
    function onTileLoaded(event) {
        const tile = event.tile;
        if (!tile) return;

        const tileKey = getTileKey(tile);
        removePlaceholder(tileKey);
    }

    /**
     * Handle tile-load-failed event - remove placeholder
     * @param {Object} event - OpenSeadragon tile-load-failed event
     */
    function onTileLoadFailed(event) {
        const tile = event.tile;
        if (!tile) return;

        const tileKey = getTileKey(tile);
        removePlaceholder(tileKey);
    }

    /**
     * Remove a placeholder by tile key
     * @param {string} tileKey - The tile key
     */
    function removePlaceholder(tileKey) {
        const placeholder = activePlaceholders.get(tileKey);
        if (!placeholder) return;

        // Clear timeout if still pending
        if (placeholder.timeout) {
            clearTimeout(placeholder.timeout);
        }

        // Remove element from DOM
        if (placeholder.element && placeholder.element.parentNode) {
            placeholder.element.parentNode.removeChild(placeholder.element);
        }

        activePlaceholders.delete(tileKey);
        pendingPlaceholderCount = Math.max(0, pendingPlaceholderCount - 1);

        log('Removed placeholder for tile ' + tileKey);
    }

    /**
     * Handle animation start - update placeholder positions
     * Since placeholders are positioned absolutely, they don't move with the viewport
     * For simplicity, we remove them during animation
     */
    function onAnimationStart() {
        // Remove all placeholders during animation to avoid visual glitches
        // This is acceptable because:
        // 1. Animation is usually fast
        // 2. Placeholders will be re-created for new tiles
        clearAllPlaceholders();
    }

    /**
     * Clear all active placeholders
     */
    function clearAllPlaceholders() {
        activePlaceholders.forEach(function(placeholder, tileKey) {
            if (placeholder.timeout) {
                clearTimeout(placeholder.timeout);
            }
            if (placeholder.element && placeholder.element.parentNode) {
                placeholder.element.parentNode.removeChild(placeholder.element);
            }
        });
        activePlaceholders.clear();
        pendingPlaceholderCount = 0;
        log('Cleared all placeholders');
    }

    /**
     * Disable the blur-up loader and clean up
     */
    function destroy() {
        if (!enabled) return;

        // Remove event handlers
        if (viewer) {
            viewer.removeHandler('tile-loading', onTileLoading);
            viewer.removeHandler('tile-loaded', onTileLoaded);
            viewer.removeHandler('tile-load-failed', onTileLoadFailed);
            viewer.removeHandler('animation-start', onAnimationStart);
        }

        // Clear all placeholders
        clearAllPlaceholders();

        viewer = null;
        enabled = false;

        log('Destroyed');
    }

    /**
     * Get current state for debugging
     * @returns {Object} Current loader state
     */
    function getState() {
        return {
            enabled: enabled,
            activePlaceholders: activePlaceholders.size,
            pendingPlaceholderCount: pendingPlaceholderCount,
            config: { ...CONFIG }
        };
    }

    /**
     * Debug logging
     */
    function log(message) {
        if (CONFIG.debug) {
            console.log('[evostitch] BlurUpLoader: ' + message);
        }
    }

    // Expose public API
    window.evostitch = window.evostitch || {};
    window.evostitch.blurUpLoader = {
        init: init,
        destroy: destroy,
        getState: getState,
        clearAllPlaceholders: clearAllPlaceholders,
        setDebug: function(value) { CONFIG.debug = value; },
        CONFIG: CONFIG
    };

})();
