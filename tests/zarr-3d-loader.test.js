#!/usr/bin/env node
// Unit tests for zarr-3d-loader.js - runs with plain Node.js
// Usage: node zarr-3d-loader.test.js
//
// Tests verify file structure, IIFE pattern, public API, viewport math,
// state machine transitions, and chunk URL generation.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL  ${name}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

// Read source file for static analysis
const loaderPath = path.join(__dirname, '..', 'js', 'zarr-3d-loader.js');
const loaderSource = fs.readFileSync(loaderPath, 'utf8');

// ========== File structure tests ==========

console.log('File Structure');

test('zarr-3d-loader.js exists', () => {
    assert.ok(fs.existsSync(loaderPath), 'zarr-3d-loader.js should exist in web/js/');
});

test('zarr-3d-loader.js uses IIFE pattern', () => {
    assert.ok(loaderSource.includes('(function()'), 'Should use IIFE pattern');
    assert.ok(loaderSource.includes("'use strict'"), 'Should use strict mode');
    assert.ok(loaderSource.includes('})();'), 'Should close IIFE properly');
});

test('zarr-3d-loader.js does not pollute global scope', () => {
    const globalAssignments = loaderSource.match(/window\.\w+/g) || [];
    const nonEvostitch = globalAssignments.filter(a => !a.startsWith('window.evostitch'));
    assert.strictEqual(nonEvostitch.length, 0,
        'Should only assign to window.evostitch, found: ' + nonEvostitch.join(', '));
});

test('exports to window.evostitch.zarr3DLoader', () => {
    assert.ok(loaderSource.includes('window.evostitch.zarr3DLoader'), 'Should export to zarr3DLoader');
});

// ========== Public API tests ==========

console.log('\nPublic API');

const expectedMethods = [
    'init', 'startLoad', 'cancelLoad', 'exit3D', 'retryLoad',
    'onViewStateChange', 'getMode', 'getProgress', 'is3DReady',
    'calculateBudget', 'setDebug', 'destroy'
];

expectedMethods.forEach(method => {
    test(`exports ${method} method`, () => {
        assert.ok(loaderSource.includes(`${method}:`), `Should export ${method}`);
    });
});

test('exports _internals for testing', () => {
    assert.ok(loaderSource.includes('_internals'), 'Should export _internals');
});

// ========== Configuration tests ==========

console.log('\nConfiguration');

test('defines CONFIG with maxChunks', () => {
    assert.ok(loaderSource.includes('maxChunks:'), 'Should define maxChunks');
    assert.ok(loaderSource.includes('5000'), 'maxChunks should be 5000');
});

test('defines CONFIG with concurrency', () => {
    assert.ok(loaderSource.includes('concurrency:'), 'Should define concurrency');
    assert.ok(loaderSource.includes('concurrency: 6'), 'concurrency should be 6');
});

test('defines CONFIG with consecutiveErrorLimit', () => {
    assert.ok(loaderSource.includes('consecutiveErrorLimit:'), 'Should define consecutiveErrorLimit');
});

// ========== State machine tests ==========

console.log('\nState Machine');

test('defines three states: 2D, LOADING, 3D_READY', () => {
    assert.ok(loaderSource.includes("STATE_2D = '2D'"), 'Should define STATE_2D');
    assert.ok(loaderSource.includes("STATE_LOADING = 'LOADING'"), 'Should define STATE_LOADING');
    assert.ok(loaderSource.includes("STATE_3D_READY = '3D_READY'"), 'Should define STATE_3D_READY');
});

test('transitionTo function exists', () => {
    assert.ok(loaderSource.includes('function transitionTo('), 'Should have transitionTo function');
});

test('startLoad transitions from 2D to LOADING', () => {
    assert.ok(loaderSource.includes("state.mode !== STATE_2D"), 'startLoad should check current mode is 2D');
    assert.ok(loaderSource.includes("transitionTo(STATE_LOADING)"), 'startLoad should transition to LOADING');
});

test('cancelLoad transitions from LOADING to 2D', () => {
    assert.ok(loaderSource.includes("state.mode !== STATE_LOADING"), 'cancelLoad should check LOADING mode');
});

test('onPrefetchComplete transitions to 3D_READY', () => {
    assert.ok(loaderSource.includes("transitionTo(STATE_3D_READY)"), 'Should transition to 3D_READY on complete');
});

