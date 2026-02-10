#!/usr/bin/env node
// Integration smoke tests for zarr optimization modules
// Usage: node zarr-integration.test.js
//
// Verifies optimization modules (zarr-prefetch, zarr-render-opt)
// can coexist, expose correct APIs, initialize without errors,
// and clean up properly. Runs in Node.js vm with simulated browser env.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (error) {
        console.log(`  FAIL  ${name}`);
        console.log(`        ${error.message}`);
        failed++;
    }
}

function testAsync(name, fn) {
    return fn().then(() => {
        console.log(`  PASS  ${name}`);
        passed++;
    }).catch((error) => {
        console.log(`  FAIL  ${name}`);
        console.log(`        ${error.message}`);
        failed++;
    });
}

// ---------- Read source files ----------

const jsDir = path.join(__dirname, '..', 'js');
const prefetchSrc = fs.readFileSync(path.join(jsDir, 'zarr-prefetch.js'), 'utf8');
const renderOptSrc = fs.readFileSync(path.join(jsDir, 'zarr-render-opt.js'), 'utf8');

// ---------- Simulated browser environment ----------

function createBrowserEnv() {
    const timers = [];
    let nextTimerId = 1;
    const rafCallbacks = [];
    let nextRafId = 1;
    const intervals = [];
    let nextIntervalId = 1;

    const env = {
        window: { evostitch: {} },
        setTimeout: (fn, ms) => {
            const id = nextTimerId++;
            timers.push({ id, fn, ms, cleared: false });
            return id;
        },
        clearTimeout: (id) => {
            const t = timers.find(t => t.id === id);
            if (t) t.cleared = true;
        },
        setInterval: (fn, ms) => {
            const id = nextIntervalId++;
            intervals.push({ id, fn, ms, cleared: false });
            return id;
        },
        clearInterval: (id) => {
            const iv = intervals.find(i => i.id === id);
            if (iv) iv.cleared = true;
        },
        requestAnimationFrame: (fn) => {
            const id = nextRafId++;
            rafCallbacks.push({ id, fn, cancelled: false });
            return id;
        },
        cancelAnimationFrame: (id) => {
            const cb = rafCallbacks.find(c => c.id === id);
            if (cb) cb.cancelled = true;
        },
        performance: { now: () => Date.now() },
        console: { log: () => {}, error: () => {}, warn: () => {} },
        fetch: () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
        AbortController: class {
            constructor() {
                this.signal = { aborted: false };
            }
            abort() { this.signal.aborted = true; }
        },
        DOMException: class DOMException extends Error {
            constructor(msg, name) { super(msg); this.name = name; }
        },
        Response: class {
            constructor(body) { this.body = body; }
        },
        Promise: Promise,
        // Helpers
        _timers: timers,
        _rafCallbacks: rafCallbacks,
        flushTimers: () => {
            timers.filter(t => !t.cleared).forEach(t => { t.cleared = true; t.fn(); });
        },
        flushRAF: () => {
            rafCallbacks.filter(c => !c.cancelled).forEach(c => { c.cancelled = true; c.fn(); });
        }
    };
    return env;
}

function loadAllModules() {
    const env = createBrowserEnv();
    const sandbox = vm.createContext({
        window: env.window,
        setTimeout: env.setTimeout,
        clearTimeout: env.clearTimeout,
        setInterval: env.setInterval,
        clearInterval: env.clearInterval,
        requestAnimationFrame: env.requestAnimationFrame,
        cancelAnimationFrame: env.cancelAnimationFrame,
        performance: env.performance,
        console: env.console,
        fetch: env.fetch,
        AbortController: env.AbortController,
        DOMException: env.DOMException,
        Response: env.Response,
        Promise: Promise
    });

    // Load modules in order (order should not matter for IIFEs)
    vm.runInContext(prefetchSrc, sandbox);
    vm.runInContext(renderOptSrc, sandbox);

    return {
        ns: env.window.evostitch,
        env
    };
}

// ==========================================================
console.log('zarr-integration.test.js - Integration Smoke Tests');
console.log('====================================================');
console.log('');

