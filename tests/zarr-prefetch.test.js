#!/usr/bin/env node
// Unit tests for zarr-prefetch.js - runs with plain Node.js
// Usage: node zarr-prefetch.test.js
//
// Tests verify file structure, IIFE pattern, public API, and logic patterns.
// Full integration tests require browser environment with Cache API.

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
const prefetchPath = path.join(__dirname, '..', 'js', 'zarr-prefetch.js');
const prefetchSource = fs.readFileSync(prefetchPath, 'utf8');

// ========== File structure tests ==========

console.log('File Structure');

test('zarr-prefetch.js exists', () => {
    assert.ok(fs.existsSync(prefetchPath), 'zarr-prefetch.js should exist in web/js/');
});

test('zarr-prefetch.js uses IIFE pattern', () => {
    assert.ok(prefetchSource.includes('(function()'), 'Should use IIFE pattern');
    assert.ok(prefetchSource.includes("'use strict'"), 'Should use strict mode');
    assert.ok(prefetchSource.includes('})();'), 'Should close IIFE properly');
});

test('zarr-prefetch.js does not pollute global scope', () => {
    // Only window.evostitch should be touched
    const globalAssignments = prefetchSource.match(/window\.\w+/g) || [];
    const nonEvostitch = globalAssignments.filter(a => !a.startsWith('window.evostitch'));
    assert.strictEqual(nonEvostitch.length, 0,
        'Should only assign to window.evostitch, found: ' + nonEvostitch.join(', '));
});

// ========== Configuration tests ==========

console.log('\nConfiguration');

test('zarr-prefetch.js defines CONFIG object', () => {
    assert.ok(prefetchSource.includes('const CONFIG'), 'Should define CONFIG object');
});

test('CONFIG relies on SW for cache management', () => {
    // maxCachedPlanes removed - SW handles cache eviction now
    assert.ok(!prefetchSource.includes('maxCachedPlanes'),
        'Should not have maxCachedPlanes (SW manages cache)');
});

test('CONFIG has adjacentRadius', () => {
    assert.ok(prefetchSource.includes('adjacentRadius'), 'Should have adjacentRadius');
    const match = prefetchSource.match(/adjacentRadius:\s*(\d+)/);
    assert.ok(match, 'Should have a numeric value');
    const val = parseInt(match[1], 10);
    assert.ok(val >= 1 && val <= 5, `adjacentRadius should be 1-5 (got ${val})`);
});

test('CONFIG has predictiveDepth', () => {
    assert.ok(prefetchSource.includes('predictiveDepth'), 'Should have predictiveDepth');
    const match = prefetchSource.match(/predictiveDepth:\s*(\d+)/);
    assert.ok(match, 'Should have a numeric value');
    const val = parseInt(match[1], 10);
    assert.ok(val >= 2 && val <= 10, `predictiveDepth should be 2-10 (got ${val})`);
});

test('CONFIG has velocityThreshold', () => {
    assert.ok(prefetchSource.includes('velocityThreshold'), 'Should have velocityThreshold');
});

test('CONFIG has velocityDecay', () => {
    assert.ok(prefetchSource.includes('velocityDecay'), 'Should have velocityDecay');
    const match = prefetchSource.match(/velocityDecay:\s*([\d.]+)/);
    assert.ok(match, 'Should have a numeric value');
    const val = parseFloat(match[1]);
    assert.ok(val > 0 && val < 1, `velocityDecay should be 0-1 (got ${val})`);
});

test('CONFIG has prefetchDelay', () => {
    assert.ok(prefetchSource.includes('prefetchDelay'), 'Should have prefetchDelay');
    const match = prefetchSource.match(/prefetchDelay:\s*(\d+)/);
    assert.ok(match, 'Should have a numeric value');
    const val = parseInt(match[1], 10);
    assert.ok(val >= 50 && val <= 500, `prefetchDelay should be 50-500ms (got ${val})`);
});

test('CONFIG has maxConcurrent', () => {
    assert.ok(prefetchSource.includes('maxConcurrent'), 'Should have maxConcurrent');
    const match = prefetchSource.match(/maxConcurrent:\s*(\d+)/);
    assert.ok(match, 'Should have a numeric value');
    const val = parseInt(match[1], 10);
    assert.ok(val >= 1 && val <= 8, `maxConcurrent should be 1-8 (got ${val})`);
});

