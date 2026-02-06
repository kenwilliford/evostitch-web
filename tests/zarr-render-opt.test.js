#!/usr/bin/env node
// Unit tests for zarr-render-opt.js - runs with plain Node.js
// Usage: node zarr-render-opt.test.js
//
// Tests verify file structure, IIFE patterns, and logic via simulated
// browser environment. Full integration requires browser with deck.gl.

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
        console.log(`        ${error.message}`);
        failed++;
    }
}

// Async test wrapper
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

// ---------- Read source for static analysis ----------

const srcPath = path.join(__dirname, '..', 'js', 'zarr-render-opt.js');
const source = fs.readFileSync(srcPath, 'utf8');

console.log('zarr-render-opt.js - Unit Tests');
console.log('================================');
console.log('');

// ========== File Structure Tests ==========

console.log('--- File Structure ---');

test('source file exists', () => {
    assert.ok(fs.existsSync(srcPath), 'zarr-render-opt.js should exist');
});

test('uses IIFE pattern', () => {
    assert.ok(source.includes('(function()'), 'Should use IIFE pattern');
    assert.ok(source.includes("'use strict'"), 'Should use strict mode');
    assert.ok(source.includes('})();'), 'Should close IIFE properly');
});

test('exposes public API on window.evostitch.zarrRenderOpt', () => {
    assert.ok(source.includes('window.evostitch = window.evostitch || {}'), 'Should initialize evostitch namespace');
    assert.ok(source.includes('window.evostitch.zarrRenderOpt'), 'Should expose zarrRenderOpt');
});

test('does not pollute global scope', () => {
    // Check that key variables are inside IIFE (not exported)
    const afterIIFEStart = source.indexOf('(function()');
    const beforeIIFEEnd = source.lastIndexOf('})();');
    const iifeBody = source.slice(afterIIFEStart, beforeIIFEEnd);

    assert.ok(iifeBody.includes('const CONFIG'), 'CONFIG should be inside IIFE');
    assert.ok(iifeBody.includes('let state'), 'state should be inside IIFE');
    assert.ok(iifeBody.includes('function log'), 'log should be inside IIFE');
});

// ========== API Surface Tests ==========

console.log('');
console.log('--- API Surface ---');

test('exports init function', () => {
    assert.ok(source.includes('init: init'), 'Should export init');
});

test('exports updateZ function', () => {
    assert.ok(source.includes('updateZ: updateZ'), 'Should export updateZ');
});

test('exports calculateMaxZoom function', () => {
    assert.ok(source.includes('calculateMaxZoom: calculateMaxZoom'), 'Should export calculateMaxZoom');
});

test('exports clampZoom function', () => {
    assert.ok(source.includes('clampZoom: clampZoom'), 'Should export clampZoom');
});

test('exports batchSetProps function', () => {
    assert.ok(source.includes('batchSetProps: batchSetProps'), 'Should export batchSetProps');
});

test('exports handleViewStateChange function', () => {
    assert.ok(source.includes('handleViewStateChange: handleViewStateChange'), 'Should export handleViewStateChange');
});

test('exports getStats function', () => {
    assert.ok(source.includes('getStats: getStats'), 'Should export getStats');
});

test('exports setDebug function', () => {
    assert.ok(source.includes('setDebug: setDebug'), 'Should export setDebug');
});

test('exports destroy function', () => {
    assert.ok(source.includes('destroy: destroy'), 'Should export destroy');
});

test('exports cancelPendingZ function', () => {
    assert.ok(source.includes('cancelPendingZ: cancelPendingZ'), 'Should export cancelPendingZ');
});

test('exports isZPending function', () => {
    assert.ok(source.includes('isZPending: isZPending'), 'Should export isZPending');
});

test('exports getMaxZoom function', () => {
    assert.ok(source.includes('getMaxZoom: getMaxZoom'), 'Should export getMaxZoom');
});

test('exports getDebounceMs function', () => {
    assert.ok(source.includes('getDebounceMs: getDebounceMs'), 'Should export getDebounceMs');
});

test('exports setDebounceMs function', () => {
    assert.ok(source.includes('setDebounceMs: setDebounceMs'), 'Should export setDebounceMs');
});