// ========== Module Loading Tests ==========

console.log('--- Module Loading ---');

test('source files exist', () => {
    assert.ok(fs.existsSync(path.join(jsDir, 'zarr-prefetch.js')), 'zarr-prefetch.js');
    assert.ok(fs.existsSync(path.join(jsDir, 'zarr-render-opt.js')), 'zarr-render-opt.js');
});

test('zarr-cache.js has been removed (W8)', () => {
    assert.ok(!fs.existsSync(path.join(jsDir, 'zarr-cache.js')), 'zarr-cache.js should not exist');
});

test('refinementStrategy: best-available set in zarr-viewer.js (W9)', () => {
    const viewerSrc = fs.readFileSync(path.join(jsDir, 'zarr-viewer.js'), 'utf8');
    assert.ok(
        viewerSrc.includes("refinementStrategy: 'best-available'"),
        'zarr-viewer.js should set refinementStrategy to best-available'
    );
});

test('Viv 0.19 MultiscaleImageLayer passes refinementStrategy to TileLayer (W9)', () => {
    const bundlePath = path.join(__dirname, '..', 'dist', 'zarr-viewer-bundle.js');
    assert.ok(fs.existsSync(bundlePath), 'bundle exists');
    const bundleSrc = fs.readFileSync(bundlePath, 'utf8');
    // Viv's MultiscaleImageLayer defaultProps declares refinementStrategy
    assert.ok(
        bundleSrc.includes('refinementStrategy: { type: "string", value: null, compare: true }'),
        'MultiscaleImageLayer declares refinementStrategy prop'
    );
    // Viv passes it through to MultiscaleImageLayerBase (TileLayer)
    assert.ok(
        bundleSrc.includes('refinementStrategy: refinementStrategy || (opacity === 1 ? "best-available" : "no-overlap")'),
        'Viv passes refinementStrategy through to TileLayer sublayer'
    );
    // TileLayer passes it to Tileset2D options
    assert.ok(
        bundleSrc.includes('refinementStrategy: STRATEGY_DEFAULT'),
        'TileLayer declares refinementStrategy in defaultProps'
    );
});

test('both modules use IIFE pattern', () => {
    [prefetchSrc, renderOptSrc].forEach(src => {
        assert.ok(src.includes('(function()'), 'IIFE open');
        assert.ok(src.includes("'use strict'"), 'strict mode');
        assert.ok(src.includes('})();'), 'IIFE close');
    });
});

test('all modules load into shared window.evostitch without errors', () => {
    const { ns } = loadAllModules();
    assert.ok(ns, 'evostitch namespace exists');
});

// ========== Namespace Isolation Tests ==========

console.log('');
console.log('--- Namespace Isolation ---');

test('zarrPrefetch is on namespace', () => {
    const { ns } = loadAllModules();
    assert.ok(ns.zarrPrefetch, 'zarrPrefetch should exist');
    assert.strictEqual(typeof ns.zarrPrefetch, 'object', 'zarrPrefetch should be an object');
});

test('zarrRenderOpt is on namespace', () => {
    const { ns } = loadAllModules();
    assert.ok(ns.zarrRenderOpt, 'zarrRenderOpt should exist');
    assert.strictEqual(typeof ns.zarrRenderOpt, 'object', 'zarrRenderOpt should be an object');
});

test('loading order does not matter (reverse order)', () => {
    const env = createBrowserEnv();
    const sandbox = vm.createContext({
        window: env.window,
        setTimeout: env.setTimeout,
        clearTimeout: env.clearTimeout,
        setInterval: env.setInterval,
        clearInterval: env.clearInterval,
        requestAnimationFrame: env.requestAnimationFrame,
        cancelAnimationFrame: env.cancelAnimationFrame,
        performance: env.performance,
        console: env.console,
        fetch: env.fetch,
        AbortController: env.AbortController,
        DOMException: env.DOMException,
        Response: env.Response,
        Promise: Promise
    });

    // Load in reverse order
    vm.runInContext(renderOptSrc, sandbox);
    vm.runInContext(prefetchSrc, sandbox);

    assert.ok(env.window.evostitch.zarrPrefetch, 'zarrPrefetch after reverse load');
    assert.ok(env.window.evostitch.zarrRenderOpt, 'zarrRenderOpt after reverse load');
});

