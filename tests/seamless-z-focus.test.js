#!/usr/bin/env node
// Unit tests for Seamless Z-Focus - runs with plain Node.js
// Usage: node seamless-z-focus.test.js
//
// Verifies that zarr-3d-loader.js has been removed and replaced with
// zoom-gated Z-slider visibility in zarr-viewer.js.

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

// Read source files for static analysis
const viewerJsPath = path.join(__dirname, '..', 'js', 'zarr-viewer.js');
const prefetchPath = path.join(__dirname, '..', 'js', 'zarr-prefetch.js');
const htmlPath = path.join(__dirname, '..', 'zarr-viewer.html');
const cssPath = path.join(__dirname, '..', 'css', 'style.css');

const viewerJs = fs.readFileSync(viewerJsPath, 'utf8');
const prefetchJs = fs.readFileSync(prefetchPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

// ========== Removal verification ==========

console.log('3D Loader Removal');

test('zarr-3d-loader.js file does not exist', () => {
    const loaderPath = path.join(__dirname, '..', 'js', 'zarr-3d-loader.js');
    assert.ok(!fs.existsSync(loaderPath), 'zarr-3d-loader.js should be deleted');
});

test('HTML has no load-3d-btn', () => {
    assert.ok(!html.includes('load-3d-btn'), 'HTML should not contain load-3d-btn');
});

test('HTML has no exit-3d-btn', () => {
    assert.ok(!html.includes('exit-3d-btn'), 'HTML should not contain exit-3d-btn');
});

test('HTML has no load-3d-progress', () => {
    assert.ok(!html.includes('load-3d-progress'), 'HTML should not contain load-3d-progress');
});

test('HTML has no zarr-3d-loader.js script tag', () => {
    assert.ok(!html.includes('zarr-3d-loader.js'), 'HTML should not load zarr-3d-loader.js');
});

test('zarr-viewer.js has no zarr3DLoader references', () => {
    assert.ok(!viewerJs.includes('zarr3DLoader'), 'zarr-viewer.js should not reference zarr3DLoader');
});

// ========== Seamless Z-Focus HTML ==========

console.log('\nHTML Structure');

test('HTML has z-controls-container', () => {
    assert.ok(html.includes('id="z-controls-container"'), 'HTML should have z-controls-container');
});

test('HTML has z-slider', () => {
    assert.ok(html.includes('id="z-slider"'), 'HTML should have z-slider');
});

test('HTML has z-slider-wrapper with class', () => {
    assert.ok(html.includes('class="z-slider-wrapper"'), 'z-slider-wrapper should have class attribute');
});

test('HTML has z-depth display', () => {
    assert.ok(html.includes('id="z-depth"'), 'HTML should have z-depth');
});

test('HTML has z-index display', () => {
    assert.ok(html.includes('id="z-index"'), 'HTML should have z-index');
});

// ========== Script load order ==========

console.log('\nScript Load Order');

test('zarr-viewport-math.js loads before zarr-prefetch.js', () => {
    const mathPos = html.indexOf('zarr-viewport-math.js');
    const prefetchPos = html.indexOf('zarr-prefetch.js');
    assert.ok(mathPos > 0, 'zarr-viewport-math.js should be in HTML');
    assert.ok(prefetchPos > 0, 'zarr-prefetch.js should be in HTML');
    assert.ok(mathPos < prefetchPos, 'viewport-math should load before prefetch');
});

test('zarr-prefetch.js loads before zarr-viewer.js', () => {
    const prefetchPos = html.indexOf('zarr-prefetch.js');
    const viewerPos = html.indexOf('zarr-viewer.js');
    assert.ok(prefetchPos < viewerPos, 'prefetch should load before viewer');
});

test('no zarr-3d-loader.js in load order', () => {
    const scripts = html.match(/src="[^"]*\.js"/g) || [];
    const loaderScript = scripts.find(s => s.includes('zarr-3d-loader'));
    assert.ok(!loaderScript, 'zarr-3d-loader.js should not be in script tags');
});

// ========== Zoom-gated visibility ==========

console.log('\nZoom-Gated Visibility');

test('zarr-viewer.js defines Z_SLIDER_ZOOM_THRESHOLD', () => {
    assert.ok(viewerJs.includes('Z_SLIDER_ZOOM_THRESHOLD'), 'Should define zoom threshold constant');
});

test('Z_SLIDER_ZOOM_THRESHOLD is -3', () => {
    assert.ok(viewerJs.includes('Z_SLIDER_ZOOM_THRESHOLD = -3'), 'Threshold should be -3');
});

test('zarr-viewer.js has updateZSliderVisibility function', () => {
    assert.ok(viewerJs.includes('function updateZSliderVisibility('), 'Should define updateZSliderVisibility');
});

test('updateZSliderVisibility checks zCount > 1', () => {
    assert.ok(viewerJs.includes('state.zCount <= 1'), 'Should check zCount');
});

test('updateZSliderVisibility compares zoom to threshold', () => {
    assert.ok(viewerJs.includes('Z_SLIDER_ZOOM_THRESHOLD'), 'Should use threshold');
    assert.ok(viewerJs.includes('viewState.zoom >= Z_SLIDER_ZOOM_THRESHOLD'), 'Should compare zoom >= threshold');
});

test('updateZSliderVisibility adds z-controls-visible class', () => {
    assert.ok(viewerJs.includes("'z-controls-visible'"), 'Should toggle z-controls-visible class');
});

test('state tracks zSliderVisible', () => {
    assert.ok(viewerJs.includes('zSliderVisible'), 'State should track slider visibility');
});

test('onViewStateChange calls updateZSliderVisibility', () => {
    assert.ok(viewerJs.includes('updateZSliderVisibility(viewState)'),
        'onViewStateChange should call updateZSliderVisibility');
});

// ========== CSS transition ==========

console.log('\nCSS Transitions');

test('CSS has .z-controls-visible class', () => {
    assert.ok(css.includes('.z-controls-visible'), 'CSS should define .z-controls-visible');
});

test('z-controls-container has opacity transition', () => {
    // Check that the container has transition: opacity
    assert.ok(css.includes('opacity: 0'), 'z-controls-container should start with opacity 0');
    assert.ok(css.includes('transition: opacity 200ms'), 'Should have 200ms opacity transition');
});

test('.z-controls-visible sets opacity to 1', () => {
    assert.ok(css.includes('.z-controls-container.z-controls-visible'),
        'CSS should have .z-controls-container.z-controls-visible');
});

test('CSS has .z-slider-wrapper style', () => {
    assert.ok(css.includes('.z-slider-wrapper'), 'CSS should have .z-slider-wrapper');
});

test('CSS does not have .load-3d-btn', () => {
    assert.ok(!css.includes('.load-3d-btn'), 'CSS should not have .load-3d-btn');
});

test('CSS does not have .exit-3d-btn', () => {
    assert.ok(!css.includes('.exit-3d-btn'), 'CSS should not have .exit-3d-btn');
});

test('CSS does not have .load-3d-toast', () => {
    assert.ok(!css.includes('.load-3d-toast'), 'CSS should not have .load-3d-toast');
});

// ========== Viewport-aware prefetch ==========

console.log('\nViewport-Aware Prefetch');

test('zarr-prefetch.js exports onViewportChange', () => {
    assert.ok(prefetchJs.includes('onViewportChange:'), 'Should export onViewportChange');
});

test('zarr-prefetch.js defines onViewportChange function', () => {
    assert.ok(prefetchJs.includes('function onViewportChange('), 'Should define onViewportChange');
});

test('onViewportChange has 200ms debounce', () => {
    assert.ok(prefetchJs.includes('viewportChangeTimer'), 'Should use viewport change timer');
    assert.ok(prefetchJs.includes('200'), 'Should use 200ms debounce');
});

test('onViewportChange clears prefetchedPlanes', () => {
    assert.ok(prefetchJs.includes('prefetchedPlanes.clear()'), 'Should clear prefetched planes on viewport change');
});

test('zarr-viewer.js calls onViewportChange when Z-slider visible', () => {
    assert.ok(viewerJs.includes('zarrPrefetch.onViewportChange'),
        'zarr-viewer.js should call zarrPrefetch.onViewportChange');
    assert.ok(viewerJs.includes('state.zSliderVisible'),
        'Should check zSliderVisible before calling');
});

test('choosePrefetchLevels prioritizes current zoom level', () => {
    assert.ok(prefetchJs.includes('zoomToLevel'), 'choosePrefetchLevels should use zoomToLevel');
    assert.ok(prefetchJs.includes('currentLevel'), 'Should compute currentLevel from zoom');
});

test('destroy cleans up viewportChangeTimer', () => {
    assert.ok(prefetchJs.includes('viewportChangeTimer'), 'destroy should reference viewportChangeTimer');
});

// ========== Summary ==========

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