test('exports setMaxZoomOvershoot function', () => {
    assert.ok(source.includes('setMaxZoomOvershoot: setMaxZoomOvershoot'), 'Should export setMaxZoomOvershoot');
});

test('exports cancelBatch function', () => {
    assert.ok(source.includes('cancelBatch: cancelBatch'), 'Should export cancelBatch');
});

test('exports isInitialized function', () => {
    assert.ok(source.includes('isInitialized: isInitialized'), 'Should export isInitialized');
});

// ========== Configuration Tests ==========

console.log('');
console.log('--- Configuration ---');

test('defines CONFIG with zDebounceMs', () => {
    assert.ok(source.includes('zDebounceMs'), 'Should have zDebounceMs config');
    const match = source.match(/zDebounceMs:\s*(\d+)/);
    assert.ok(match, 'zDebounceMs should have a numeric value');
    const val = parseInt(match[1], 10);
    assert.ok(val >= 0 && val <= 500, 'zDebounceMs should be 0-500ms, got ' + val);
});

test('defines CONFIG with maxZoomOvershoot', () => {
    assert.ok(source.includes('maxZoomOvershoot'), 'Should have maxZoomOvershoot config');
    const match = source.match(/maxZoomOvershoot:\s*([\d.]+)/);
    assert.ok(match, 'maxZoomOvershoot should have a numeric value');
    const val = parseFloat(match[1]);
    assert.ok(val >= 0 && val <= 5, 'maxZoomOvershoot should be 0-5, got ' + val);
});

test('defines CONFIG with debug flag', () => {
    assert.ok(source.includes('debug: false'), 'Debug should default to false');
});

// ========== Debounce Logic Tests ==========

console.log('');
console.log('--- Z-Switch Debounce Logic ---');

test('updateZ uses setTimeout for debouncing', () => {
    assert.ok(source.includes('setTimeout'), 'Should use setTimeout for debounce');
    assert.ok(source.includes('clearTimeout'), 'Should clear previous timeout');
});

test('updateZ increments zSwitchCount on every call', () => {
    assert.ok(source.includes('state.stats.zSwitchCount++'), 'Should count every Z request');
});

test('updateZ increments zSwitchDebouncedCount on dropped intermediate values', () => {
    assert.ok(source.includes('state.stats.zSwitchDebouncedCount++'), 'Should count debounced drops');
});

test('updateZ tracks timing with performance.now()', () => {
    assert.ok(source.includes('performance.now()'), 'Should use performance.now for timing');
});

test('cancelPendingZ clears debounce timer', () => {
    // Verify cancel function clears all debounce state
    const cancelFn = source.match(/function cancelPendingZ\(\)[^}]*\{([^]*?)(?=\n    function|\n    \/\*)/);
    assert.ok(cancelFn, 'cancelPendingZ should be defined');
    const body = cancelFn[1];
    assert.ok(body.includes('clearTimeout'), 'Should clear timeout');
    assert.ok(body.includes('state.zDebounceTimer = null'), 'Should null out timer');
    assert.ok(body.includes('state.pendingZ = null'), 'Should null out pending Z');
});

// ========== Zoom Cap Logic Tests ==========

console.log('');
console.log('--- Zoom Cap Logic ---');

test('calculateMaxZoom sets maxZoom from native + overshoot', () => {
    assert.ok(source.includes('state.maxZoom = nativeZoom + CONFIG.maxZoomOvershoot'),
        'Should set maxZoom = nativeZoom + overshoot');
});

test('clampZoom enforces the max zoom', () => {
    // Verify the clamping logic exists in source
    assert.ok(source.includes('function clampZoom(zoom)'), 'clampZoom should be defined');
    assert.ok(source.includes('zoom > state.maxZoom'), 'Should check against maxZoom');
    assert.ok(source.includes('return state.maxZoom'), 'Should return maxZoom when exceeded');
});

test('handleViewStateChange applies zoom clamping', () => {
    assert.ok(source.includes('clampZoom(viewState.zoom)'), 'Should clamp zoom in view state handler');
});