test('modules do not overwrite each other', () => {
    const { ns } = loadAllModules();
    // Each module should have its own distinct API
    assert.ok(ns.zarrPrefetch.onZChange, 'prefetch has onZChange');
    assert.ok(ns.zarrRenderOpt.updateZ, 'renderOpt has updateZ');

    // Cross-check: APIs should NOT leak between modules
    assert.strictEqual(ns.zarrPrefetch.updateZ, undefined, 'prefetch should not have updateZ');
    assert.strictEqual(ns.zarrRenderOpt.onZChange, undefined, 'renderOpt should not have onZChange');
});

// ========== API Surface Tests ==========

console.log('');
console.log('--- zarrPrefetch API ---');

const prefetchAPI = ['init', 'onZChange', 'onViewportLoad', 'getPrefetchState', 'warmPlane', 'getStats', 'setDebug', 'destroy'];

prefetchAPI.forEach(fn => {
    test(`zarrPrefetch.${fn} is a function`, () => {
        const { ns } = loadAllModules();
        assert.strictEqual(typeof ns.zarrPrefetch[fn], 'function', `${fn} should be a function`);
    });
});

console.log('');
console.log('--- zarrRenderOpt API ---');

const renderOptAPI = ['init', 'isInitialized', 'updateZ', 'cancelPendingZ', 'isZPending', 'calculateMaxZoom',
    'clampZoom', 'getMaxZoom', 'setMaxZoomOvershoot', 'batchSetProps', 'cancelBatch',
    'handleViewStateChange', 'getStats', 'setDebug', 'getDebounceMs', 'setDebounceMs', 'destroy'];

renderOptAPI.forEach(fn => {
    test(`zarrRenderOpt.${fn} is a function`, () => {
        const { ns } = loadAllModules();
        assert.strictEqual(typeof ns.zarrRenderOpt[fn], 'function', `${fn} should be a function`);
    });
});

// ========== Init Tests ==========

console.log('');
console.log('--- Initialization ---');

test('zarrRenderOpt.init with mock config does not throw', () => {
    const { ns } = loadAllModules();
    const mockDeck = { setProps: () => {} };
    const mockLoader = { data: [{ shape: [1, 1, 21, 1024, 1024], tileSize: 256, dtype: 'Uint16' }] };
    ns.zarrRenderOpt.init({ deck: mockDeck, loader: mockLoader, metadata: {} });
});

test('zarrPrefetch.init with mock config returns true', () => {
    const { ns } = loadAllModules();
    const result = ns.zarrPrefetch.init({
        baseUrl: 'https://example.com/data.zarr',
        zCount: 21,
        currentZ: 0,
        axes: ['t', 'c', 'z', 'y', 'x']
    });
    assert.strictEqual(result, true, 'Should return true on valid config');
});

test('zarrPrefetch.init rejects missing zCount', () => {
    const { ns } = loadAllModules();
    const result = ns.zarrPrefetch.init({ zarrStoreUrl: 'https://example.com/data/' });
    assert.strictEqual(result, false, 'Should return false without zCount');
});

test('all modules can be initialized in sequence without conflict', () => {
    const { ns } = loadAllModules();
    const mockDeck = { setProps: () => {} };
    const mockLoader = { data: [{ shape: [1, 1, 21, 1024, 1024], tileSize: 256, dtype: 'Uint16' }] };

    // Init prefetch
    const prefetchOk = ns.zarrPrefetch.init({
        baseUrl: 'https://example.com/data.zarr',
        zCount: 21
    });
    assert.strictEqual(prefetchOk, true, 'prefetch init OK');

    // Init renderOpt
    ns.zarrRenderOpt.init({ deck: mockDeck, loader: mockLoader, metadata: {} });

    // Both should have stats after init
    assert.ok(ns.zarrPrefetch.getStats(), 'prefetch stats available');
    assert.ok(ns.zarrRenderOpt.getStats(), 'renderOpt stats available');
});

