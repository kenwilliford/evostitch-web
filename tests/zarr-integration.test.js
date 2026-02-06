#!/usr/bin/env node
// Integration smoke tests for zarr optimization modules
// Usage: node zarr-integration.test.js
//
// Verifies all three optimization modules (zarr-prefetch, zarr-render-opt,
// zarr-cache) can coexist, expose correct APIs, initialize without errors,
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
const cacheSrc = fs.readFileSync(path.join(jsDir, 'zarr-cache.js'), 'utf8');

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
        caches: {
            open: () => Promise.resolve({
                match: () => Promise.resolve(undefined),
                put: () => Promise.resolve(),
                delete: () => Promise.resolve(true),
                keys: () => Promise.resolve([])
            }),
            delete: () => Promise.resolve(true)
        },
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
        caches: env.caches,
        AbortController: env.AbortController,
        DOMException: env.DOMException,
        Response: env.Response,
        Promise: Promise
    });

    // Load all three modules in order (order should not matter for IIFEs)
    vm.runInContext(cacheSrc, sandbox);
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

test('all three source files exist', () => {
    assert.ok(fs.existsSync(path.join(jsDir, 'zarr-prefetch.js')), 'zarr-prefetch.js');
    assert.ok(fs.existsSync(path.join(jsDir, 'zarr-render-opt.js')), 'zarr-render-opt.js');
    assert.ok(fs.existsSync(path.join(jsDir, 'zarr-cache.js')), 'zarr-cache.js');
});