// ========== RAF Batching Logic Tests ==========

console.log('');
console.log('--- RAF Batching ---');

test('batchSetProps uses requestAnimationFrame', () => {
    assert.ok(source.includes('requestAnimationFrame'), 'Should use requestAnimationFrame');
});

test('batchSetProps merges props with Object.assign', () => {
    assert.ok(source.includes('Object.assign(state.pendingProps, props)'), 'Should merge pending props');
});

test('batchSetProps calls deck.setProps in RAF callback', () => {
    assert.ok(source.includes('deck.setProps(merged)'), 'Should call deck.setProps with merged props');
});

test('cancelBatch uses cancelAnimationFrame', () => {
    assert.ok(source.includes('cancelAnimationFrame'), 'Should use cancelAnimationFrame');
});

test('batchSetProps tracks batched and dropped counts', () => {
    assert.ok(source.includes('batchedSetPropsCount++'), 'Should count batched calls');
    assert.ok(source.includes('droppedSetPropsCount++'), 'Should count dropped/merged calls');
});

// ========== Stats Tests ==========

console.log('');
console.log('--- Statistics ---');

test('getStats returns layerRecreations', () => {
    assert.ok(source.includes('layerRecreations: s.layerRecreations'), 'Should return layerRecreations');
});

test('getStats returns zSwitchAvgMs', () => {
    assert.ok(source.includes('zSwitchAvgMs: avgMs'), 'Should return zSwitchAvgMs');
});

test('getStats returns maxZoom info', () => {
    assert.ok(source.includes('maxZoom: state.maxZoom'), 'Should return maxZoom');
    assert.ok(source.includes('nativeZoom: state.nativeZoom'), 'Should return nativeZoom');
});

test('getStats returns isZPending', () => {
    assert.ok(source.includes('isZPending: isZPending()'), 'Should return pending state');
});

test('getStats calculates average ms correctly', () => {
    const calcLine = source.match(/zSwitchTotalMs \/ s\.layerRecreations/);
    assert.ok(calcLine, 'Should divide total ms by layer recreations for average');
});

// ========== Destroy / Cleanup Tests ==========

console.log('');
console.log('--- Cleanup ---');

test('destroy cancels pending Z and batch', () => {
    const destroyFn = source.match(/function destroy\(\)[^}]*\{([^]*?)(?=\n    \/\/|\n    window)/);
    assert.ok(destroyFn, 'destroy should be defined');
    const body = destroyFn[1];
    assert.ok(body.includes('cancelPendingZ()'), 'Should cancel pending Z');
    assert.ok(body.includes('cancelBatch()'), 'Should cancel RAF batch');
});

test('destroy nulls out references', () => {
    const destroyFn = source.match(/function destroy\(\)[^}]*\{([^]*?)(?=\n    \/\/|\n    window)/);
    assert.ok(destroyFn, 'destroy should be defined');
    const body = destroyFn[1];
    assert.ok(body.includes('state.deck = null'), 'Should null deck');
    assert.ok(body.includes('state.loader = null'), 'Should null loader');
    assert.ok(body.includes('state.metadata = null'), 'Should null metadata');
    assert.ok(body.includes('state.initialized = false'), 'Should set initialized to false');
});

// ========== Behavioral Tests (simulated browser env) ==========

console.log('');
console.log('--- Behavioral (Simulated) ---');

// Set up a minimal browser-like environment for behavioral testing
function createBrowserEnv() {
    const timers = [];
    let nextTimerId = 1;
    const rafCallbacks = [];
    let nextRafId = 1;

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
        console: { log: () => {}, error: () => {} },
        // Helpers for testing
        _timers: timers,
        _rafCallbacks: rafCallbacks,
        flushTimers: () => {
            timers.filter(t => !t.cleared).forEach(t => {
                t.cleared = true;
                t.fn();
            });
        },
        flushRAF: () => {
            rafCallbacks.filter(c => !c.cancelled).forEach(c => {
                c.cancelled = true;
                c.fn();
            });
        }
    };
    return env;
}

