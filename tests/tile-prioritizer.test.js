#!/usr/bin/env node
// Unit tests for tile-prioritizer.js - runs with plain Node.js
// Usage: node tile-prioritizer.test.js
//
// Tests verify file structure and logic patterns.
// Full integration tests require browser environment with OpenSeadragon.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (error) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

// Read source files for static analysis
const prioritizerPath = path.join(__dirname, '..', 'js', 'tile-prioritizer.js');
const prioritizerSource = fs.readFileSync(prioritizerPath, 'utf8');

const viewerPath = path.join(__dirname, '..', 'viewer.html');
const viewerSource = fs.readFileSync(viewerPath, 'utf8');

const viewerJsPath = path.join(__dirname, '..', 'js', 'viewer.js');
const viewerJsSource = fs.readFileSync(viewerJsPath, 'utf8');

// ========== File structure tests ==========

test('tile-prioritizer.js exists', () => {
    assert.ok(fs.existsSync(prioritizerPath), 'tile-prioritizer.js should exist in web/js/');
});

test('tile-prioritizer.js uses IIFE pattern', () => {
    assert.ok(prioritizerSource.includes('(function()'), 'Should use IIFE pattern');
    assert.ok(prioritizerSource.includes("'use strict'"), 'Should use strict mode');
    assert.ok(prioritizerSource.includes('})();'), 'Should close IIFE properly');
});

// ========== Priority constants tests ==========

test('tile-prioritizer.js defines PRIORITY constants', () => {
    assert.ok(prioritizerSource.includes('const PRIORITY'), 'Should define PRIORITY object');
    assert.ok(prioritizerSource.includes('VIEWPORT_CURRENT_Z'), 'Should have VIEWPORT_CURRENT_Z priority');
    assert.ok(prioritizerSource.includes('VIEWPORT_ADJACENT_Z'), 'Should have VIEWPORT_ADJACENT_Z priority');
    assert.ok(prioritizerSource.includes('PREFETCH'), 'Should have PREFETCH priority');
});

test('tile-prioritizer.js priorities are in correct order', () => {
    // Extract priority values using regex
    const currentZMatch = prioritizerSource.match(/VIEWPORT_CURRENT_Z:\s*(\d+)/);
    const adjacentZMatch = prioritizerSource.match(/VIEWPORT_ADJACENT_Z:\s*(\d+)/);
    const prefetchMatch = prioritizerSource.match(/PREFETCH:\s*(\d+)/);

    assert.ok(currentZMatch, 'Should have VIEWPORT_CURRENT_Z value');
    assert.ok(adjacentZMatch, 'Should have VIEWPORT_ADJACENT_Z value');
    assert.ok(prefetchMatch, 'Should have PREFETCH value');

    const currentZ = parseInt(currentZMatch[1], 10);
    const adjacentZ = parseInt(adjacentZMatch[1], 10);
    const prefetch = parseInt(prefetchMatch[1], 10);

    assert.ok(currentZ < adjacentZ, 'Current Z should be higher priority (lower number) than adjacent Z');
    assert.ok(adjacentZ < prefetch, 'Adjacent Z should be higher priority than prefetch');
});

// ========== Configuration tests ==========

test('tile-prioritizer.js defines CONFIG object', () => {
    assert.ok(prioritizerSource.includes('const CONFIG'), 'Should define CONFIG object');
    assert.ok(prioritizerSource.includes('animatingJobLimit'), 'Should have animatingJobLimit config');
    assert.ok(prioritizerSource.includes('idleJobLimit'), 'Should have idleJobLimit config');
    assert.ok(prioritizerSource.includes('idleRestoreDelay'), 'Should have idleRestoreDelay config');
});