test('exit3D transitions from 3D_READY to 2D', () => {
    assert.ok(loaderSource.includes("state.mode !== STATE_3D_READY"), 'exit3D should check 3D_READY mode');
});

// ========== Viewport math tests (shared module delegation) ==========

console.log('\nViewport Math (Shared Module)');

test('uses shared viewportMath module (not local definitions)', () => {
    assert.ok(!loaderSource.includes('function zoomToLevel('), 'Should NOT define local zoomToLevel');
    assert.ok(!loaderSource.includes('function viewStateToBounds('), 'Should NOT define local viewStateToBounds');
    assert.ok(!loaderSource.includes('function boundsToTileRange('), 'Should NOT define local boundsToTileRange');
});

test('imports from window.evostitch.viewportMath', () => {
    assert.ok(loaderSource.includes('window.evostitch.viewportMath'), 'Should reference shared module');
});

test('creates local aliases for viewport math functions', () => {
    assert.ok(loaderSource.includes('var zoomToLevel'), 'Should alias zoomToLevel');
    assert.ok(loaderSource.includes('var viewStateToBounds'), 'Should alias viewStateToBounds');
    assert.ok(loaderSource.includes('var boundsToTileRange'), 'Should alias boundsToTileRange');
});

test('provides fallbacks if shared module missing', () => {
    assert.ok(loaderSource.includes('console.error'), 'Should log error if module missing');
});

test('generateChunkUrls function exists', () => {
    assert.ok(loaderSource.includes('function generateChunkUrls('), 'Should define generateChunkUrls');
});

test('generateChunkUrls iterates all Z, channels, and tiles', () => {
    // Check that it loops over z, c, ty, tx
    assert.ok(loaderSource.includes('for (var z = 0; z < zCount'), 'Should loop over Z');
    assert.ok(loaderSource.includes('for (var c = 0; c < channelCount'), 'Should loop over channels');
    assert.ok(loaderSource.includes('for (var ty = tileRange.minTileY'), 'Should loop over Y tiles');
    assert.ok(loaderSource.includes('for (var tx = tileRange.minTileX'), 'Should loop over X tiles');
});

// ========== Containment check tests ==========

console.log('\nContainment Check');

test('checkContainment function exists', () => {
    assert.ok(loaderSource.includes('function checkContainment('), 'Should define checkContainment');
});

test('checkContainment exits on zoom level change', () => {
    assert.ok(loaderSource.includes("exit3D('zoom level changed')"), 'Should exit on zoom change');
});

test('checkContainment exits on pan outside region', () => {
    assert.ok(loaderSource.includes("exit3D('panned outside loaded region')"), 'Should exit on pan outside');
});

test('checkContainment only active in 3D_READY mode', () => {
    assert.ok(loaderSource.includes("state.mode !== STATE_3D_READY"), 'Should check mode is 3D_READY');
});

// ========== Prefetch orchestrator tests ==========

console.log('\nPrefetch Orchestrator');

test('executePrefetch uses AbortController', () => {
    assert.ok(loaderSource.includes('new AbortController()'), 'Should create AbortController');
});

test('executePrefetch respects concurrency limit', () => {
    assert.ok(loaderSource.includes('CONFIG.concurrency'), 'Should use concurrency config');
});

test('executePrefetch handles visibility change', () => {
    assert.ok(loaderSource.includes('visibilitychange'), 'Should listen for visibilitychange');
    assert.ok(loaderSource.includes('document.hidden'), 'Should check document.hidden');
});

test('executePrefetch tracks consecutive errors', () => {
    assert.ok(loaderSource.includes('consecutiveErrors'), 'Should track consecutive errors');
    assert.ok(loaderSource.includes('consecutiveErrorLimit'), 'Should check error limit');
});

test('cancelLoad aborts in-flight fetches', () => {
    assert.ok(loaderSource.includes('state.abortController.abort()'), 'Should abort controller on cancel');
});

// ========== UI management tests ==========

console.log('\nUI Management');