test('CONFIG does not manage its own cache (SW handles it)', () => {
    // cacheName removed - the SW manages all caching
    assert.ok(!prefetchSource.includes('cacheName'), 'Should not have cacheName (SW manages cache)');
});

test('CONFIG has debug flag', () => {
    assert.ok(prefetchSource.includes('debug: false'), 'Should default debug to false');
});

// ========== Public API tests ==========

console.log('\nPublic API');

test('zarr-prefetch.js exposes evostitch.zarrPrefetch', () => {
    assert.ok(prefetchSource.includes('window.evostitch'), 'Should attach to window.evostitch');
    assert.ok(prefetchSource.includes('evostitch.zarrPrefetch'), 'Should expose zarrPrefetch');
});

test('Public API has init function', () => {
    assert.ok(prefetchSource.includes('function init('), 'Should have init function');
    assert.ok(prefetchSource.includes('init: init'), 'Should expose init');
});

test('Public API has onZChange function', () => {
    assert.ok(prefetchSource.includes('function onZChange('), 'Should have onZChange function');
    assert.ok(prefetchSource.includes('onZChange: onZChange'), 'Should expose onZChange');
});

test('Public API has getPrefetchState function', () => {
    assert.ok(prefetchSource.includes('function getPrefetchState('), 'Should have getPrefetchState function');
    assert.ok(prefetchSource.includes('getPrefetchState: getPrefetchState'), 'Should expose getPrefetchState');
});

test('Public API has warmPlane function', () => {
    assert.ok(prefetchSource.includes('function warmPlane('), 'Should have warmPlane function');
    assert.ok(prefetchSource.includes('warmPlane: warmPlane'), 'Should expose warmPlane');
});

test('Public API has getStats function', () => {
    assert.ok(prefetchSource.includes('function getStats('), 'Should have getStats function');
    assert.ok(prefetchSource.includes('getStats: getStats'), 'Should expose getStats');
});

test('Public API has setDebug function', () => {
    assert.ok(prefetchSource.includes('setDebug: setDebug'), 'Should expose setDebug');
});

test('Public API has destroy function', () => {
    assert.ok(prefetchSource.includes('function destroy('), 'Should have destroy function');
    assert.ok(prefetchSource.includes('destroy: destroy'), 'Should expose destroy');
});

test('Public API exposes CONFIG for testing', () => {
    assert.ok(prefetchSource.includes('CONFIG: CONFIG'), 'Should expose CONFIG');
});

// ========== State management tests ==========

console.log('\nState Management');

test('State tracks initialization', () => {
    assert.ok(prefetchSource.includes('initialized: false'), 'Should have initialized flag');
    assert.ok(prefetchSource.includes('state.initialized = true'), 'Should set initialized on init');
    assert.ok(prefetchSource.includes('state.initialized = false'), 'Should clear on destroy');
});

test('State tracks current Z', () => {
    assert.ok(prefetchSource.includes('currentZ: 0'), 'Should track currentZ');
    assert.ok(prefetchSource.includes('state.currentZ = newZ'), 'Should update currentZ on Z change');
});

test('State tracks Z count', () => {
    assert.ok(prefetchSource.includes('zCount: 1'), 'Should have default zCount');
    assert.ok(prefetchSource.includes('state.zCount = config.zCount'), 'Should set zCount from config');
});

test('State tracks zarr store URL', () => {
    assert.ok(prefetchSource.includes("zarrStoreUrl: ''"), 'Should have zarrStoreUrl state');
    assert.ok(prefetchSource.includes('state.zarrStoreUrl'), 'Should set zarrStoreUrl from config');
});

// ========== Velocity tracking tests ==========

console.log('\nVelocity Tracking');

test('State tracks velocity', () => {
    assert.ok(prefetchSource.includes('velocity: 0'), 'Should have velocity state');
    assert.ok(prefetchSource.includes('lastZChangeTime'), 'Should track last Z change time');
    assert.ok(prefetchSource.includes('lastZ'), 'Should track last Z position');
});

test('Velocity uses exponential smoothing', () => {
    assert.ok(prefetchSource.includes('velocityDecay'), 'Should use decay factor');
    assert.ok(prefetchSource.includes('instantVelocity'), 'Should calculate instant velocity');
    assert.ok(prefetchSource.includes('state.velocity * CONFIG.velocityDecay'),
        'Should apply decay to velocity');
});