test('tile-prioritizer.js has reasonable job limits', () => {
    const animatingMatch = prioritizerSource.match(/animatingJobLimit:\s*(\d+)/);
    const idleMatch = prioritizerSource.match(/idleJobLimit:\s*(\d+)/);

    assert.ok(animatingMatch, 'Should have animatingJobLimit value');
    assert.ok(idleMatch, 'Should have idleJobLimit value');

    const animating = parseInt(animatingMatch[1], 10);
    const idle = parseInt(idleMatch[1], 10);

    assert.ok(animating > 0 && animating <= 4, `animatingJobLimit should be 1-4 (got ${animating})`);
    assert.ok(idle > animating && idle <= 10, `idleJobLimit should be > animating and <= 10 (got ${idle})`);
});

// ========== Public API tests ==========

test('tile-prioritizer.js exposes evostitch.tilePrioritizer', () => {
    assert.ok(prioritizerSource.includes('window.evostitch'), 'Should attach to window.evostitch');
    assert.ok(prioritizerSource.includes('evostitch.tilePrioritizer'), 'Should expose tilePrioritizer');
});

test('tile-prioritizer.js has init function', () => {
    assert.ok(prioritizerSource.includes('function init('), 'Should have init function');
    assert.ok(prioritizerSource.includes('init: init'), 'Should expose init in public API');
});

test('tile-prioritizer.js has setCurrentZ function', () => {
    assert.ok(prioritizerSource.includes('function setCurrentZ('), 'Should have setCurrentZ function');
    assert.ok(prioritizerSource.includes('setCurrentZ: setCurrentZ'), 'Should expose setCurrentZ in public API');
});

test('tile-prioritizer.js has clearQueue function', () => {
    assert.ok(prioritizerSource.includes('function clearQueue('), 'Should have clearQueue function');
    assert.ok(prioritizerSource.includes('clearQueue: clearQueue'), 'Should expose clearQueue in public API');
});

test('tile-prioritizer.js has destroy function', () => {
    assert.ok(prioritizerSource.includes('function destroy('), 'Should have destroy function');
    assert.ok(prioritizerSource.includes('destroy: destroy'), 'Should expose destroy in public API');
});

test('tile-prioritizer.js has getState function', () => {
    assert.ok(prioritizerSource.includes('function getState('), 'Should have getState function');
    assert.ok(prioritizerSource.includes('getState: getState'), 'Should expose getState in public API');
});

// ========== Core functionality tests ==========

test('tile-prioritizer.js wraps ImageLoader.addJob', () => {
    assert.ok(prioritizerSource.includes('function wrapImageLoader('), 'Should have wrapImageLoader function');
    assert.ok(prioritizerSource.includes('imageLoader.addJob ='), 'Should override imageLoader.addJob');
    assert.ok(prioritizerSource.includes('originalAddJob'), 'Should store original addJob');
});

test('tile-prioritizer.js implements priority queue', () => {
    assert.ok(prioritizerSource.includes('let pendingJobs = []'), 'Should have pendingJobs array');
    assert.ok(prioritizerSource.includes('pendingJobs.push'), 'Should push jobs to queue');
    assert.ok(prioritizerSource.includes('pendingJobs.sort'), 'Should sort jobs by priority');
    assert.ok(prioritizerSource.includes('pendingJobs.shift'), 'Should dequeue jobs');
});

test('tile-prioritizer.js calculates priority based on Z-plane', () => {
    assert.ok(prioritizerSource.includes('function calculatePriority('), 'Should have calculatePriority function');
    assert.ok(prioritizerSource.includes('getTileZPlane'), 'Should determine tile Z-plane');
    assert.ok(prioritizerSource.includes('currentZPlane'), 'Should compare against current Z-plane');
});

test('tile-prioritizer.js checks viewport bounds', () => {
    assert.ok(prioritizerSource.includes('function isTileInViewport('), 'Should have isTileInViewport function');
    assert.ok(prioritizerSource.includes('viewport.getBounds'), 'Should get viewport bounds');
    assert.ok(prioritizerSource.includes('intersects'), 'Should check bounds intersection');
});

// ========== Animation handling tests ==========