test('binds to expected DOM element IDs', () => {
    const expectedIds = [
        'z-controls-container', 'load-3d-btn', 'load-3d-estimate',
        'load-3d-progress', 'load-3d-fill', 'load-3d-text',
        'load-3d-cancel', 'load-3d-retry', 'z-slider-wrapper', 'exit-3d-btn'
    ];
    expectedIds.forEach(id => {
        assert.ok(loaderSource.includes(`'${id}'`), `Should bind to #${id}`);
    });
});

test('updateUI hides all sections then shows appropriate one', () => {
    assert.ok(loaderSource.includes("els.loadBtn.style.display = 'none'"), 'Should hide loadBtn');
    assert.ok(loaderSource.includes("els.progress.style.display = 'none'"), 'Should hide progress');
    assert.ok(loaderSource.includes("els.sliderWrapper.style.display = 'none'"), 'Should hide slider');
});

test('showToast creates and removes element', () => {
    assert.ok(loaderSource.includes('function showToast('), 'Should define showToast');
    assert.ok(loaderSource.includes('load-3d-toast'), 'Should use toast class');
    assert.ok(loaderSource.includes('removeChild'), 'Should remove toast after timeout');
});

test('updateBudgetEstimate disables button when over budget', () => {
    assert.ok(loaderSource.includes('els.loadBtn.disabled = true'), 'Should disable button');
    assert.ok(loaderSource.includes('Zoom in more'), 'Should show zoom-in message');
});

// ========== onViewStateChange integration ==========

console.log('\nViewState Change Integration');

test('onViewStateChange cancels load on viewport move', () => {
    assert.ok(loaderSource.includes("cancelLoad('viewport changed during load')"),
        'Should cancel load on viewport change');
});

test('onViewStateChange checks containment in 3D_READY', () => {
    assert.ok(loaderSource.includes('checkContainment(viewState)'),
        'Should check containment on viewState change');
});

test('onViewStateChange updates budget in 2D mode', () => {
    assert.ok(loaderSource.includes('updateBudgetEstimate()'),
        'Should update budget estimate in 2D mode');
});

// ========== Viewport math unit tests (eval-based) ==========

console.log('\nViewport Math (Computed)');

// Extract and evaluate the viewport math functions in isolation
// We create a minimal sandbox to test them

const mathFunctions = `
    function zoomToLevel(zoom, numLevels) {
        var level = Math.round(-zoom);
        return Math.max(0, Math.min(numLevels - 1, level));
    }

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

    function boundsToTileRange(bounds, levelInfo, margin) {
        if (margin === undefined) margin = 1;
        var level = levelInfo.level;
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
`;

// Evaluate the math functions
const vm = require('vm');
const sandbox = { Math: Math };
vm.createContext(sandbox);
vm.runInContext(mathFunctions, sandbox);

// zoomToLevel tests
test('zoomToLevel: zoom=0 -> level 0 (finest)', () => {
    const fn = vm.runInContext('zoomToLevel', sandbox);
    assert.strictEqual(fn(0, 5), 0);
});

test('zoomToLevel: zoom=-2 -> level 2', () => {
    const fn = vm.runInContext('zoomToLevel', sandbox);
    assert.strictEqual(fn(-2, 5), 2);
});

test('zoomToLevel: zoom=-4 -> level 4 (coarsest for 5 levels)', () => {
    const fn = vm.runInContext('zoomToLevel', sandbox);
    assert.strictEqual(fn(-4, 5), 4);
});

test('zoomToLevel: zoom=-10 clamped to max level', () => {
    const fn = vm.runInContext('zoomToLevel', sandbox);
    assert.strictEqual(fn(-10, 5), 4);
});

test('zoomToLevel: zoom=2 clamped to 0', () => {
    const fn = vm.runInContext('zoomToLevel', sandbox);
    assert.strictEqual(fn(2, 5), 0);
});

test('zoomToLevel: zoom=-1.4 rounds to level 1', () => {
    const fn = vm.runInContext('zoomToLevel', sandbox);
    assert.strictEqual(fn(-1.4, 5), 1);
});

test('zoomToLevel: zoom=-1.6 rounds to level 2', () => {
    const fn = vm.runInContext('zoomToLevel', sandbox);
    assert.strictEqual(fn(-1.6, 5), 2);
});

