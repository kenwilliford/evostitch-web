// evostitch Viewport Math — shared viewport geometry for zarr modules
// Extracted from zarr-3d-loader.js (W10) so zarr-prefetch.js can reuse
// the same zoom→level, viewState→bounds, and bounds→tileRange logic.
//
// Dependencies: none (pure math, no DOM or network)

(function() {
    'use strict';

    /**
     * Map deck.gl zoom to zarr resolution level index.
     * deck.gl zoom: 0 = 1:1, -1 = 50%, -2 = 25%, etc.
     * Level 0 = finest (full res), level N = coarsest
     * @param {number} zoom - deck.gl zoom value
     * @param {number} numLevels - total resolution levels
     * @returns {number} clamped level index
     */
    function zoomToLevel(zoom, numLevels) {
        var level = Math.round(-zoom);
        return Math.max(0, Math.min(numLevels - 1, level));
    }

    /**
     * Compute visible data bounds from deck.gl viewState.
     * Returns pixel coordinates at full resolution.
     * @param {Object} viewState - { target: [x,y,z], zoom }
     * @param {Object} containerSize - { width, height }
     * @returns {Object} { minX, maxX, minY, maxY } in data pixels (full-res)
     */
    function viewStateToBounds(viewState, containerSize) {
        var scale = Math.pow(2, viewState.zoom);
        var halfW = (containerSize.width / 2) / scale;
        var halfH = (containerSize.height / 2) / scale;
        var cx = viewState.target[0];
        var cy = viewState.target[1];
        return {
            minX: cx - halfW,
            maxX: cx + halfW,
            minY: cy - halfH,
            maxY: cy + halfH
        };
    }

    /**
     * Convert data bounds to tile range at a resolution level.
     * Adds margin tiles for pan tolerance.
     * @param {Object} bounds - { minX, maxX, minY, maxY } in full-res data pixels
     * @param {Object} levelInfo - resolution level info from prefetch
     * @param {number} margin - extra tiles per side (default 1)
     * @returns {Object} { minTileX, maxTileX, minTileY, maxTileY, tileCountX, tileCountY }
     */
    function boundsToTileRange(bounds, levelInfo, margin) {
        if (margin === undefined) margin = 1;
        var level = levelInfo.level;
        // Scale bounds down to this resolution level
        var scaleFactor = Math.pow(2, level);
        var scaledMinX = bounds.minX / scaleFactor;
        var scaledMaxX = bounds.maxX / scaleFactor;
        var scaledMinY = bounds.minY / scaleFactor;
        var scaledMaxY = bounds.maxY / scaleFactor;

        var chunkW = levelInfo.xChunkSize;
        var chunkH = levelInfo.yChunkSize;

        var minTileX = Math.max(0, Math.floor(scaledMinX / chunkW) - margin);
        var maxTileX = Math.min(levelInfo.xChunks - 1, Math.floor(scaledMaxX / chunkW) + margin);
        var minTileY = Math.max(0, Math.floor(scaledMinY / chunkH) - margin);
        var maxTileY = Math.min(levelInfo.yChunks - 1, Math.floor(scaledMaxY / chunkH) + margin);

        return {
            minTileX: minTileX,
            maxTileX: maxTileX,
            minTileY: minTileY,
            maxTileY: maxTileY,
            tileCountX: Math.max(0, maxTileX - minTileX + 1),
            tileCountY: Math.max(0, maxTileY - minTileY + 1)
        };
    }

    // Expose public API
    window.evostitch = window.evostitch || {};
    window.evostitch.viewportMath = {
        zoomToLevel: zoomToLevel,
        viewStateToBounds: viewStateToBounds,
        boundsToTileRange: boundsToTileRange
    };

})();