// ========== getStats consistency ==========

console.log('');
console.log('--- Stats Consistency ---');

test('all modules return stats objects', () => {
    const { ns } = loadAllModules();
    const prefetchStats = ns.zarrPrefetch.getStats();
    const renderOptStats = ns.zarrRenderOpt.getStats();

    assert.strictEqual(typeof prefetchStats, 'object', 'prefetch stats is object');
    assert.strictEqual(typeof renderOptStats, 'object', 'renderOpt stats is object');
});

test('renderOpt stats have expected fields', () => {
    const { ns } = loadAllModules();
    const stats = ns.zarrRenderOpt.getStats();
    assert.ok('layerRecreations' in stats, 'has layerRecreations');
    assert.ok('zSwitchCount' in stats, 'has zSwitchCount');
    assert.ok('zSwitchAvgMs' in stats, 'has zSwitchAvgMs');
    assert.ok('maxZoom' in stats, 'has maxZoom');
});

test('prefetch stats have monitoring metrics (W10 5.4)', () => {
    const { ns } = loadAllModules();
    const stats = ns.zarrPrefetch.getStats();
    assert.ok('lateFetchCount' in stats, 'has lateFetchCount');
    assert.ok('totalZSwitches' in stats, 'has totalZSwitches');
    assert.ok('prefetchedBytes' in stats, 'has prefetchedBytes');
    assert.ok('prefetchedBytesPerZSwitch' in stats, 'has prefetchedBytesPerZSwitch');
});

test('prefetchedBytesPerZSwitch is 0 before any Z-switches', () => {
    const { ns } = loadAllModules();
    const stats = ns.zarrPrefetch.getStats();
    assert.strictEqual(stats.prefetchedBytesPerZSwitch, 0, 'Should be 0 with no Z-switches');
    assert.strictEqual(stats.totalZSwitches, 0, 'totalZSwitches should be 0 initially');
});

// ========== setDebug consistency ==========

console.log('');
console.log('--- Debug Toggle ---');

test('all modules accept setDebug(true) without throwing', () => {
    const { ns } = loadAllModules();
    ns.zarrPrefetch.setDebug(true);
    ns.zarrRenderOpt.setDebug(true);
});

test('all modules accept setDebug(false) without throwing', () => {
    const { ns } = loadAllModules();
    ns.zarrPrefetch.setDebug(false);
    ns.zarrRenderOpt.setDebug(false);
});

// ========== Destroy / Cleanup ==========

console.log('');
console.log('--- Destroy / Cleanup ---');

test('all modules can be destroyed without throwing', () => {
    const { ns } = loadAllModules();
    const mockDeck = { setProps: () => {} };
    const mockLoader = { data: [{ shape: [1, 1, 21, 1024, 1024], tileSize: 256, dtype: 'Uint16' }] };

    // Init all
    ns.zarrPrefetch.init({ baseUrl: 'https://example.com/data.zarr', zCount: 21 });
    ns.zarrRenderOpt.init({ deck: mockDeck, loader: mockLoader, metadata: {} });

    // Destroy all (should not throw)
    ns.zarrRenderOpt.destroy();
    ns.zarrPrefetch.destroy();
});

test('destroy is idempotent (calling twice does not throw)', () => {
    const { ns } = loadAllModules();
    ns.zarrRenderOpt.destroy();
    ns.zarrRenderOpt.destroy();
    ns.zarrPrefetch.destroy();
    ns.zarrPrefetch.destroy();
});

test('renderOpt state is clean after destroy', () => {
    const { ns } = loadAllModules();
    const mockDeck = { setProps: () => {} };
    ns.zarrRenderOpt.init({ deck: mockDeck });

    // Use it
    ns.zarrRenderOpt.updateZ(5, {}, () => {});
    assert.strictEqual(ns.zarrRenderOpt.isZPending(), true, 'Pending before destroy');

    ns.zarrRenderOpt.destroy();
    assert.strictEqual(ns.zarrRenderOpt.isZPending(), false, 'Not pending after destroy');
});