test('Velocity resets on long pause', () => {
    // If dt > 1000ms, velocity should reset to 0
    const onZSection = prefetchSource.substring(
        prefetchSource.indexOf('function onZChange'),
        prefetchSource.indexOf('function schedulePrefetch')
    );
    assert.ok(onZSection.includes('state.velocity = 0'),
        'Should reset velocity when interval is long');
});

test('Velocity direction affects prefetch prediction', () => {
    const predictSection = prefetchSource.substring(
        prefetchSource.indexOf('function predictPlanesToPrefetch'),
        prefetchSource.indexOf('function executePrefetch')
    );
    assert.ok(predictSection.includes('Math.sign'), 'Should use sign of velocity for direction');
    assert.ok(predictSection.includes('direction'), 'Should track direction');
    assert.ok(predictSection.includes('velocityThreshold'), 'Should use velocity threshold');
});

// ========== Prefetch prediction tests ==========

console.log('\nPrefetch Prediction');

test('predictPlanesToPrefetch exists', () => {
    assert.ok(prefetchSource.includes('function predictPlanesToPrefetch('),
        'Should have predictPlanesToPrefetch function');
});

test('Slow navigation prefetches symmetrically', () => {
    const predictSection = prefetchSource.substring(
        prefetchSource.indexOf('function predictPlanesToPrefetch'),
        prefetchSource.indexOf('function executePrefetch')
    );
    assert.ok(predictSection.includes('adjacentRadius'), 'Should use adjacentRadius for slow nav');
    assert.ok(predictSection.includes('currentZ + r'), 'Should prefetch forward');
    assert.ok(predictSection.includes('currentZ - r'), 'Should prefetch backward');
});

test('Fast navigation prefetches in direction of travel', () => {
    const predictSection = prefetchSource.substring(
        prefetchSource.indexOf('function predictPlanesToPrefetch'),
        prefetchSource.indexOf('function executePrefetch')
    );
    assert.ok(predictSection.includes('predictiveDepth'), 'Should use predictiveDepth for fast nav');
    assert.ok(predictSection.includes('direction * i'), 'Should prefetch in direction of travel');
});

test('Fast navigation includes one plane behind for reversal', () => {
    const predictSection = prefetchSource.substring(
        prefetchSource.indexOf('function predictPlanesToPrefetch'),
        prefetchSource.indexOf('function executePrefetch')
    );
    assert.ok(predictSection.includes('currentZ - direction'),
        'Should include plane behind for direction reversal');
});

test('Prediction respects Z bounds', () => {
    const predictSection = prefetchSource.substring(
        prefetchSource.indexOf('function predictPlanesToPrefetch'),
        prefetchSource.indexOf('function executePrefetch')
    );
    assert.ok(predictSection.includes('>= 0'), 'Should check lower bound');
    assert.ok(predictSection.includes('< state.zCount'), 'Should check upper bound');
});

// ========== Prefetch tracking tests ==========

console.log('\nPrefetch Tracking');

test('State tracks prefetched planes with Set', () => {
    assert.ok(prefetchSource.includes('prefetchedPlanes: new Set()'),
        'Should use Set for tracking prefetched planes');
});

test('Prefetched planes are tracked on success', () => {
    assert.ok(prefetchSource.includes('prefetchedPlanes.add(z)'),
        'Should add to prefetchedPlanes on successful prefetch');
});

test('SW handles cache eviction (no manual LRU)', () => {
    assert.ok(!prefetchSource.includes('function updateLRU'),
        'Should not have updateLRU (SW handles cache eviction)');
    assert.ok(!prefetchSource.includes('function evictPlaneFromCache'),
        'Should not have evictPlaneFromCache (SW handles it)');
});

// ========== Abort logic tests ==========

console.log('\nAbort Logic');

test('State tracks pending fetches with AbortController', () => {
    assert.ok(prefetchSource.includes('pendingFetches: new Map()'),
        'Should use Map for pending fetches');
    assert.ok(prefetchSource.includes('new AbortController()'), 'Should use AbortController');
});

test('abortStalePrefetches exists', () => {
    assert.ok(prefetchSource.includes('function abortStalePrefetches('),
        'Should have abortStalePrefetches function');
});