test('tile-prioritizer.js sets up animation handlers', () => {
    assert.ok(prioritizerSource.includes('function setupAnimationHandlers('), 'Should have setupAnimationHandlers function');
    assert.ok(prioritizerSource.includes("'animation-start'"), 'Should handle animation-start event');
    assert.ok(prioritizerSource.includes("'animation-finish'"), 'Should handle animation-finish event');
    assert.ok(prioritizerSource.includes("'pan'"), 'Should handle pan event');
    assert.ok(prioritizerSource.includes("'zoom'"), 'Should handle zoom event');
});

test('tile-prioritizer.js reduces job limit during animation', () => {
    assert.ok(prioritizerSource.includes('function onAnimationStart('), 'Should have onAnimationStart handler');
    assert.ok(prioritizerSource.includes('imageLoader.jobLimit = CONFIG.animatingJobLimit'),
        'Should reduce job limit during animation');
});

test('tile-prioritizer.js restores job limit after animation', () => {
    assert.ok(prioritizerSource.includes('function onAnimationFinish('), 'Should have onAnimationFinish handler');
    assert.ok(prioritizerSource.includes('imageLoader.jobLimit = CONFIG.idleJobLimit'),
        'Should restore job limit after animation');
    assert.ok(prioritizerSource.includes('idleRestoreDelay'), 'Should delay restore to avoid thrashing');
});

// ========== Queue processing tests ==========

test('tile-prioritizer.js has processQueue function', () => {
    assert.ok(prioritizerSource.includes('function processQueue('), 'Should have processQueue function');
    assert.ok(prioritizerSource.includes('processingQueue'), 'Should track processing state');
});

test('tile-prioritizer.js processes jobs on tile-loaded', () => {
    assert.ok(prioritizerSource.includes("'tile-loaded'"), 'Should handle tile-loaded event');
    assert.ok(prioritizerSource.includes('onTileLoaded'), 'Should have onTileLoaded handler');
});

test('tile-prioritizer.js reprioritizes queue on Z change', () => {
    assert.ok(prioritizerSource.includes('function reprioritizeQueue('), 'Should have reprioritizeQueue function');
    assert.ok(prioritizerSource.includes('reprioritizeQueue()'), 'Should call reprioritizeQueue');
});

// ========== Cleanup tests ==========

test('tile-prioritizer.js destroy restores original behavior', () => {
    assert.ok(prioritizerSource.includes('imageLoader.addJob = originalAddJob'),
        'Should restore original addJob');
    assert.ok(prioritizerSource.includes('removeHandler'), 'Should remove event handlers');
    assert.ok(prioritizerSource.includes('pendingJobs = []'), 'Should clear pending jobs');
});

// ========== Integration tests (viewer.html) ==========

test('viewer.html includes tile-prioritizer.js', () => {
    assert.ok(viewerSource.includes('tile-prioritizer.js'), 'Should include tile-prioritizer.js script');
});

test('tile-prioritizer.js is loaded before viewer.js', () => {
    const prioritizerPos = viewerSource.indexOf('tile-prioritizer.js');
    const viewerPos = viewerSource.indexOf('viewer.js');
    assert.ok(prioritizerPos < viewerPos, 'tile-prioritizer.js should be loaded before viewer.js');
});

// ========== Integration tests (viewer.js) ==========

test('viewer.js initializes tile prioritizer for 3D mosaics', () => {
    assert.ok(viewerJsSource.includes('tilePrioritizer.init'), 'Should call tilePrioritizer.init');
    assert.ok(viewerJsSource.includes('currentZ:'), 'Should pass currentZ option');
    assert.ok(viewerJsSource.includes('zCount:'), 'Should pass zCount option');
});

test('viewer.js updates tile prioritizer on Z-plane change', () => {
    assert.ok(viewerJsSource.includes('tilePrioritizer.setCurrentZ'),
        'Should call setCurrentZ when Z-plane changes');
});

