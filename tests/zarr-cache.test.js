#!/usr/bin/env node
// Unit tests for zarr-cache.js - runs with plain Node.js
// Usage: node zarr-cache.test.js
//
// Tests verify file structure, IIFE patterns, API surface, and logic patterns.
// Full integration tests require browser environment with Cache API.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`\u2713 ${name}`);
        passed++;
    } catch (error) {
        console.log(`\u2717 ${name}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

// Read source file for static analysis
const cachePath = path.join(__dirname, '..', 'js', 'zarr-cache.js');
const cacheSource = fs.readFileSync(cachePath, 'utf8');

// ========== File structure tests ==========

test('zarr-cache.js exists', () => {
    assert.ok(fs.existsSync(cachePath), 'zarr-cache.js should exist in web/js/');
});

test('zarr-cache.js uses IIFE pattern', () => {
    assert.ok(cacheSource.includes('(function()'), 'Should use IIFE pattern');
    assert.ok(cacheSource.includes("'use strict'"), 'Should use strict mode');
    assert.ok(cacheSource.includes('})();'), 'Should close IIFE properly');
});

test('zarr-cache.js does not pollute global scope', () => {
    // All variables should be inside the IIFE
    // Check that var/let/const declarations appear after the IIFE opening
    const iifeStart = cacheSource.indexOf('(function()');
    const iifeEnd = cacheSource.lastIndexOf('})();');
    assert.ok(iifeStart > 0, 'Should have IIFE start');
    assert.ok(iifeEnd > iifeStart, 'Should have IIFE end after start');

    // Only window.evostitch should be set outside (inside IIFE body though)
    assert.ok(cacheSource.includes('window.evostitch = window.evostitch || {}'), 'Should use defensive namespace init');
});

// ========== Priority constants tests ==========

test('zarr-cache.js defines PRIORITY constants', () => {
    assert.ok(cacheSource.includes('var PRIORITY'), 'Should define PRIORITY object');
    assert.ok(cacheSource.includes('CRITICAL:'), 'Should have CRITICAL priority');
    assert.ok(cacheSource.includes('HIGH:'), 'Should have HIGH priority');
    assert.ok(cacheSource.includes('NORMAL:'), 'Should have NORMAL priority');
    assert.ok(cacheSource.includes('LOW:'), 'Should have LOW priority');
});

test('zarr-cache.js priorities are in correct order', () => {
    const criticalMatch = cacheSource.match(/CRITICAL:\s*(\d+)/);
    const highMatch = cacheSource.match(/HIGH:\s*(\d+)/);
    const normalMatch = cacheSource.match(/NORMAL:\s*(\d+)/);
    const lowMatch = cacheSource.match(/LOW:\s*(\d+)/);

    assert.ok(criticalMatch, 'Should have CRITICAL value');
    assert.ok(highMatch, 'Should have HIGH value');
    assert.ok(normalMatch, 'Should have NORMAL value');
    assert.ok(lowMatch, 'Should have LOW value');

    const critical = parseInt(criticalMatch[1], 10);
    const high = parseInt(highMatch[1], 10);
    const normal = parseInt(normalMatch[1], 10);
    const low = parseInt(lowMatch[1], 10);

    assert.ok(critical < high, 'CRITICAL should be highest priority (lowest number)');
    assert.ok(high < normal, 'HIGH should be higher priority than NORMAL');
    assert.ok(normal < low, 'NORMAL should be higher priority than LOW');
});

test('zarr-cache.js exposes PRIORITY in public API', () => {
    assert.ok(cacheSource.includes('PRIORITY: PRIORITY'), 'Should expose PRIORITY constants');
});

// ========== Configuration tests ==========

test('zarr-cache.js defines CONFIG object', () => {
    assert.ok(cacheSource.includes('var CONFIG'), 'Should define CONFIG object');
    assert.ok(cacheSource.includes('maxCacheBytes'), 'Should have maxCacheBytes config');
    assert.ok(cacheSource.includes('maxConcurrent'), 'Should have maxConcurrent config');
    assert.ok(cacheSource.includes('baseUrl'), 'Should have baseUrl config');
});

test('zarr-cache.js has reasonable default cache size', () => {
    const sizeMatch = cacheSource.match(/maxCacheBytes:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
    assert.ok(sizeMatch, 'Should define maxCacheBytes as multiplication');
    const bytes = parseInt(sizeMatch[1]) * parseInt(sizeMatch[2]) * parseInt(sizeMatch[3]);
    assert.ok(bytes >= 100 * 1024 * 1024, 'Default cache should be at least 100MB');
    assert.ok(bytes <= 2 * 1024 * 1024 * 1024, 'Default cache should be at most 2GB');
});

test('zarr-cache.js has reasonable default concurrency limit', () => {
    const concurrentMatch = cacheSource.match(/maxConcurrent:\s*(\d+)/);
    assert.ok(concurrentMatch, 'Should have maxConcurrent value');
    const limit = parseInt(concurrentMatch[1], 10);
    assert.ok(limit >= 4 && limit <= 16, `maxConcurrent should be 4-16 (got ${limit})`);
});

// ========== Public API tests ==========

test('zarr-cache.js exposes evostitch.zarrCache', () => {
    assert.ok(cacheSource.includes('window.evostitch'), 'Should attach to window.evostitch');
    assert.ok(cacheSource.includes('evostitch.zarrCache'), 'Should expose zarrCache');
});

test('zarr-cache.js has init function', () => {
    assert.ok(cacheSource.includes('function init('), 'Should have init function');
    assert.ok(cacheSource.includes('init: init'), 'Should expose init in public API');
});

test('zarr-cache.js has fetchWithCache function', () => {
    assert.ok(cacheSource.includes('function fetchWithCache('), 'Should have fetchWithCache function');
    assert.ok(cacheSource.includes('fetchWithCache: fetchWithCache'), 'Should expose fetchWithCache in public API');
});

test('zarr-cache.js has prefetchUrls function', () => {
    assert.ok(cacheSource.includes('function prefetchUrls('), 'Should have prefetchUrls function');
    assert.ok(cacheSource.includes('prefetchUrls: prefetchUrls'), 'Should expose prefetchUrls in public API');
});

test('zarr-cache.js has cancelPrefetch function', () => {
    assert.ok(cacheSource.includes('function cancelPrefetch('), 'Should have cancelPrefetch function');
    assert.ok(cacheSource.includes('cancelPrefetch: cancelPrefetch'), 'Should expose cancelPrefetch in public API');
});

test('zarr-cache.js has getStats function', () => {
    assert.ok(cacheSource.includes('function getStats('), 'Should have getStats function');
    assert.ok(cacheSource.includes('getStats: getStats'), 'Should expose getStats in public API');
});

test('zarr-cache.js has clearCache function', () => {
    assert.ok(cacheSource.includes('function clearCache('), 'Should have clearCache function');
    assert.ok(cacheSource.includes('clearCache: clearCache'), 'Should expose clearCache in public API');
});

test('zarr-cache.js has setDebug function', () => {
    assert.ok(cacheSource.includes('function setDebug('), 'Should have setDebug function');
    assert.ok(cacheSource.includes('setDebug: setDebug'), 'Should expose setDebug in public API');
});

test('zarr-cache.js has destroy function', () => {
    assert.ok(cacheSource.includes('function destroy('), 'Should have destroy function');
    assert.ok(cacheSource.includes('destroy: destroy'), 'Should expose destroy in public API');
});

// ========== Cache API integration tests ==========

test('zarr-cache.js uses Cache API', () => {
    assert.ok(cacheSource.includes('caches.open('), 'Should open Cache API');
    assert.ok(cacheSource.includes('CACHE_NAME'), 'Should use named cache');
});

test('zarr-cache.js defines cache name constant', () => {
    const nameMatch = cacheSource.match(/CACHE_NAME\s*=\s*'([^']+)'/);
    assert.ok(nameMatch, 'Should define CACHE_NAME');
    assert.ok(nameMatch[1].includes('zarr'), 'Cache name should include "zarr"');
});

test('zarr-cache.js checks cache before fetching', () => {
    assert.ok(cacheSource.includes('function checkCache('), 'Should have checkCache function');
    // In fetchWithCache, checkCache should be called first
    const fetchSection = cacheSource.substring(
        cacheSource.indexOf('function fetchWithCache('),
        cacheSource.indexOf('function prefetchUrls(')
    );
    assert.ok(fetchSection.includes('checkCache(url)'), 'fetchWithCache should call checkCache');
});

test('zarr-cache.js stores responses in cache after fetch', () => {
    assert.ok(cacheSource.includes('function storeInCache('), 'Should have storeInCache function');
    assert.ok(cacheSource.includes('response.clone()'), 'Should clone response before caching');
    assert.ok(cacheSource.includes('cacheHandle.put('), 'Should put response in cache');
});

test('zarr-cache.js handles Cache API unavailability gracefully', () => {
    assert.ok(cacheSource.includes("typeof caches === 'undefined'") ||
              cacheSource.includes("typeof caches === \"undefined\""),
        'Should check if Cache API is available');
    assert.ok(cacheSource.includes('fetch-only mode'), 'Should fall back to fetch-only mode');
});

// ========== LRU eviction tests ==========

test('zarr-cache.js tracks access order for LRU', () => {
    assert.ok(cacheSource.includes('var accessOrder = []'), 'Should have accessOrder array');
    assert.ok(cacheSource.includes('var totalCacheBytes'), 'Should track total cache bytes');
});

test('zarr-cache.js has touchAccessOrder function', () => {
    assert.ok(cacheSource.includes('function touchAccessOrder('), 'Should have touchAccessOrder function');
    // Touch should move entry to end of array
    const touchSection = cacheSource.substring(
        cacheSource.indexOf('function touchAccessOrder('),
        cacheSource.indexOf('function addToAccessOrder(')
    );
    assert.ok(touchSection.includes('splice(i, 1)'), 'Should remove entry from current position');
    assert.ok(touchSection.includes('accessOrder.push('), 'Should push entry to end');
});

test('zarr-cache.js has evictIfNeeded function', () => {
    assert.ok(cacheSource.includes('function evictIfNeeded('), 'Should have evictIfNeeded function');
    assert.ok(cacheSource.includes('maxCacheBytes'), 'Should compare against maxCacheBytes');
    assert.ok(cacheSource.includes('accessOrder.shift()'), 'Should remove oldest (first) entry');
});

test('zarr-cache.js evicts from the beginning of accessOrder (LRU)', () => {
    const evictSection = cacheSource.substring(
        cacheSource.indexOf('function evictIfNeeded('),
        cacheSource.indexOf('// ========== Internal: Fetch Queue')
    );
    assert.ok(evictSection.includes('accessOrder.shift()'), 'Should shift (remove oldest) from accessOrder');
    assert.ok(evictSection.includes('cacheHandle.delete('), 'Should delete evicted entries from cache');
    assert.ok(evictSection.includes('totalCacheBytes -= oldest.size'), 'Should update byte count on eviction');
});

test('zarr-cache.js rebuilds access order from cache on init', () => {
    assert.ok(cacheSource.includes('function rebuildAccessOrder('), 'Should have rebuildAccessOrder function');
    assert.ok(cacheSource.includes('cacheHandle.keys()'), 'Should read cache keys');
});

// ========== Priority queue tests ==========

test('zarr-cache.js has fetch queue', () => {
    assert.ok(cacheSource.includes('var fetchQueue = []'), 'Should have fetchQueue array');
    assert.ok(cacheSource.includes('var activeCount = 0'), 'Should track active fetch count');
});

test('zarr-cache.js inserts into queue sorted by priority', () => {
    const enqueueSection = cacheSource.substring(
        cacheSource.indexOf('function enqueueFetch('),
        cacheSource.indexOf('function processQueue(')
    );
    assert.ok(enqueueSection.includes('priority < fetchQueue[i].priority'), 'Should compare priorities for insertion');
    assert.ok(enqueueSection.includes('fetchQueue.splice(i, 0, item)'), 'Should splice into sorted position');
});

test('zarr-cache.js has processQueue function', () => {
    assert.ok(cacheSource.includes('function processQueue('), 'Should have processQueue function');
    assert.ok(cacheSource.includes('activeCount < CONFIG.maxConcurrent'), 'Should respect concurrency limit');
    assert.ok(cacheSource.includes('fetchQueue.shift()'), 'Should dequeue from front (highest priority)');
});

// ========== Concurrency control tests ==========

test('zarr-cache.js limits concurrent fetches', () => {
    const processSection = cacheSource.substring(
        cacheSource.indexOf('function processQueue('),
        cacheSource.indexOf('function executeFetch(')
    );
    assert.ok(processSection.includes('activeCount < CONFIG.maxConcurrent'), 'Should check concurrency limit');
});

test('zarr-cache.js increments/decrements active count', () => {
    const executeSection = cacheSource.substring(
        cacheSource.indexOf('function executeFetch('),
        cacheSource.indexOf('function recordFetchDuration(')
    );
    assert.ok(executeSection.includes('activeCount++'), 'Should increment activeCount on start');
    // Should decrement on both success and error
    const decrements = (executeSection.match(/activeCount--/g) || []).length;
    assert.ok(decrements >= 2, 'Should decrement activeCount on both success and error');
});

test('zarr-cache.js continues processing after fetch completes', () => {
    const executeSection = cacheSource.substring(
        cacheSource.indexOf('function executeFetch('),
        cacheSource.indexOf('function recordFetchDuration(')
    );
    // processQueue should be called after both success and error
    const processQueueCalls = (executeSection.match(/processQueue\(\)/g) || []).length;
    assert.ok(processQueueCalls >= 2, 'Should call processQueue after fetch success and error');
});

// ========== Abort/cancellation tests ==========

test('zarr-cache.js uses AbortController for fetch cancellation', () => {
    assert.ok(cacheSource.includes('new AbortController()'), 'Should create AbortController');
    assert.ok(cacheSource.includes('signal: item.abortController.signal'), 'Should pass signal to fetch');
});

test('zarr-cache.js handles AbortError', () => {
    assert.ok(cacheSource.includes("err.name === 'AbortError'") ||
              cacheSource.includes("err.name !== 'AbortError'"),
        'Should check for AbortError');
});

test('zarr-cache.js cancelPrefetch aborts queued requests', () => {
    const cancelSection = cacheSource.substring(
        cacheSource.indexOf('function cancelPrefetch('),
        cacheSource.indexOf('function getStats(')
    );
    assert.ok(cancelSection.includes('item.abortController.abort()'), 'Should abort queued items');
    assert.ok(cancelSection.includes('fetchQueue = fetchQueue.filter('), 'Should remove from queue');
});

test('zarr-cache.js cancelPrefetch skips high-priority in-flight requests', () => {
    const cancelSection = cacheSource.substring(
        cacheSource.indexOf('function cancelPrefetch('),
        cacheSource.indexOf('function getStats(')
    );
    assert.ok(cancelSection.includes('inflight.priority > PRIORITY.HIGH'), 'Should only abort lower-priority in-flight');
});

// ========== Request deduplication tests ==========

test('zarr-cache.js tracks in-flight requests', () => {
    assert.ok(cacheSource.includes('var inflightRequests = new Map()'), 'Should have inflightRequests map');
});

test('zarr-cache.js deduplicates concurrent requests', () => {
    const fetchSection = cacheSource.substring(
        cacheSource.indexOf('function fetchWithCache('),
        cacheSource.indexOf('function prefetchUrls(')
    );
    assert.ok(fetchSection.includes('inflightRequests.get(url)'), 'Should check for existing in-flight request');
    assert.ok(fetchSection.includes('return inflight.promise'), 'Should return existing promise for dedup');
});

test('zarr-cache.js upgrades priority on dedup hit', () => {
    const fetchSection = cacheSource.substring(
        cacheSource.indexOf('function fetchWithCache('),
        cacheSource.indexOf('function prefetchUrls(')
    );
    assert.ok(fetchSection.includes('priority < inflight.priority'), 'Should check if new priority is higher');
    assert.ok(fetchSection.includes('inflight.priority = priority'), 'Should upgrade priority');
});

test('zarr-cache.js cleans up in-flight tracking after completion', () => {
    assert.ok(cacheSource.includes('inflightRequests.delete(url)'), 'Should remove from inflightRequests on completion');
});

// ========== Telemetry tests ==========

test('zarr-cache.js tracks cache hits and misses', () => {
    assert.ok(cacheSource.includes('stats.hits++'), 'Should increment hits on cache hit');
    assert.ok(cacheSource.includes('stats.misses++'), 'Should increment misses on cache miss');
});

test('zarr-cache.js tracks fetch durations', () => {
    assert.ok(cacheSource.includes('function recordFetchDuration('), 'Should have recordFetchDuration function');
    assert.ok(cacheSource.includes('performance.now()'), 'Should use performance.now() for timing');
    assert.ok(cacheSource.includes('stats.fetchDurations.push('), 'Should store fetch durations');
});

test('zarr-cache.js limits duration samples', () => {
    assert.ok(cacheSource.includes('maxDurationSamples'), 'Should have max sample limit');
    assert.ok(cacheSource.includes('stats.fetchDurations.shift()'), 'Should evict oldest samples');
});

test('zarr-cache.js tracks bytes transferred', () => {
    assert.ok(cacheSource.includes('stats.bytesTransferred'), 'Should track bytes transferred');
    assert.ok(cacheSource.includes('content-length'), 'Should read content-length header');
});

test('zarr-cache.js getStats returns comprehensive info', () => {
    const statsSection = cacheSource.substring(
        cacheSource.indexOf('function getStats('),
        cacheSource.indexOf('function clearCache(')
    );
    assert.ok(statsSection.includes('hits:'), 'getStats should include hits');
    assert.ok(statsSection.includes('misses:'), 'getStats should include misses');
    assert.ok(statsSection.includes('hitRate:'), 'getStats should include hitRate');
    assert.ok(statsSection.includes('cacheSize:'), 'getStats should include cacheSize');
    assert.ok(statsSection.includes('pendingRequests:'), 'getStats should include pendingRequests');
    assert.ok(statsSection.includes('activeRequests:'), 'getStats should include activeRequests');
});

// ========== Destroy/cleanup tests ==========

test('zarr-cache.js destroy cancels all queued fetches', () => {
    const destroySection = cacheSource.substring(
        cacheSource.indexOf('function destroy('),
        cacheSource.indexOf('// ========== Internal: Cache API')
    );
    assert.ok(destroySection.includes('fetchQueue.forEach('), 'Should iterate queued fetches');
    assert.ok(destroySection.includes('item.abortController.abort()'), 'Should abort queued fetches');
    assert.ok(destroySection.includes('fetchQueue = []'), 'Should clear fetch queue');
});

test('zarr-cache.js destroy aborts in-flight requests', () => {
    const destroySection = cacheSource.substring(
        cacheSource.indexOf('function destroy('),
        cacheSource.indexOf('// ========== Internal: Cache API')
    );
    assert.ok(destroySection.includes('inflightRequests.forEach('), 'Should iterate in-flight requests');
    assert.ok(destroySection.includes('inflight.abortController.abort()'), 'Should abort in-flight requests');
    assert.ok(destroySection.includes('inflightRequests.clear()'), 'Should clear in-flight map');
});

test('zarr-cache.js destroy resets state', () => {
    const destroySection = cacheSource.substring(
        cacheSource.indexOf('function destroy('),
        cacheSource.indexOf('// ========== Internal: Cache API')
    );
    assert.ok(destroySection.includes('accessOrder = []'), 'Should reset accessOrder');
    assert.ok(destroySection.includes('totalCacheBytes = 0'), 'Should reset totalCacheBytes');
    assert.ok(destroySection.includes('activeCount = 0'), 'Should reset activeCount');
    assert.ok(destroySection.includes('initialized = false'), 'Should reset initialized flag');
});

test('zarr-cache.js clearCache resets stats', () => {
    const clearSection = cacheSource.substring(
        cacheSource.indexOf('function clearCache('),
        cacheSource.indexOf('function setDebug(')
    );
    assert.ok(clearSection.includes('stats.hits = 0'), 'Should reset hits');
    assert.ok(clearSection.includes('stats.misses = 0'), 'Should reset misses');
    assert.ok(clearSection.includes('caches.delete(CACHE_NAME)'), 'Should delete cache');
    assert.ok(clearSection.includes('openCache()'), 'Should re-open cache after delete');
});

// ========== Prefetch tests ==========

test('zarr-cache.js prefetchUrls returns cancel handle', () => {
    const prefetchSection = cacheSource.substring(
        cacheSource.indexOf('function prefetchUrls('),
        cacheSource.indexOf('function cancelPrefetch(')
    );
    assert.ok(prefetchSection.includes('cancel: function()'), 'Should return cancel function');
    assert.ok(prefetchSection.includes('promise: Promise.all('), 'Should return combined promise');
});

test('zarr-cache.js prefetchUrls swallows errors', () => {
    const prefetchSection = cacheSource.substring(
        cacheSource.indexOf('function prefetchUrls('),
        cacheSource.indexOf('function cancelPrefetch(')
    );
    assert.ok(prefetchSection.includes('.catch(function(err)'), 'Should catch errors');
    assert.ok(prefetchSection.includes("err.name !== 'AbortError'"), 'Should distinguish abort from real errors');
});

// ========== Init guard tests ==========

test('zarr-cache.js init is idempotent', () => {
    const initSection = cacheSource.substring(
        cacheSource.indexOf('function init('),
        cacheSource.indexOf('function fetchWithCache(')
    );
    assert.ok(initSection.includes('if (initialized)'), 'Should check initialized flag');
    assert.ok(initSection.includes('Already initialized'), 'Should skip if already initialized');
});

test('zarr-cache.js fetchWithCache falls back to plain fetch when not initialized', () => {
    const fetchSection = cacheSource.substring(
        cacheSource.indexOf('function fetchWithCache('),
        cacheSource.indexOf('function prefetchUrls(')
    );
    assert.ok(fetchSection.includes('if (!initialized)'), 'Should check initialized');
    assert.ok(fetchSection.includes('return fetch(url)'), 'Should fall back to plain fetch');
});

// ========== Utility tests ==========

test('zarr-cache.js has formatBytes helper', () => {
    assert.ok(cacheSource.includes('function formatBytes('), 'Should have formatBytes function');
    assert.ok(cacheSource.includes("'KB'") || cacheSource.includes('"KB"'), 'Should format in KB');
    assert.ok(cacheSource.includes("'MB'") || cacheSource.includes('"MB"'), 'Should format in MB');
});

// Summary
console.log('\n---');
console.log(`Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
}