test('Abort keeps relevant fetches alive', () => {
    const abortSection = prefetchSource.substring(
        prefetchSource.indexOf('function abortStalePrefetches'),
        prefetchSource.indexOf('function getPrefetchState')
    );
    assert.ok(abortSection.includes('relevantPlanes'), 'Should determine relevant planes');
    assert.ok(abortSection.includes('currentZ'), 'Should include current Z as relevant');
    assert.ok(abortSection.includes('predictPlanesToPrefetch'), 'Should include predicted planes');
});

test('Abort calls controller.abort on stale requests', () => {
    const abortSection = prefetchSource.substring(
        prefetchSource.indexOf('function abortStalePrefetches'),
        prefetchSource.indexOf('function getPrefetchState')
    );
    assert.ok(abortSection.includes('controller.abort()'), 'Should call abort on stale fetches');
    assert.ok(abortSection.includes('pendingFetches.delete'), 'Should clean up aborted entries');
});

test('onZChange calls abortStalePrefetches', () => {
    const onZSection = prefetchSource.substring(
        prefetchSource.indexOf('function onZChange'),
        prefetchSource.indexOf('function schedulePrefetch')
    );
    assert.ok(onZSection.includes('abortStalePrefetches()'),
        'Should abort stale prefetches on Z change');
});

// ========== Prefetch execution tests ==========

console.log('\nPrefetch Execution');

test('Delegates caching to Service Worker (no direct Cache API)', () => {
    assert.ok(!prefetchSource.includes('caches.open'),
        'Should not use Cache API directly (SW handles it)');
    assert.ok(!prefetchSource.includes('cache.put'),
        'Should not store responses directly (SW handles it)');
});

test('Prefetch uses fetch API', () => {
    assert.ok(prefetchSource.includes('fetch(url'), 'Should use fetch API');
    assert.ok(prefetchSource.includes('signal: controller.signal'), 'Should pass abort signal');
    assert.ok(prefetchSource.includes("mode: 'cors'"), 'Should use CORS mode');
});

test('Prefetch respects maxConcurrent limit', () => {
    const prefetchSection = prefetchSource.substring(
        prefetchSource.indexOf('function prefetchPlane'),
        prefetchSource.indexOf('function abortStalePrefetches')
    );
    assert.ok(prefetchSection.includes('maxConcurrent'), 'Should check maxConcurrent');
    assert.ok(prefetchSection.includes('pendingFetches.size'), 'Should count active fetches');
});

test('Prefetch handles errors gracefully', () => {
    assert.ok(prefetchSource.includes('.catch('), 'Should catch fetch errors');
    assert.ok(prefetchSource.includes('AbortError'), 'Should handle AbortError specifically');
    assert.ok(prefetchSource.includes('stats.errors++'), 'Should track errors');
});

test('Prefetch skips already prefetched planes', () => {
    const execSection = prefetchSource.substring(
        prefetchSource.indexOf('function executePrefetch'),
        prefetchSource.indexOf('function choosePrefetchLevels')
    );
    assert.ok(execSection.includes('prefetchedPlanes.has(z)'), 'Should check if already prefetched');
    assert.ok(execSection.includes('stats.hits++'), 'Should track cache hits');
});

// ========== Resolution level selection tests ==========

console.log('\nResolution Level Selection');

test('choosePrefetchLevels exists', () => {
    assert.ok(prefetchSource.includes('function choosePrefetchLevels('),
        'Should have choosePrefetchLevels function');
});

test('Prioritizes coarse levels', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function choosePrefetchLevels'),
        prefetchSource.indexOf('function prefetchPlane')
    );
    assert.ok(section.includes('count - 1'), 'Should include coarsest level');
});

test('extractResolutionInfo extracts from loader data', () => {
    assert.ok(prefetchSource.includes('function extractResolutionInfo('),
        'Should have extractResolutionInfo function');
    assert.ok(prefetchSource.includes('shape'), 'Should read shape from loader data');
    assert.ok(prefetchSource.includes('chunks'), 'Should read chunks from loader data');
});

// ========== Chunk URL generation tests ==========

console.log('\nChunk URL Generation');

test('getChunkUrlsForZ exists', () => {
    assert.ok(prefetchSource.includes('function getChunkUrlsForZ('),
        'Should have getChunkUrlsForZ function');
});

