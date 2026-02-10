#!/usr/bin/env node
// Unit tests for service worker (sw.js) - runs with plain Node.js
// Usage: node sw.test.js
//
// Note: Service workers require browser environment for full testing.
// These tests verify file structure and can be extended with Playwright integration tests.

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

// Read SW source for static analysis
const swPath = path.join(__dirname, '..', 'sw.js');
const swSource = fs.readFileSync(swPath, 'utf8');

// Read viewer.html for registration verification
const viewerPath = path.join(__dirname, '..', 'viewer.html');
const viewerSource = fs.readFileSync(viewerPath, 'utf8');

// ========== sw.js file structure tests ==========

test('sw.js exists', () => {
    assert.ok(fs.existsSync(swPath), 'sw.js should exist in web/');
});

test('sw.js defines SW_VERSION constant', () => {
    assert.ok(swSource.includes('SW_VERSION'), 'Should define SW_VERSION');
    assert.ok(swSource.match(/const SW_VERSION\s*=\s*['"][\d.]+['"]/), 'SW_VERSION should be a version string');
});

test('sw.js defines TILE_CACHE_NAME constant', () => {
    assert.ok(swSource.includes('TILE_CACHE_NAME'), 'Should define TILE_CACHE_NAME');
    assert.ok(swSource.includes('evostitch-tiles-'), 'TILE_CACHE_NAME should have evostitch-tiles prefix');
});

test('sw.js defines STATIC_CACHE_NAME constant', () => {
    assert.ok(swSource.includes('STATIC_CACHE_NAME'), 'Should define STATIC_CACHE_NAME');
    assert.ok(swSource.includes('evostitch-static-'), 'STATIC_CACHE_NAME should have evostitch-static prefix');
});

test('sw.js has install event listener', () => {
    assert.ok(swSource.includes("addEventListener('install'"), 'Should have install event listener');
});

test('sw.js has activate event listener', () => {
    assert.ok(swSource.includes("addEventListener('activate'"), 'Should have activate event listener');
});

test('sw.js has fetch event listener', () => {
    assert.ok(swSource.includes("addEventListener('fetch'"), 'Should have fetch event listener');
});

test('sw.js uses skipWaiting for immediate activation', () => {
    assert.ok(swSource.includes('skipWaiting'), 'Should call skipWaiting() for immediate activation');
});

test('sw.js claims clients on activate', () => {
    assert.ok(swSource.includes('clients.claim'), 'Should call clients.claim() to take control immediately');
});

test('sw.js cleans up old caches on activate', () => {
    assert.ok(swSource.includes('caches.keys'), 'Should enumerate existing caches');
    assert.ok(swSource.includes('caches.delete'), 'Should delete old caches');
});

// ========== viewer.html registration tests ==========

test('viewer.html registers service worker', () => {
    assert.ok(viewerSource.includes('serviceWorker'), 'Should reference serviceWorker API');
    assert.ok(viewerSource.includes("navigator.serviceWorker.register"), 'Should call register()');
});

test('viewer.html registers with scope', () => {
    assert.ok(viewerSource.includes("scope: '/'"), 'Should specify root scope');
});

test('viewer.html checks for serviceWorker support', () => {
    assert.ok(viewerSource.includes("'serviceWorker' in navigator"), 'Should check for serviceWorker support');
});

test('viewer.html registers SW after page load', () => {
    assert.ok(viewerSource.includes("window.addEventListener('load'"), 'Should wait for page load before registering');
});

test('viewer.html handles registration errors', () => {
    assert.ok(viewerSource.includes('.catch'), 'Should handle registration errors with catch');
});

test('viewer.html logs registration status', () => {
    assert.ok(viewerSource.includes('[evostitch] Service Worker registered'), 'Should log successful registration');
    assert.ok(viewerSource.includes('[evostitch] Service Worker registration failed'), 'Should log registration failures');
});

// ========== Tile caching strategy tests (Step 1.2) ==========

test('sw.js defines TILE_URL_PATTERN for tile detection', () => {
    assert.ok(swSource.includes('TILE_URL_PATTERN'), 'Should define TILE_URL_PATTERN');
    assert.ok(swSource.includes('_files'), 'Pattern should match DZI _files directory structure');
});

test('sw.js defines DZI_URL_PATTERN for DZI descriptor detection', () => {
    assert.ok(swSource.includes('DZI_URL_PATTERN'), 'Should define DZI_URL_PATTERN');
    assert.ok(swSource.includes('.dzi'), 'Pattern should match .dzi files');
});

test('sw.js has isTileRequest function', () => {
    assert.ok(swSource.includes('function isTileRequest'), 'Should have isTileRequest function');
});

test('sw.js has isDziRequest function', () => {
    assert.ok(swSource.includes('function isDziRequest'), 'Should have isDziRequest function');
});

test('sw.js has isStaticAsset function', () => {
    assert.ok(swSource.includes('function isStaticAsset'), 'Should have isStaticAsset function');
});

test('sw.js has cacheFirstStrategy function', () => {
    assert.ok(swSource.includes('function cacheFirstStrategy'), 'Should have cacheFirstStrategy function');
    assert.ok(swSource.includes('cache.match'), 'cacheFirstStrategy should check cache');
    assert.ok(swSource.includes('cache.put'), 'cacheFirstStrategy should store responses in cache');
});

test('sw.js has networkFirstStrategy function', () => {
    assert.ok(swSource.includes('function networkFirstStrategy'), 'Should have networkFirstStrategy function');
    assert.ok(swSource.includes('.catch'), 'networkFirstStrategy should handle network errors');
});

test('sw.js uses cache-first for tiles', () => {
    assert.ok(swSource.includes('isTileRequest(url)'), 'Should check if request is a tile');
    assert.ok(swSource.includes('cacheFirstStrategy(event.request, TILE_CACHE_NAME)'),
        'Should use cacheFirstStrategy for tiles');
});

test('sw.js uses cache-first for DZI descriptors', () => {
    assert.ok(swSource.includes('isDziRequest(url)'), 'Should check if request is a DZI descriptor');
});

test('sw.js uses network-first for static assets', () => {
    assert.ok(swSource.includes('isStaticAsset(url)'), 'Should check if request is a static asset');
    assert.ok(swSource.includes('networkFirstStrategy(event.request, STATIC_CACHE_NAME)'),
        'Should use networkFirstStrategy for static assets');
});

test('sw.js only handles GET requests', () => {
    assert.ok(swSource.includes("event.request.method !== 'GET'"), 'Should filter non-GET requests');
});

test('sw.js clones response before caching', () => {
    assert.ok(swSource.includes('networkResponse.clone()'), 'Should clone response before caching');
    assert.ok(swSource.includes('responseToCache'), 'Should use cloned response for cache');
});

test('sw.js only caches successful responses', () => {
    assert.ok(swSource.includes('networkResponse.ok'), 'Should check response.ok before caching');
});

test('sw.js provides offline fallback for static assets', () => {
    assert.ok(swSource.includes('503'), 'Should return 503 status when offline and no cache');
    assert.ok(swSource.includes('Service Unavailable'), 'Should indicate service unavailable');
});

// ========== URL pattern tests (verify regex patterns) ==========

// Extract and test the regex patterns from sw.js
const tilePatternMatch = swSource.match(/const TILE_URL_PATTERN\s*=\s*(\/.*?\/[a-z]*);/i);
const dziPatternMatch = swSource.match(/const DZI_URL_PATTERN\s*=\s*(\/.*?\/[a-z]*);/i);

test('TILE_URL_PATTERN matches typical DZI tile URLs', () => {
    assert.ok(tilePatternMatch, 'Should find TILE_URL_PATTERN in source');
    const pattern = eval(tilePatternMatch[1]); // Safe since we're reading our own source

    // Should match valid tile URLs
    assert.ok(pattern.test('https://cdn.example.com/mosaic_files/12/5_3.jpg'), 'Should match jpg tiles');
    assert.ok(pattern.test('https://cdn.example.com/mosaic_files/0/0_0.png'), 'Should match png tiles');
    assert.ok(pattern.test('https://cdn.example.com/mosaic_files/15/123_456.jpeg'), 'Should match jpeg tiles');
    assert.ok(pattern.test('https://r2.dev/test_files/8/10_20.webp'), 'Should match webp tiles');

    // Should not match non-tile URLs
    assert.ok(!pattern.test('https://cdn.example.com/viewer.js'), 'Should not match JS files');
    assert.ok(!pattern.test('https://cdn.example.com/mosaic.dzi'), 'Should not match DZI files');
    assert.ok(!pattern.test('https://cdn.example.com/image.jpg'), 'Should not match non-tile images');
});

test('DZI_URL_PATTERN matches DZI descriptor URLs', () => {
    assert.ok(dziPatternMatch, 'Should find DZI_URL_PATTERN in source');
    const pattern = eval(dziPatternMatch[1]);

    // Should match DZI files
    assert.ok(pattern.test('https://cdn.example.com/mosaic.dzi'), 'Should match .dzi files');
    assert.ok(pattern.test('https://r2.dev/test/image.DZI'), 'Should match .DZI (case insensitive)');

    // Should not match other files
    assert.ok(!pattern.test('https://cdn.example.com/viewer.js'), 'Should not match JS files');
    assert.ok(!pattern.test('https://cdn.example.com/tile.jpg'), 'Should not match images');
});

// ========== Cache management tests (Step 1.3) ==========

test('sw.js defines MAX_TILE_CACHE_ENTRIES constant', () => {
    assert.ok(swSource.includes('MAX_TILE_CACHE_ENTRIES'), 'Should define MAX_TILE_CACHE_ENTRIES');
    const match = swSource.match(/const MAX_TILE_CACHE_ENTRIES\s*=\s*(\d+)/);
    assert.ok(match, 'MAX_TILE_CACHE_ENTRIES should be a number');
    const limit = parseInt(match[1], 10);
    assert.ok(limit > 0 && limit <= 10000, `Limit should be reasonable (got ${limit})`);
});

test('sw.js defines CACHE_TRIM_BATCH_SIZE constant', () => {
    assert.ok(swSource.includes('CACHE_TRIM_BATCH_SIZE'), 'Should define CACHE_TRIM_BATCH_SIZE');
    const match = swSource.match(/const CACHE_TRIM_BATCH_SIZE\s*=\s*(\d+)/);
    assert.ok(match, 'CACHE_TRIM_BATCH_SIZE should be a number');
    const batchSize = parseInt(match[1], 10);
    assert.ok(batchSize > 0 && batchSize <= 1000, `Batch size should be reasonable (got ${batchSize})`);
});

test('sw.js has trimCacheIfNeeded function', () => {
    assert.ok(swSource.includes('function trimCacheIfNeeded'), 'Should have trimCacheIfNeeded function');
});

test('sw.js trimCacheIfNeeded opens cache and gets keys', () => {
    // Verify it accesses the cache properly
    assert.ok(swSource.includes('caches.open(cacheName)'), 'Should open the specified cache');
    assert.ok(swSource.includes('cache.keys()'), 'Should get cache keys');
});

test('sw.js trimCacheIfNeeded checks entry count before trimming', () => {
    assert.ok(swSource.includes('keys.length <= maxEntries'), 'Should check if within limit');
    assert.ok(swSource.includes('return;'), 'Should return early if no trimming needed');
});

test('sw.js trimCacheIfNeeded deletes oldest entries', () => {
    assert.ok(swSource.includes('keys.slice(0, toRemove)'), 'Should select oldest entries (first in array)');
    assert.ok(swSource.includes('cache.delete(key)'), 'Should delete entries');
});

test('sw.js trimCacheIfNeeded logs trimming activity', () => {
    assert.ok(swSource.includes('[evostitch SW] Trimming cache'), 'Should log when trimming starts');
    assert.ok(swSource.includes('[evostitch SW] Cache trimmed'), 'Should log when trimming completes');
});

test('sw.js cacheFirstStrategy calls trimCacheIfNeeded after caching', () => {
    // Verify trim is triggered after adding new entries (uses maxEntries parameter)
    assert.ok(swSource.includes('trimCacheIfNeeded(cacheName, maxEntries)'),
        'cacheFirstStrategy should trigger cache trimming');
});

test('sw.js cacheFirstStrategy implements LRU by moving accessed entries', () => {
    // Verify LRU behavior: delete then re-put to move to end
    assert.ok(swSource.includes('cache.delete(request)'), 'Should delete accessed entry');
    assert.ok(swSource.includes('cache.put(request, cachedResponse.clone())'),
        'Should re-add entry to move it to end of cache');
});

test('sw.js version was bumped for cache management release', () => {
    const versionMatch = swSource.match(/const SW_VERSION\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(versionMatch, 'Should have SW_VERSION');
    const version = versionMatch[1];
    // Version should be at least 1.2.0 for cache management
    const parts = version.split('.').map(Number);
    assert.ok(parts[0] >= 1 && (parts[0] > 1 || parts[1] >= 2),
        `Version should be >= 1.2.0 for cache management (got ${version})`);
});

test('sw.js clears old caches on activate', () => {
    // This was added in 1.1 but is part of cache management
    assert.ok(swSource.includes('caches.keys()'), 'Should enumerate caches on activate');
    assert.ok(swSource.includes("name.startsWith('evostitch-tiles-')"), 'Should identify tile caches');
    assert.ok(swSource.includes("name.startsWith('evostitch-static-')"), 'Should identify static caches');
    assert.ok(swSource.includes('caches.delete(name)'), 'Should delete old version caches');
});

// ========== W12 dual-domain tests ==========

test('sw.js defines R2_DOMAINS as an array', () => {
    assert.ok(swSource.includes('const R2_DOMAINS'), 'Should define R2_DOMAINS constant');
    assert.ok(swSource.includes('R2_DOMAINS = ['), 'R2_DOMAINS should be an array');
});

test('sw.js R2_DOMAINS contains old R2 public domain', () => {
    assert.ok(swSource.includes('pub-db7ffa4b7df04b76aaae379c13562977.r2.dev'),
        'Should include original R2 public domain');
});

test('sw.js R2_DOMAINS contains new custom domain', () => {
    assert.ok(swSource.includes('data.evostitch.net'),
        'Should include custom domain for HTTP/2');
});

test('sw.js isZarrChunkRequest checks R2_DOMAINS array', () => {
    assert.ok(swSource.includes('R2_DOMAINS.indexOf(parsed.hostname)'),
        'isZarrChunkRequest should check hostname against R2_DOMAINS array');
});

test('sw.js isZarrMetadataRequest checks R2_DOMAINS array', () => {
    // Both functions should use the same array-based domain check
    const metadataFnMatch = swSource.match(/function isZarrMetadataRequest[\s\S]*?^}/m);
    assert.ok(metadataFnMatch, 'Should have isZarrMetadataRequest function');
    assert.ok(metadataFnMatch[0].includes('R2_DOMAINS.indexOf'),
        'isZarrMetadataRequest should check hostname against R2_DOMAINS array');
});

test('sw.js no longer uses single R2_DOMAIN string', () => {
    // Ensure the old single-string constant is gone
    assert.ok(!swSource.match(/const R2_DOMAIN\s*=/),
        'Should not have old single R2_DOMAIN constant (use R2_DOMAINS array)');
});

test('sw.js version bumped for W12 dual-domain', () => {
    const versionMatch = swSource.match(/const SW_VERSION\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(versionMatch, 'Should have SW_VERSION');
    const version = versionMatch[1];
    const parts = version.split('.').map(Number);
    assert.ok(parts[0] >= 1 && (parts[0] > 1 || parts[1] >= 4),
        `Version should be >= 1.4.0 for W12 dual-domain (got ${version})`);
});

// Summary
console.log('\n---');
console.log(`Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
}