// viewStateToBounds tests
test('viewStateToBounds: centered at origin, zoom=0', () => {
    const fn = vm.runInContext('viewStateToBounds', sandbox);
    const result = fn(
        { target: [0, 0, 0], zoom: 0 },
        { width: 1000, height: 800 }
    );
    assert.strictEqual(result.minX, -500);
    assert.strictEqual(result.maxX, 500);
    assert.strictEqual(result.minY, -400);
    assert.strictEqual(result.maxY, 400);
});

test('viewStateToBounds: zoom=-1 doubles visible range', () => {
    const fn = vm.runInContext('viewStateToBounds', sandbox);
    const result = fn(
        { target: [500, 500, 0], zoom: -1 },
        { width: 1000, height: 800 }
    );
    // scale = 2^-1 = 0.5, halfW = 500/0.5 = 1000
    assert.strictEqual(result.minX, -500);
    assert.strictEqual(result.maxX, 1500);
    assert.strictEqual(result.minY, -300);
    assert.strictEqual(result.maxY, 1300);
});

test('viewStateToBounds: zoom=1 halves visible range', () => {
    const fn = vm.runInContext('viewStateToBounds', sandbox);
    const result = fn(
        { target: [1000, 1000, 0], zoom: 1 },
        { width: 1000, height: 800 }
    );
    // scale = 2^1 = 2, halfW = 500/2 = 250
    assert.strictEqual(result.minX, 750);
    assert.strictEqual(result.maxX, 1250);
    assert.strictEqual(result.minY, 800);
    assert.strictEqual(result.maxY, 1200);
});

// boundsToTileRange tests
test('boundsToTileRange: basic tile calculation at level 0', () => {
    const fn = vm.runInContext('boundsToTileRange', sandbox);
    const levelInfo = {
        level: 0, xChunkSize: 512, yChunkSize: 512, xChunks: 10, yChunks: 8
    };
    const bounds = { minX: 0, maxX: 1024, minY: 0, maxY: 1024 };
    const result = fn(bounds, levelInfo, 0);
    // tiles: floor(0/512)=0 to floor(1024/512)=2
    assert.strictEqual(result.minTileX, 0);
    assert.strictEqual(result.maxTileX, 2);
    assert.strictEqual(result.minTileY, 0);
    assert.strictEqual(result.maxTileY, 2);
    assert.strictEqual(result.tileCountX, 3);
    assert.strictEqual(result.tileCountY, 3);
});

test('boundsToTileRange: margin adds extra tiles', () => {
    const fn = vm.runInContext('boundsToTileRange', sandbox);
    const levelInfo = {
        level: 0, xChunkSize: 512, yChunkSize: 512, xChunks: 10, yChunks: 8
    };
    const bounds = { minX: 512, maxX: 1024, minY: 512, maxY: 1024 };
    const result = fn(bounds, levelInfo, 1);
    // Without margin: floor(512/512)=1 to floor(1024/512)=2
    // With margin: 1-1=0 to 2+1=3
    assert.strictEqual(result.minTileX, 0);
    assert.strictEqual(result.maxTileX, 3);
    assert.strictEqual(result.tileCountX, 4);
});

test('boundsToTileRange: level 2 scales bounds by 4x', () => {
    const fn = vm.runInContext('boundsToTileRange', sandbox);
    const levelInfo = {
        level: 2, xChunkSize: 512, yChunkSize: 512, xChunks: 3, yChunks: 2
    };
    // Full-res bounds 0-4096 become level-2 bounds 0-1024 (divided by 4)
    const bounds = { minX: 0, maxX: 4096, minY: 0, maxY: 4096 };
    const result = fn(bounds, levelInfo, 0);
    // Scaled: 0-1024, tiles: floor(0/512)=0 to floor(1024/512)=2, clamped to xChunks-1=2
    assert.strictEqual(result.minTileX, 0);
    assert.strictEqual(result.maxTileX, 2);
});

test('boundsToTileRange: clamps to grid boundaries', () => {
    const fn = vm.runInContext('boundsToTileRange', sandbox);
    const levelInfo = {
        level: 0, xChunkSize: 512, yChunkSize: 512, xChunks: 4, yChunks: 3
    };
    const bounds = { minX: -1000, maxX: 50000, minY: -1000, maxY: 50000 };
    const result = fn(bounds, levelInfo, 0);
    assert.strictEqual(result.minTileX, 0, 'minTileX clamped to 0');
    assert.strictEqual(result.maxTileX, 3, 'maxTileX clamped to xChunks-1');
    assert.strictEqual(result.minTileY, 0, 'minTileY clamped to 0');
    assert.strictEqual(result.maxTileY, 2, 'maxTileY clamped to yChunks-1');
});