// Load the module in a sandboxed context
function loadModule() {
    const env = createBrowserEnv();
    const vm = require('vm');

    const sandbox = vm.createContext({
        window: env.window,
        setTimeout: env.setTimeout,
        clearTimeout: env.clearTimeout,
        requestAnimationFrame: env.requestAnimationFrame,
        cancelAnimationFrame: env.cancelAnimationFrame,
        performance: env.performance,
        console: env.console
    });

    vm.runInContext(source, sandbox);

    return { api: env.window.evostitch.zarrRenderOpt, env };
}

test('module loads without errors in simulated environment', () => {
    const { api } = loadModule();
    assert.ok(api, 'zarrRenderOpt should be defined');
    assert.ok(typeof api.init === 'function', 'init should be a function');
    assert.ok(typeof api.updateZ === 'function', 'updateZ should be a function');
    assert.ok(typeof api.getStats === 'function', 'getStats should be a function');
});

test('init accepts config object', () => {
    const { api } = loadModule();
    const mockDeck = { setProps: () => {} };
    const mockLoader = { data: [{ shape: [1, 1, 21, 1024, 1024], tileSize: 256, dtype: 'Uint16' }] };

    // Should not throw
    api.init({ deck: mockDeck, loader: mockLoader, metadata: {} });
});

test('getStats returns initial state before any operations', () => {
    const { api } = loadModule();
    const stats = api.getStats();

    assert.strictEqual(stats.layerRecreations, 0, 'No layer recreations initially');
    assert.strictEqual(stats.zSwitchCount, 0, 'No Z switches initially');
    assert.strictEqual(stats.zSwitchDebouncedCount, 0, 'No debounced drops initially');
    assert.strictEqual(stats.zSwitchAvgMs, null, 'No average ms initially');
    assert.strictEqual(stats.isZPending, false, 'No pending Z initially');
});

test('updateZ sets pending state', () => {
    const { api } = loadModule();
    api.updateZ(5, {}, () => {});
    assert.strictEqual(api.isZPending(), true, 'Should be pending after updateZ');
});

test('updateZ debounces multiple rapid calls', () => {
    const { api, env } = loadModule();
    let committedZ = null;
    const commit = (z) => { committedZ = z; };

    api.updateZ(1, {}, commit);
    api.updateZ(2, {}, commit);
    api.updateZ(3, {}, commit);

    // Before flush, nothing committed
    assert.strictEqual(committedZ, null, 'Should not commit before timeout');

    // Flush timers to simulate timeout expiry
    env.flushTimers();

    assert.strictEqual(committedZ, 3, 'Should commit final Z=3');

    const stats = api.getStats();
    assert.strictEqual(stats.zSwitchCount, 3, 'All 3 Z requests counted');
    assert.strictEqual(stats.zSwitchDebouncedCount, 2, '2 intermediate values debounced');
    assert.strictEqual(stats.layerRecreations, 1, 'Only 1 actual layer recreation');
});

test('cancelPendingZ prevents debounced Z from committing', () => {
    const { api, env } = loadModule();
    let committedZ = null;
    api.updateZ(10, {}, (z) => { committedZ = z; });

    assert.strictEqual(api.isZPending(), true, 'Should be pending');
    api.cancelPendingZ();
    assert.strictEqual(api.isZPending(), false, 'Should not be pending after cancel');

    env.flushTimers();
    assert.strictEqual(committedZ, null, 'Should not commit after cancel');
});

test('calculateMaxZoom returns reasonable value', () => {
    const { api } = loadModule();
    const loaderData = [
        { shape: [1, 1, 21, 1024, 1024] },
        { shape: [1, 1, 21, 512, 512] },
        { shape: [1, 1, 21, 256, 256] }
    ];
    const maxZoom = api.calculateMaxZoom({}, loaderData);
    assert.ok(typeof maxZoom === 'number', 'Should return a number');
    assert.ok(maxZoom > 0, 'Should be positive (native=0 + overshoot)');
    assert.ok(maxZoom <= 10, 'Should not be unreasonably large');
});