test('URL generation follows OME-Zarr pattern', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getChunkUrlsForZ'),
        prefetchSource.indexOf('function onZChange')
    );
    assert.ok(section.includes('zarrStoreUrl'), 'Should use zarrStoreUrl');
    assert.ok(section.includes('levelIdx'), 'Should include level index');
    assert.ok(section.includes('zChunk'), 'Should include Z chunk index');
});

test('URL generation handles chunk-based Z indexing', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getChunkUrlsForZ'),
        prefetchSource.indexOf('function onZChange')
    );
    assert.ok(section.includes('Math.floor(z / info.zChunkSize)'),
        'Should calculate Z chunk index from plane index');
});

// ========== Stats tests ==========

console.log('\nStatistics');

test('Stats tracks hits', () => {
    assert.ok(prefetchSource.includes('hits: 0'), 'Should init hits to 0');
    assert.ok(prefetchSource.includes('stats.hits'), 'Should track hits');
});

test('Stats tracks misses', () => {
    assert.ok(prefetchSource.includes('misses: 0'), 'Should init misses to 0');
    assert.ok(prefetchSource.includes('stats.misses'), 'Should track misses');
});

test('Stats tracks prefetched count', () => {
    assert.ok(prefetchSource.includes('prefetched: 0'), 'Should init prefetched to 0');
    assert.ok(prefetchSource.includes('stats.prefetched++'), 'Should increment on prefetch');
});

test('Stats tracks aborted count', () => {
    assert.ok(prefetchSource.includes('aborted: 0'), 'Should init aborted to 0');
    assert.ok(prefetchSource.includes('stats.aborted++'), 'Should increment on abort');
});

test('Stats tracks errors', () => {
    assert.ok(prefetchSource.includes('errors: 0'), 'Should init errors to 0');
    assert.ok(prefetchSource.includes('stats.errors++'), 'Should increment on error');
});

test('getStats returns comprehensive info', () => {
    const statsSection = prefetchSource.substring(
        prefetchSource.indexOf('function getStats'),
        prefetchSource.indexOf('function setDebug')
    );
    assert.ok(statsSection.includes('hits:'), 'Should return hits');
    assert.ok(statsSection.includes('misses:'), 'Should return misses');
    assert.ok(statsSection.includes('prefetchedPlanes:'), 'Should return prefetched planes');
    assert.ok(statsSection.includes('velocity:'), 'Should return velocity');
    assert.ok(statsSection.includes('currentZ:'), 'Should return currentZ');
    assert.ok(statsSection.includes('pendingFetches:'), 'Should return pending fetch count');
    assert.ok(statsSection.includes('zarrStoreUrl:'), 'Should return zarr store URL');
    assert.ok(statsSection.includes('dimensionSeparator:'), 'Should return dimension separator');
});

// ========== Monitoring metrics tests (W10 5.4) ==========

console.log('\nMonitoring Metrics (W10 5.4)');

test('Stats has lateFetchCount', () => {
    assert.ok(prefetchSource.includes('lateFetchCount: 0'), 'Should init lateFetchCount to 0');
});

test('Stats has prefetchedBytes', () => {
    assert.ok(prefetchSource.includes('prefetchedBytes: 0'), 'Should init prefetchedBytes to 0');
});

test('Stats has zSwitchCount', () => {
    assert.ok(prefetchSource.includes('zSwitchCount: 0'), 'Should init zSwitchCount to 0');
});

test('onZChange increments zSwitchCount', () => {
    const onZSection = prefetchSource.substring(
        prefetchSource.indexOf('function onZChange'),
        prefetchSource.indexOf('function schedulePrefetch')
    );
    assert.ok(onZSection.includes('zSwitchCount++'),
        'Should increment zSwitchCount on Z change');
});

test('Prefetch response reads Content-Length header', () => {
    const prefetchSection = prefetchSource.substring(
        prefetchSource.indexOf('function prefetchPlane'),
        prefetchSource.indexOf('function abortStalePrefetches')
    );
    assert.ok(prefetchSection.includes("headers.get('Content-Length')"),
        'Should read Content-Length header from prefetch response');
    assert.ok(prefetchSection.includes('prefetchedBytes +='),
        'Should accumulate prefetched bytes');
});

test('onViewportLoad function exists', () => {
    assert.ok(prefetchSource.includes('function onViewportLoad('),
        'Should have onViewportLoad function');
});

test('onViewportLoad is exposed in public API', () => {
    assert.ok(prefetchSource.includes('onViewportLoad: onViewportLoad'),
        'Should expose onViewportLoad in public API');
});