test('viewer.js safely checks for tilePrioritizer availability', () => {
    // Should use defensive checks before calling prioritizer methods
    const initCheck = viewerJsSource.includes('window.evostitch && window.evostitch.tilePrioritizer');
    assert.ok(initCheck, 'Should check tilePrioritizer availability before use');
});

// ========== State management tests ==========

test('tile-prioritizer.js tracks enabled state', () => {
    assert.ok(prioritizerSource.includes('let enabled = false'), 'Should have enabled flag');
    assert.ok(prioritizerSource.includes('enabled = true'), 'Should set enabled on init');
    assert.ok(prioritizerSource.includes('enabled = false'), 'Should clear enabled on destroy');
});

test('tile-prioritizer.js getState returns useful info', () => {
    // Verify getState returns comprehensive state object
    assert.ok(prioritizerSource.includes('enabled: enabled'), 'getState should return enabled');
    assert.ok(prioritizerSource.includes('currentZ: currentZPlane'), 'getState should return currentZ');
    assert.ok(prioritizerSource.includes('isAnimating: isAnimating'), 'getState should return isAnimating');
    assert.ok(prioritizerSource.includes('pendingJobs:'), 'getState should return pendingJobs count');
});

// ========== Z-aware prefetching tests (W2 2.3) ==========

test('tile-prioritizer.js defines prefetch configuration', () => {
    assert.ok(prioritizerSource.includes('prefetch:'), 'CONFIG should have prefetch section');
    assert.ok(prioritizerSource.includes('zRadius'), 'Should have zRadius config');
    assert.ok(prioritizerSource.includes('viewportChangeThreshold'), 'Should have viewportChangeThreshold config');
    assert.ok(prioritizerSource.includes('prefetchDelay'), 'Should have prefetchDelay config');
});

test('tile-prioritizer.js has prefetch state tracking', () => {
    assert.ok(prioritizerSource.includes('let lastPrefetchBounds'), 'Should track lastPrefetchBounds');
    assert.ok(prioritizerSource.includes('let prefetchTimeout'), 'Should track prefetchTimeout');
    assert.ok(prioritizerSource.includes('let prefetchedZPlanes'), 'Should track prefetchedZPlanes');
});

test('tile-prioritizer.js has schedulePrefetch function', () => {
    assert.ok(prioritizerSource.includes('function schedulePrefetch('), 'Should have schedulePrefetch function');
    assert.ok(prioritizerSource.includes('schedulePrefetch: schedulePrefetch'), 'Should expose schedulePrefetch in API');
});

test('tile-prioritizer.js schedulePrefetch respects animation state', () => {
    // Should not prefetch during animation
    assert.ok(prioritizerSource.includes('if (isAnimating)'), 'Should check animation state in schedulePrefetch');
});

test('tile-prioritizer.js has triggerZPrefetch function', () => {
    assert.ok(prioritizerSource.includes('function triggerZPrefetch('), 'Should have triggerZPrefetch function');
    assert.ok(prioritizerSource.includes('triggerZPrefetch: triggerZPrefetch'), 'Should expose triggerZPrefetch in API');
});

test('tile-prioritizer.js triggerZPrefetch uses predictive prefetch', () => {
    assert.ok(prioritizerSource.includes('predictPrefetchPlanes'), 'Should use predictPrefetchPlanes function');
    // New implementation skips current Z-plane by construction (uses i = 1 in loop, or explicit +/-1)
    assert.ok(prioritizerSource.includes('currentZPlane - 1') || prioritizerSource.includes('currentZPlane + 1'),
        'Should prefetch adjacent planes (not current)');
    assert.ok(prioritizerSource.includes('prefetchedZPlanes.has'), 'Should check if already prefetched');
    assert.ok(prioritizerSource.includes('prefetchedZPlanes.add'), 'Should track prefetched planes');
});

test('tile-prioritizer.js has requestTilesInBounds function', () => {
    assert.ok(prioritizerSource.includes('function requestTilesInBounds('), 'Should have requestTilesInBounds function');
    assert.ok(prioritizerSource.includes('setPreload(true)'), 'Should enable preload on tiledImage');
    assert.ok(prioritizerSource.includes('forceRedraw'), 'Should trigger tile loading via forceRedraw');
});