// ========== Cross-module Interaction ==========

console.log('');
console.log('--- Cross-module Interaction ---');

test('renderOpt debounce + prefetch can be used in sequence', () => {
    const { ns, env } = loadAllModules();
    const mockDeck = { setProps: () => {} };
    const mockLoader = { data: [{ shape: [1, 1, 21, 1024, 1024], tileSize: 256, dtype: 'Uint16' }] };

    ns.zarrRenderOpt.init({ deck: mockDeck, loader: mockLoader, metadata: {} });
    ns.zarrPrefetch.init({ baseUrl: 'https://example.com/data.zarr', zCount: 21 });

    let committedZ = null;
    // Simulate: rapid Z-scrolling triggers debounced updateZ, then on commit
    // the prefetch engine is notified
    ns.zarrRenderOpt.updateZ(3, {}, function(z) {
        committedZ = z;
        ns.zarrPrefetch.onZChange(z);
    });
    ns.zarrRenderOpt.updateZ(5, {}, function(z) {
        committedZ = z;
        ns.zarrPrefetch.onZChange(z);
    });

    env.flushTimers();
    assert.strictEqual(committedZ, 5, 'Debounce committed final Z=5');

    // Prefetch should have been notified (getPrefetchState should reflect)
    const prefState = ns.zarrPrefetch.getPrefetchState();
    assert.ok(prefState, 'Prefetch state accessible after onZChange');
});

// ========== W10: Viewport filtering ==========

console.log('');
console.log('--- W10: Viewport Filtering ---');

test('zarrPrefetch.init accepts getViewState and getContainerSize callbacks', () => {
    const { ns } = loadAllModules();
    const result = ns.zarrPrefetch.init({
        zarrStoreUrl: 'https://example.com/data.zarr',
        zCount: 21,
        axes: ['t', 'c', 'z', 'y', 'x'],
        getViewState: function() { return { target: [512, 512, 0], zoom: -2 }; },
        getContainerSize: function() { return { width: 1920, height: 1080 }; }
    });
    assert.strictEqual(result, true, 'Should accept viewport callbacks');
});

test('zarr-prefetch.js getChunkUrlsForZ accepts tileRange parameter (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'zarr-prefetch.js'), 'utf8');
    const fnDef = src.substring(src.indexOf('function getChunkUrlsForZ'), src.indexOf('function getViewportTileRange'));
    assert.ok(fnDef.includes('tileRange'), 'getChunkUrlsForZ should accept tileRange');
    assert.ok(fnDef.includes('tileRange.minTileX'), 'Should use minTileX from tileRange');
    assert.ok(fnDef.includes('tileRange.maxTileX'), 'Should use maxTileX from tileRange');
});

test('zarr-prefetch.js has getViewportTileRange with 2-tile margin (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'zarr-prefetch.js'), 'utf8');
    const fnDef = src.substring(src.indexOf('function getViewportTileRange'), src.indexOf('function onZChange'));
    assert.ok(fnDef.includes('boundsToTileRange'), 'Should use boundsToTileRange');
    assert.ok(fnDef.includes(', 2)'), 'Should use 2-tile margin');
    assert.ok(fnDef.includes('return null'), 'Should return null when viewport unavailable');
});

test('zarr-viewer.js passes viewport callbacks to prefetch init (source check)', () => {
    const viewerSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'zarr-viewer.js'), 'utf8');
    // Find the prefetch init block
    const initBlock = viewerSrc.substring(
        viewerSrc.indexOf('zarrPrefetch.init('),
        viewerSrc.indexOf('Zarr prefetch module initialized')
    );
    assert.ok(initBlock.includes('getViewState:'), 'Should pass getViewState to prefetch init');
    assert.ok(initBlock.includes('getContainerSize:'), 'Should pass getContainerSize to prefetch init');
});

// ========== Summary ==========

console.log('');
console.log('====================================================');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    process.exit(1);
}