test('onViewportLoad increments lateFetchCount when fetches pending', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function onViewportLoad'),
        prefetchSource.indexOf('function getStats')
    );
    assert.ok(section.includes('pendingFetches.size'),
        'Should check pendingFetches.size');
    assert.ok(section.includes('lateFetchCount++'),
        'Should increment lateFetchCount when prefetches still pending');
});

test('getStats returns lateFetchCount', () => {
    const statsSection = prefetchSource.substring(
        prefetchSource.indexOf('function getStats'),
        prefetchSource.indexOf('function setDebug')
    );
    assert.ok(statsSection.includes('lateFetchCount:'), 'Should return lateFetchCount');
});

test('getStats returns totalZSwitches', () => {
    const statsSection = prefetchSource.substring(
        prefetchSource.indexOf('function getStats'),
        prefetchSource.indexOf('function setDebug')
    );
    assert.ok(statsSection.includes('totalZSwitches:'), 'Should return totalZSwitches');
});

test('getStats returns prefetchedBytes', () => {
    const statsSection = prefetchSource.substring(
        prefetchSource.indexOf('function getStats'),
        prefetchSource.indexOf('function setDebug')
    );
    assert.ok(statsSection.includes('prefetchedBytes:'), 'Should return prefetchedBytes');
});

test('getStats returns prefetchedBytesPerZSwitch', () => {
    const statsSection = prefetchSource.substring(
        prefetchSource.indexOf('function getStats'),
        prefetchSource.indexOf('function setDebug')
    );
    assert.ok(statsSection.includes('prefetchedBytesPerZSwitch:'),
        'Should return prefetchedBytesPerZSwitch');
});

test('prefetchedBytesPerZSwitch handles zero Z-switches', () => {
    const statsSection = prefetchSource.substring(
        prefetchSource.indexOf('function getStats'),
        prefetchSource.indexOf('function setDebug')
    );
    assert.ok(statsSection.includes('zSwitches > 0'),
        'Should guard against division by zero');
});

test('destroy resets monitoring metrics', () => {
    const destroySection = prefetchSource.substring(
        prefetchSource.indexOf('function destroy'),
        prefetchSource.indexOf('function log')
    );
    assert.ok(destroySection.includes('lateFetchCount: 0'),
        'Should reset lateFetchCount on destroy');
    assert.ok(destroySection.includes('prefetchedBytes: 0'),
        'Should reset prefetchedBytes on destroy');
    assert.ok(destroySection.includes('zSwitchCount: 0'),
        'Should reset zSwitchCount on destroy');
});

// ========== Debounce tests ==========

console.log('\nDebounce');

test('schedulePrefetch uses debounce', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function schedulePrefetch'),
        prefetchSource.indexOf('function predictPlanesToPrefetch')
    );
    assert.ok(section.includes('clearTimeout'), 'Should clear previous timeout');
    assert.ok(section.includes('setTimeout'), 'Should schedule with timeout');
    assert.ok(section.includes('prefetchDelay'), 'Should use configured delay');
});

test('prefetchTimeout state is tracked', () => {
    assert.ok(prefetchSource.includes('prefetchTimeout: null'), 'Should init prefetchTimeout');
});

// ========== Init validation tests ==========

console.log('\nInit Validation');

test('init validates required params', () => {
    const initSection = prefetchSource.substring(
        prefetchSource.indexOf('function init('),
        prefetchSource.indexOf('function extractResolutionInfo')
    );
    assert.ok(initSection.includes('config.zCount'), 'Should check zCount');
    assert.ok(initSection.includes('return false'), 'Should return false on invalid config');
});

test('init strips trailing slash from baseUrl', () => {
    const initSection = prefetchSource.substring(
        prefetchSource.indexOf('function init('),
        prefetchSource.indexOf('function extractResolutionInfo')
    );
    assert.ok(initSection.includes("replace(/\\/$/, '')"),
        'Should strip trailing slash from baseUrl');
});

test('init allows config overrides', () => {
    const initSection = prefetchSource.substring(
        prefetchSource.indexOf('function init('),
        prefetchSource.indexOf('function extractResolutionInfo')
    );
    assert.ok(initSection.includes('config.options'), 'Should accept config.options');
    assert.ok(initSection.includes('CONFIG[key] = config.options[key]'),
        'Should apply option overrides');
});