test('tile-prioritizer.js has cancelPrefetch function', () => {
    assert.ok(prioritizerSource.includes('function cancelPrefetch('), 'Should have cancelPrefetch function');
    assert.ok(prioritizerSource.includes('cancelPrefetch: cancelPrefetch'), 'Should expose cancelPrefetch in API');
});

test('tile-prioritizer.js has clearPrefetchJobs function', () => {
    assert.ok(prioritizerSource.includes('function clearPrefetchJobs('), 'Should have clearPrefetchJobs function');
    assert.ok(prioritizerSource.includes('PRIORITY.PREFETCH'), 'Should filter by PREFETCH priority');
});

test('tile-prioritizer.js has hasViewportChangedSignificantly function', () => {
    assert.ok(prioritizerSource.includes('function hasViewportChangedSignificantly('),
        'Should have hasViewportChangedSignificantly function');
    assert.ok(prioritizerSource.includes('viewportChangeThreshold'), 'Should use threshold config');
    assert.ok(prioritizerSource.includes('intersection'), 'Should calculate bounds intersection');
});

test('tile-prioritizer.js cancels prefetch on animation start', () => {
    // Animation start should cancel pending prefetch
    const animStartSection = prioritizerSource.substring(
        prioritizerSource.indexOf('function onAnimationStart'),
        prioritizerSource.indexOf('function onAnimationFinish')
    );
    assert.ok(animStartSection.includes('prefetchTimeout'), 'Should clear prefetchTimeout on animation start');
    assert.ok(animStartSection.includes('hasViewportChangedSignificantly'),
        'Should check viewport change on animation start');
    assert.ok(animStartSection.includes('clearPrefetchJobs'), 'Should clear prefetch jobs if needed');
});

test('tile-prioritizer.js schedules prefetch on animation finish', () => {
    // Animation finish should schedule prefetch
    const animFinishSection = prioritizerSource.substring(
        prioritizerSource.indexOf('function onAnimationFinish'),
        prioritizerSource.indexOf('function onTileLoaded')
    );
    assert.ok(animFinishSection.includes('schedulePrefetch'), 'Should schedule prefetch after animation');
});

test('tile-prioritizer.js schedules prefetch on Z-plane change', () => {
    // Z-plane change should trigger prefetch
    const setZSection = prioritizerSource.substring(
        prioritizerSource.indexOf('function setCurrentZ'),
        prioritizerSource.indexOf('function reprioritizeQueue')
    );
    assert.ok(setZSection.includes('prefetchedZPlanes.clear'), 'Should clear prefetched planes on Z change');
    assert.ok(setZSection.includes('schedulePrefetch'), 'Should schedule prefetch on Z change');
});

test('tile-prioritizer.js getState includes prefetch info', () => {
    assert.ok(prioritizerSource.includes('prefetchedZPlanes:'), 'getState should return prefetchedZPlanes');
    assert.ok(prioritizerSource.includes('hasPendingPrefetch:'), 'getState should return pending prefetch status');
    assert.ok(prioritizerSource.includes('lastPrefetchBounds:'), 'getState should return lastPrefetchBounds');
});

test('tile-prioritizer.js destroy clears prefetch state', () => {
    const destroySection = prioritizerSource.substring(
        prioritizerSource.indexOf('function destroy'),
        prioritizerSource.indexOf('function getState')
    );
    assert.ok(destroySection.includes('prefetchTimeout'), 'destroy should clear prefetchTimeout');
    assert.ok(destroySection.includes('prefetchedZPlanes.clear'), 'destroy should clear prefetchedZPlanes');
    assert.ok(destroySection.includes('lastPrefetchBounds = null'), 'destroy should clear lastPrefetchBounds');
});

// Summary
console.log('\n---');
console.log(`Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
}