test('clampZoom enforces calculated max', () => {
    const { api } = loadModule();
    // Set up max zoom first
    api.calculateMaxZoom({}, [{ shape: [1, 1, 21, 1024, 1024] }]);
    const maxZoom = api.getMaxZoom();

    assert.strictEqual(api.clampZoom(maxZoom - 1), maxZoom - 1, 'Below max should pass through');
    assert.strictEqual(api.clampZoom(maxZoom + 5), maxZoom, 'Above max should clamp');
    assert.strictEqual(api.clampZoom(maxZoom), maxZoom, 'Exactly max should pass through');
});

test('batchSetProps merges and flushes in RAF', () => {
    const { api, env } = loadModule();
    const propsLog = [];
    const mockDeck = {
        setProps: (props) => { propsLog.push({...props}); }
    };

    api.batchSetProps(mockDeck, { viewState: { zoom: 1 } });
    api.batchSetProps(mockDeck, { layers: ['layerA'] });

    // Before RAF, nothing applied
    assert.strictEqual(propsLog.length, 0, 'No setProps before RAF');

    // Flush RAF
    env.flushRAF();

    assert.strictEqual(propsLog.length, 1, 'Single merged setProps after RAF');
    assert.deepStrictEqual(propsLog[0].viewState, { zoom: 1 }, 'viewState preserved');
    assert.deepStrictEqual(propsLog[0].layers, ['layerA'], 'layers preserved');

    const stats = api.getStats();
    assert.strictEqual(stats.batchedSetPropsCount, 2, '2 calls batched');
    assert.strictEqual(stats.droppedSetPropsCount, 1, '1 call merged into existing batch');
});

test('setDebounceMs updates debounce interval', () => {
    const { api } = loadModule();
    assert.strictEqual(api.getDebounceMs(), 50, 'Default debounce should be 50ms');
    api.setDebounceMs(150);
    assert.strictEqual(api.getDebounceMs(), 150, 'Should update to 150ms');
});

test('setDebounceMs rejects invalid values', () => {
    const { api } = loadModule();
    api.setDebounceMs(-1);
    assert.strictEqual(api.getDebounceMs(), 50, 'Should not accept negative values');
    api.setDebounceMs('abc');
    assert.strictEqual(api.getDebounceMs(), 50, 'Should not accept non-numbers');
});

test('setMaxZoomOvershoot updates zoom cap', () => {
    const { api } = loadModule();
    api.calculateMaxZoom({}, [{ shape: [1, 1, 21, 1024, 1024] }]);
    const original = api.getMaxZoom();

    api.setMaxZoomOvershoot(2.0);
    assert.strictEqual(api.getMaxZoom(), 2.0, 'Should update maxZoom to nativeZoom(0) + 2.0');
});

test('destroy cleans up all state', () => {
    const { api, env } = loadModule();
    const mockDeck = { setProps: () => {} };
    api.init({ deck: mockDeck });
    api.updateZ(5, {}, () => {});
    api.batchSetProps(mockDeck, { viewState: {} });

    api.destroy();

    assert.strictEqual(api.isZPending(), false, 'No pending Z after destroy');
    const stats = api.getStats();
    // Stats survive destroy for post-mortem inspection, but
    // the internal references should be cleaned up
});

test('handleViewStateChange returns clamped view state', () => {
    const { api, env } = loadModule();
    const propsLog = [];
    const mockDeck = { setProps: (p) => propsLog.push({...p}) };

    api.calculateMaxZoom({}, [{ shape: [1, 1, 21, 1024, 1024] }]);
    const maxZoom = api.getMaxZoom();

    const result = api.handleViewStateChange(mockDeck, {
        target: [100, 200, 0],
        zoom: maxZoom + 10
    });

    assert.strictEqual(result.zoom, maxZoom, 'Returned viewState should have clamped zoom');
    assert.deepStrictEqual(result.target, [100, 200, 0], 'Target should be preserved');

    // Flush RAF to verify the batched setProps
    env.flushRAF();
    assert.strictEqual(propsLog.length, 1, 'Should call setProps once');
    assert.strictEqual(propsLog[0].viewState.zoom, maxZoom, 'setProps should use clamped zoom');
});

// ========== Summary ==========

console.log('');
console.log('================================');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    process.exit(1);
}