test('init triggers initial prefetch', () => {
    const initSection = prefetchSource.substring(
        prefetchSource.indexOf('function init('),
        prefetchSource.indexOf('function extractResolutionInfo')
    );
    assert.ok(initSection.includes('schedulePrefetch()'),
        'Should schedule prefetch on init');
});

// ========== Destroy tests ==========

console.log('\nDestroy');

test('destroy clears scheduled prefetch', () => {
    const destroySection = prefetchSource.substring(
        prefetchSource.indexOf('function destroy'),
        prefetchSource.indexOf('function log')
    );
    assert.ok(destroySection.includes('clearTimeout'), 'Should clear timeout');
    assert.ok(destroySection.includes('prefetchTimeout = null'),
        'Should null out prefetchTimeout');
});

test('destroy aborts all pending fetches', () => {
    const destroySection = prefetchSource.substring(
        prefetchSource.indexOf('function destroy'),
        prefetchSource.indexOf('function log')
    );
    assert.ok(destroySection.includes('controller.abort()'), 'Should abort pending fetches');
    assert.ok(destroySection.includes('pendingFetches.clear()'), 'Should clear pending map');
});

test('destroy does not manage cache directly (SW handles it)', () => {
    const destroySection = prefetchSource.substring(
        prefetchSource.indexOf('function destroy'),
        prefetchSource.indexOf('function log')
    );
    assert.ok(!destroySection.includes('caches.delete'),
        'Should not delete cache directly (SW manages it)');
});

test('destroy resets stats', () => {
    const destroySection = prefetchSource.substring(
        prefetchSource.indexOf('function destroy'),
        prefetchSource.indexOf('function log')
    );
    assert.ok(destroySection.includes('stats ='), 'Should reset stats object');
    assert.ok(destroySection.includes('prefetchedPlanes.clear()'), 'Should clear prefetched planes');
});

test('destroy resets velocity', () => {
    const destroySection = prefetchSource.substring(
        prefetchSource.indexOf('function destroy'),
        prefetchSource.indexOf('function log')
    );
    assert.ok(destroySection.includes('state.velocity = 0'), 'Should reset velocity');
});

// ========== getPrefetchState tests ==========

console.log('\ngetPrefetchState');

test('getPrefetchState returns correct states', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getPrefetchState'),
        prefetchSource.indexOf('function warmPlane')
    );
    assert.ok(section.includes("'cached'"), 'Should return cached');
    assert.ok(section.includes("'loading'"), 'Should return loading');
    assert.ok(section.includes("'none'"), 'Should return none');
});

test('getPrefetchState checks prefetchedPlanes first', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getPrefetchState'),
        prefetchSource.indexOf('function warmPlane')
    );
    assert.ok(section.includes('prefetchedPlanes.has(z)'), 'Should check prefetchedPlanes');
});

test('getPrefetchState checks pendingFetches for loading state', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getPrefetchState'),
        prefetchSource.indexOf('function warmPlane')
    );
    assert.ok(section.includes('pendingFetches.has'), 'Should check pendingFetches');
});

// ========== warmPlane tests ==========

console.log('\nwarmPlane');

test('warmPlane validates bounds', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function warmPlane'),
        prefetchSource.indexOf('function getStats')
    );
    assert.ok(section.includes('z < 0'), 'Should check lower bound');
    assert.ok(section.includes('z >= state.zCount'), 'Should check upper bound');
});

test('warmPlane skips already prefetched', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function warmPlane'),
        prefetchSource.indexOf('function getStats')
    );
    assert.ok(section.includes('prefetchedPlanes.has(z)'), 'Should skip if already prefetched');
});

test('warmPlane calls prefetchPlane', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function warmPlane'),
        prefetchSource.indexOf('function getStats')
    );
    assert.ok(section.includes('prefetchPlane(z'), 'Should call prefetchPlane');
});

// ========== Viewport filtering tests (W10) ==========

console.log('\nViewport Filtering (W10)');

test('State has getViewState callback', () => {
    assert.ok(prefetchSource.includes('getViewState: null'),
        'Should have getViewState state initialized to null');
});

test('State has getContainerSize callback', () => {
    assert.ok(prefetchSource.includes('getContainerSize: null'),
        'Should have getContainerSize state initialized to null');
});