test('all three modules use IIFE pattern', () => {
    [prefetchSrc, renderOptSrc, cacheSrc].forEach(src => {
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

test('zarrCache is on namespace', () => {
    const { ns } = loadAllModules();
    assert.ok(ns.zarrCache, 'zarrCache should exist');
    assert.strictEqual(typeof ns.zarrCache, 'object', 'zarrCache should be an object');
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
        caches: env.caches,
        AbortController: env.AbortController,
        DOMException: env.DOMException,
        Response: env.Response,
        Promise: Promise
    });

    // Load in reverse order
    vm.runInContext(renderOptSrc, sandbox);
    vm.runInContext(prefetchSrc, sandbox);
    vm.runInContext(cacheSrc, sandbox);

    assert.ok(env.window.evostitch.zarrPrefetch, 'zarrPrefetch after reverse load');
    assert.ok(env.window.evostitch.zarrRenderOpt, 'zarrRenderOpt after reverse load');
    assert.ok(env.window.evostitch.zarrCache, 'zarrCache after reverse load');
});

test('modules do not overwrite each other', () => {
    const { ns } = loadAllModules();
    // Each module should have its own distinct API
    assert.ok(ns.zarrPrefetch.onZChange, 'prefetch has onZChange');
    assert.ok(ns.zarrRenderOpt.updateZ, 'renderOpt has updateZ');
    assert.ok(ns.zarrCache.fetchWithCache, 'cache has fetchWithCache');

    // Cross-check: APIs should NOT leak between modules
    assert.strictEqual(ns.zarrPrefetch.updateZ, undefined, 'prefetch should not have updateZ');
    assert.strictEqual(ns.zarrRenderOpt.onZChange, undefined, 'renderOpt should not have onZChange');
    assert.strictEqual(ns.zarrCache.updateZ, undefined, 'cache should not have updateZ');
});

// ========== API Surface Tests ==========

console.log('');
console.log('--- zarrPrefetch API ---');

const prefetchAPI = ['init', 'onZChange', 'getPrefetchState', 'warmPlane', 'getStats', 'setDebug', 'destroy'];

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

console.log('');
console.log('--- zarrCache API ---');

const cacheAPI = ['init', 'fetchWithCache', 'prefetchUrls', 'cancelPrefetch', 'getStats',
    'clearCache', 'setDebug', 'destroy'];

cacheAPI.forEach(fn => {
    test(`zarrCache.${fn} is a function`, () => {
        const { ns } = loadAllModules();
        assert.strictEqual(typeof ns.zarrCache[fn], 'function', `${fn} should be a function`);
    });
});

test('zarrCache.PRIORITY is exposed', () => {
    const { ns } = loadAllModules();
    assert.ok(ns.zarrCache.PRIORITY, 'PRIORITY should exist');
    assert.strictEqual(typeof ns.zarrCache.PRIORITY, 'object', 'PRIORITY should be an object');
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

test('zarrCache.init returns a Promise', () => {
    const { ns } = loadAllModules();
    const result = ns.zarrCache.init({ baseUrl: 'https://example.com' });
    assert.ok(result instanceof Promise, 'init should return a Promise');
});

test('all modules can be initialized in sequence without conflict', () => {
    const { ns } = loadAllModules();
    const mockDeck = { setProps: () => {} };
    const mockLoader = { data: [{ shape: [1, 1, 21, 1024, 1024], tileSize: 256, dtype: 'Uint16' }] };

    // Init cache first (returns Promise but we don't need to await for smoke test)
    ns.zarrCache.init({ baseUrl: 'https://example.com' });

    // Init prefetch
    const prefetchOk = ns.zarrPrefetch.init({
        baseUrl: 'https://example.com/data.zarr',
        zCount: 21
    });
    assert.strictEqual(prefetchOk, true, 'prefetch init OK');

    // Init renderOpt
    ns.zarrRenderOpt.init({ deck: mockDeck, loader: mockLoader, metadata: {} });

    // All should have stats after init
    assert.ok(ns.zarrPrefetch.getStats(), 'prefetch stats available');
    assert.ok(ns.zarrRenderOpt.getStats(), 'renderOpt stats available');
    assert.ok(ns.zarrCache.getStats(), 'cache stats available');
});

// ========== getStats consistency ==========

console.log('');
console.log('--- Stats Consistency ---');

test('all modules return stats objects', () => {
    const { ns } = loadAllModules();
    const prefetchStats = ns.zarrPrefetch.getStats();
    const renderOptStats = ns.zarrRenderOpt.getStats();
    const cacheStats = ns.zarrCache.getStats();

    assert.strictEqual(typeof prefetchStats, 'object', 'prefetch stats is object');
    assert.strictEqual(typeof renderOptStats, 'object', 'renderOpt stats is object');
    assert.strictEqual(typeof cacheStats, 'object', 'cache stats is object');
});

test('renderOpt stats have expected fields', () => {
    const { ns } = loadAllModules();
    const stats = ns.zarrRenderOpt.getStats();
    assert.ok('layerRecreations' in stats, 'has layerRecreations');
    assert.ok('zSwitchCount' in stats, 'has zSwitchCount');
    assert.ok('zSwitchAvgMs' in stats, 'has zSwitchAvgMs');
    assert.ok('maxZoom' in stats, 'has maxZoom');
});

// ========== setDebug consistency ==========

console.log('');
console.log('--- Debug Toggle ---');

test('all modules accept setDebug(true) without throwing', () => {
    const { ns } = loadAllModules();
    ns.zarrPrefetch.setDebug(true);
    ns.zarrRenderOpt.setDebug(true);
    ns.zarrCache.setDebug(true);
    // If we got here, none threw
});

test('all modules accept setDebug(false) without throwing', () => {
    const { ns } = loadAllModules();
    ns.zarrPrefetch.setDebug(false);
    ns.zarrRenderOpt.setDebug(false);
    ns.zarrCache.setDebug(false);
});

// ========== Destroy / Cleanup ==========

console.log('');
console.log('--- Destroy / Cleanup ---');

test('all modules can be destroyed without throwing', () => {
    const { ns } = loadAllModules();
    const mockDeck = { setProps: () => {} };
    const mockLoader = { data: [{ shape: [1, 1, 21, 1024, 1024], tileSize: 256, dtype: 'Uint16' }] };

    // Init all
    ns.zarrCache.init({ baseUrl: 'https://example.com' });
    ns.zarrPrefetch.init({ baseUrl: 'https://example.com/data.zarr', zCount: 21 });
    ns.zarrRenderOpt.init({ deck: mockDeck, loader: mockLoader, metadata: {} });

    // Destroy all (should not throw)
    ns.zarrRenderOpt.destroy();
    ns.zarrPrefetch.destroy();
    ns.zarrCache.destroy();
});

test('destroy is idempotent (calling twice does not throw)', () => {
    const { ns } = loadAllModules();
    ns.zarrRenderOpt.destroy();
    ns.zarrRenderOpt.destroy();
    ns.zarrPrefetch.destroy();
    ns.zarrPrefetch.destroy();
    ns.zarrCache.destroy();
    ns.zarrCache.destroy();
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

test('cache stats remain independent of renderOpt stats', () => {
    const { ns } = loadAllModules();
    const cacheStats = ns.zarrCache.getStats();
    const renderStats = ns.zarrRenderOpt.getStats();

    // Verify they're different objects with different keys
    assert.ok(!('layerRecreations' in cacheStats), 'cache stats should not have layerRecreations');
    assert.ok(!('fetchWithCache' in renderStats), 'render stats should not have fetch data');
});

// ========== Summary ==========

console.log('');
console.log('====================================================');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    process.exit(1);
}