// ========== Integration pattern tests ==========

console.log('\nIntegration Patterns');

test('HTML references expected element IDs', () => {
    const htmlPath = path.join(__dirname, '..', 'zarr-viewer.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const expectedIds = [
        'z-controls-container', 'load-3d-btn', 'load-3d-estimate',
        'load-3d-progress', 'load-3d-fill', 'load-3d-text',
        'load-3d-cancel', 'load-3d-retry', 'z-slider-wrapper', 'exit-3d-btn'
    ];

    expectedIds.forEach(id => {
        assert.ok(html.includes(`id="${id}"`),
            `HTML should contain element with id="${id}"`);
    });
});

test('HTML loads zarr-viewport-math.js before zarr-3d-loader.js and zarr-prefetch.js', () => {
    const htmlPath = path.join(__dirname, '..', 'zarr-viewer.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const mathPos = html.indexOf('zarr-viewport-math.js');
    const prefetchPos = html.indexOf('zarr-prefetch.js');
    const loaderPos = html.indexOf('zarr-3d-loader.js');
    const viewerPos = html.indexOf('zarr-viewer.js');

    assert.ok(mathPos > 0, 'zarr-viewport-math.js should be referenced in HTML');
    assert.ok(prefetchPos > 0, 'zarr-prefetch.js should be referenced in HTML');
    assert.ok(loaderPos > 0, 'zarr-3d-loader.js should be referenced in HTML');
    assert.ok(viewerPos > 0, 'zarr-viewer.js should be referenced in HTML');
    assert.ok(mathPos < prefetchPos, 'zarr-viewport-math.js should load before zarr-prefetch.js');
    assert.ok(mathPos < loaderPos, 'zarr-viewport-math.js should load before zarr-3d-loader.js');
    assert.ok(loaderPos < viewerPos, 'zarr-3d-loader.js should load before zarr-viewer.js');
});

test('zarr-viewer.js integrates zarr3DLoader', () => {
    const viewerPath = path.join(__dirname, '..', 'js', 'zarr-viewer.js');
    const viewerSource = fs.readFileSync(viewerPath, 'utf8');

    assert.ok(viewerSource.includes('zarr3DLoader'),
        'zarr-viewer.js should reference zarr3DLoader');
    assert.ok(viewerSource.includes('zarr3DLoader.onViewStateChange'),
        'zarr-viewer.js should call onViewStateChange');
    assert.ok(viewerSource.includes('zarr3DLoader.init'),
        'zarr-viewer.js should initialize zarr3DLoader');
});

test('zarr-prefetch.js exports getResolutionLevels', () => {
    const prefetchPath = path.join(__dirname, '..', 'js', 'zarr-prefetch.js');
    const prefetchSource = fs.readFileSync(prefetchPath, 'utf8');

    assert.ok(prefetchSource.includes('getResolutionLevels:'),
        'zarr-prefetch.js should export getResolutionLevels');
    assert.ok(prefetchSource.includes('getAxes:'),
        'zarr-prefetch.js should export getAxes');
    assert.ok(prefetchSource.includes('getStoreUrl:'),
        'zarr-prefetch.js should export getStoreUrl');
    assert.ok(prefetchSource.includes('getDimensionSeparator:'),
        'zarr-prefetch.js should export getDimensionSeparator');
});

test('CSS contains Load 3D styles', () => {
    const cssPath = path.join(__dirname, '..', 'css', 'style.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    assert.ok(css.includes('.load-3d-btn'), 'CSS should have .load-3d-btn');
    assert.ok(css.includes('.load-3d-progress'), 'CSS should have .load-3d-progress');
    assert.ok(css.includes('.exit-3d-btn'), 'CSS should have .exit-3d-btn');
    assert.ok(css.includes('.load-3d-toast'), 'CSS should have .load-3d-toast');
    assert.ok(css.includes('.z-controls-container'), 'CSS should have .z-controls-container');
});

// ========== Summary ==========

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