test('init accepts getViewState and getContainerSize', () => {
    const initSection = prefetchSource.substring(
        prefetchSource.indexOf('function init('),
        prefetchSource.indexOf('function extractResolutionInfo')
    );
    assert.ok(initSection.includes('config.getViewState'),
        'Should read getViewState from config');
    assert.ok(initSection.includes('config.getContainerSize'),
        'Should read getContainerSize from config');
});

test('getViewportTileRange function exists', () => {
    assert.ok(prefetchSource.includes('function getViewportTileRange('),
        'Should have getViewportTileRange function');
});

test('getViewportTileRange uses viewportMath module', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getViewportTileRange'),
        prefetchSource.indexOf('function onZChange')
    );
    assert.ok(section.includes('viewportMath'),
        'Should reference viewportMath module');
    assert.ok(section.includes('viewStateToBounds'),
        'Should use viewStateToBounds');
    assert.ok(section.includes('boundsToTileRange'),
        'Should use boundsToTileRange');
});

test('getViewportTileRange uses 2-tile margin', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getViewportTileRange'),
        prefetchSource.indexOf('function onZChange')
    );
    assert.ok(section.includes(', 2)'),
        'Should pass margin=2 to boundsToTileRange');
});

test('getViewportTileRange returns null when viewport unavailable', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getViewportTileRange'),
        prefetchSource.indexOf('function onZChange')
    );
    assert.ok(section.includes('return null'),
        'Should return null when viewport info unavailable (graceful fallback)');
});

test('getChunkUrlsForZ accepts optional tileRange parameter', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getChunkUrlsForZ'),
        prefetchSource.indexOf('function getViewportTileRange')
    );
    assert.ok(section.includes('tileRange'),
        'Should accept tileRange parameter');
    assert.ok(section.includes('tileRange.minTileY'),
        'Should use tileRange.minTileY');
    assert.ok(section.includes('tileRange.maxTileY'),
        'Should use tileRange.maxTileY');
    assert.ok(section.includes('tileRange.minTileX'),
        'Should use tileRange.minTileX');
    assert.ok(section.includes('tileRange.maxTileX'),
        'Should use tileRange.maxTileX');
});

test('getChunkUrlsForZ falls back to all chunks when no tileRange', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function getChunkUrlsForZ'),
        prefetchSource.indexOf('function getViewportTileRange')
    );
    // When tileRange is null/undefined, should use 0..yChunks-1 and 0..xChunks-1
    assert.ok(section.includes('tileRange ? tileRange.minTileY : 0'),
        'Should default yMin to 0 when no tileRange');
    assert.ok(section.includes('tileRange ? tileRange.maxTileY : info.yChunks - 1'),
        'Should default yMax to all chunks when no tileRange');
});

test('executePrefetch computes viewport tile ranges per level', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function executePrefetch'),
        prefetchSource.indexOf('function choosePrefetchLevels')
    );
    assert.ok(section.includes('getViewportTileRange'),
        'Should call getViewportTileRange in executePrefetch');
    assert.ok(section.includes('tileRanges'),
        'Should compute tileRanges object');
});

test('prefetchPlane accepts tileRange parameter', () => {
    const section = prefetchSource.substring(
        prefetchSource.indexOf('function prefetchPlane'),
        prefetchSource.indexOf('function abortStalePrefetches')
    );
    assert.ok(section.includes('tileRange'),
        'Should accept tileRange parameter');
    assert.ok(section.includes('getChunkUrlsForZ(z, levelIdx, tileRange)'),
        'Should pass tileRange to getChunkUrlsForZ');
});

test('destroy clears viewport callbacks', () => {
    const destroySection = prefetchSource.substring(
        prefetchSource.indexOf('function destroy'),
        prefetchSource.indexOf('function log')
    );
    assert.ok(destroySection.includes('getViewState = null'),
        'Should null getViewState on destroy');
    assert.ok(destroySection.includes('getContainerSize = null'),
        'Should null getContainerSize on destroy');
});

// ========== Performance hypothesis documented ==========

console.log('\nDocumentation');

test('SW caching strategy is documented', () => {
    assert.ok(prefetchSource.includes('Service Worker'),
        'Should document Service Worker caching strategy');
    assert.ok(prefetchSource.includes('SW handles'),
        'Should document that SW handles caching');
});

// ========== Summary ==========

console.log('\n---');
console.log(`Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
}
