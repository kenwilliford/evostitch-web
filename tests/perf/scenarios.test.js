#!/usr/bin/env node
// Unit tests for scenarios.js and metrics-collector.js - runs with plain Node.js
// Usage: node scenarios.test.js

const assert = require('assert');
const scenarios = require('./scenarios');
const { createMetricsCollector } = require('./metrics-collector');

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

// Test exports exist
test('exports scenarioA function', () => {
    assert.strictEqual(typeof scenarios.scenarioA, 'function');
});

test('exports scenarioB function', () => {
    assert.strictEqual(typeof scenarios.scenarioB, 'function');
});

test('exports scenarioC function', () => {
    assert.strictEqual(typeof scenarios.scenarioC, 'function');
});

test('exports runScenario function', () => {
    assert.strictEqual(typeof scenarios.runScenario, 'function');
});

test('exports runAllScenarios function', () => {
    assert.strictEqual(typeof scenarios.runAllScenarios, 'function');
});

test('exports DEFAULT_PARAMS', () => {
    assert.strictEqual(typeof scenarios.DEFAULT_PARAMS, 'object');
    assert.strictEqual(typeof scenarios.DEFAULT_PARAMS.panDistance, 'number');
    assert.strictEqual(typeof scenarios.DEFAULT_PARAMS.panCount, 'number');
    assert.ok(Array.isArray(scenarios.DEFAULT_PARAMS.zoomLevels));
    assert.ok(Array.isArray(scenarios.DEFAULT_PARAMS.zSlideSequence));
});

// Test helper function exports
test('exports waitForViewer helper', () => {
    assert.strictEqual(typeof scenarios.waitForViewer, 'function');
});

test('exports waitForViewportComplete helper', () => {
    assert.strictEqual(typeof scenarios.waitForViewportComplete, 'function');
});

test('exports panViewer helper', () => {
    assert.strictEqual(typeof scenarios.panViewer, 'function');
});

test('exports zoomViewer helper', () => {
    assert.strictEqual(typeof scenarios.zoomViewer, 'function');
});

test('exports performZTransition helper', () => {
    assert.strictEqual(typeof scenarios.performZTransition, 'function');
});

// Step 0.2: Scenario-specific metrics helper exports
test('exports getCacheHits helper', () => {
    assert.strictEqual(typeof scenarios.getCacheHits, 'function');
});

test('exports getCacheHitStats helper', () => {
    assert.strictEqual(typeof scenarios.getCacheHitStats, 'function');
});

test('exports startOperation helper', () => {
    assert.strictEqual(typeof scenarios.startOperation, 'function');
});

test('exports completeOperation helper', () => {
    assert.strictEqual(typeof scenarios.completeOperation, 'function');
});

test('exports getScenarioMetrics helper', () => {
    assert.strictEqual(typeof scenarios.getScenarioMetrics, 'function');
});

test('exports getTileCount helper', () => {
    assert.strictEqual(typeof scenarios.getTileCount, 'function');
});

test('exports getTileLatencies helper', () => {
    assert.strictEqual(typeof scenarios.getTileLatencies, 'function');
});

test('exports getMetrics helper', () => {
    assert.strictEqual(typeof scenarios.getMetrics, 'function');
});

// Test DEFAULT_PARAMS values match spec
test('DEFAULT_PARAMS has correct Z-slide sequence for Scenario A', () => {
    // Plan specifies: +3, -2, +1, -1, +2
    const expected = [3, -2, 1, -1, 2];
    assert.deepStrictEqual(scenarios.DEFAULT_PARAMS.zSlideSequence, expected);
});

test('DEFAULT_PARAMS has correct zoom levels for Scenario A', () => {
    // Plan specifies: 2x, then 4x
    const expected = [2, 4];
    assert.deepStrictEqual(scenarios.DEFAULT_PARAMS.zoomLevels, expected);
});

test('DEFAULT_PARAMS panCount is 2-3 as specified in plan', () => {
    // Plan says "2-3 pan operations"
    assert.ok(
        scenarios.DEFAULT_PARAMS.panCount >= 2 && scenarios.DEFAULT_PARAMS.panCount <= 3,
        `panCount should be 2-3, got ${scenarios.DEFAULT_PARAMS.panCount}`
    );
});

// ========== Step 0.2: metrics-collector.js tests ==========

test('createMetricsCollector returns object with required methods', () => {
    const collector = createMetricsCollector();
    assert.strictEqual(typeof collector.attachToViewer, 'function');
    assert.strictEqual(typeof collector.checkViewportComplete, 'function');
    assert.strictEqual(typeof collector.forceViewportComplete, 'function');
    assert.strictEqual(typeof collector.getResults, 'function');
    assert.strictEqual(typeof collector.isViewportComplete, 'function');
});

test('createMetricsCollector has scenario-specific methods (Step 0.2)', () => {
    const collector = createMetricsCollector();
    assert.strictEqual(typeof collector.startZTransition, 'function');
    assert.strictEqual(typeof collector.completeZTransition, 'function');
    assert.strictEqual(typeof collector.startOperation, 'function');
    assert.strictEqual(typeof collector.completeOperation, 'function');
    assert.strictEqual(typeof collector.getCacheHitRate, 'function');
    assert.strictEqual(typeof collector.resetViewportComplete, 'function');
});

test('createMetricsCollector exposes CACHE_HIT_THRESHOLD_MS', () => {
    const collector = createMetricsCollector();
    assert.strictEqual(typeof collector.CACHE_HIT_THRESHOLD_MS, 'number');
    assert.strictEqual(collector.CACHE_HIT_THRESHOLD_MS, 50);
});

test('getResults returns initial state with scenario-specific fields', () => {
    const collector = createMetricsCollector();
    const results = collector.getResults();

    // Core fields
    assert.strictEqual(typeof results.timeToFirstTile, 'number');
    assert.strictEqual(typeof results.timeToViewportComplete, 'number');
    assert.strictEqual(typeof results.totalTilesLoaded, 'number');

    // Scenario-specific fields (Step 0.2)
    assert.strictEqual(typeof results.cacheHitRate, 'number');
    assert.ok(results.cacheStats !== undefined, 'cacheStats should be present');
    assert.ok(Array.isArray(results.zTransitions), 'zTransitions should be an array');
    assert.strictEqual(typeof results.zTransitionP50, 'number');
    assert.strictEqual(typeof results.zTransitionP95, 'number');
    assert.ok(Array.isArray(results.operations), 'operations should be an array');
});

test('getCacheHitRate returns correct structure', () => {
    const collector = createMetricsCollector();
    const cacheStats = collector.getCacheHitRate(0);

    assert.strictEqual(typeof cacheStats.total, 'number');
    assert.strictEqual(typeof cacheStats.cacheHits, 'number');
    assert.strictEqual(typeof cacheStats.networkLoads, 'number');
    assert.strictEqual(typeof cacheStats.hitRate, 'number');

    // Initially should be zero
    assert.strictEqual(cacheStats.total, 0);
    assert.strictEqual(cacheStats.hitRate, 0);
});

test('startZTransition tracks Z-plane transitions', () => {
    const collector = createMetricsCollector();

    // Start a Z transition
    const transition = collector.startZTransition(0, 5);

    assert.strictEqual(transition.fromZ, 0);
    assert.strictEqual(transition.toZ, 5);
    assert.strictEqual(typeof transition.startTime, 'number');
    assert.strictEqual(transition.endTime, null);
    assert.strictEqual(transition.durationMs, null);

    // Should be in the results
    const results = collector.getResults();
    assert.strictEqual(results.zTransitions.length, 1);
});

test('completeZTransition records duration', () => {
    const collector = createMetricsCollector();

    // Start and complete a transition
    collector.startZTransition(0, 5);
    const completed = collector.completeZTransition();

    assert.strictEqual(completed.fromZ, 0);
    assert.strictEqual(completed.toZ, 5);
    assert.strictEqual(typeof completed.durationMs, 'number');
    assert.ok(completed.durationMs >= 0, 'Duration should be non-negative');
});

test('startOperation and completeOperation track operation timing', () => {
    const collector = createMetricsCollector();

    // Start an operation
    const started = collector.startOperation('pan', { direction: 'right' });
    assert.strictEqual(started.type, 'pan');
    assert.deepStrictEqual(started.params, { direction: 'right' });
    assert.strictEqual(typeof started.startTime, 'number');

    // Complete it
    const completed = collector.completeOperation();
    assert.strictEqual(completed.type, 'pan');
    assert.strictEqual(typeof completed.durationMs, 'number');

    // Should be in results
    const results = collector.getResults();
    assert.strictEqual(results.operations.length, 1);
    assert.strictEqual(results.operations[0].type, 'pan');
});

test('completeOperation returns null when no operation pending', () => {
    const collector = createMetricsCollector();
    const result = collector.completeOperation();
    assert.strictEqual(result, null);
});

test('multiple Z-transitions tracked correctly', () => {
    const collector = createMetricsCollector();

    // Start and complete multiple transitions
    collector.startZTransition(0, 3);
    collector.completeZTransition();

    collector.startZTransition(3, 5);
    collector.completeZTransition();

    collector.startZTransition(5, 2);
    collector.completeZTransition();

    const results = collector.getResults();
    assert.strictEqual(results.zTransitions.length, 3);

    // Check Z values
    assert.strictEqual(results.zTransitions[0].fromZ, 0);
    assert.strictEqual(results.zTransitions[0].toZ, 3);
    assert.strictEqual(results.zTransitions[1].fromZ, 3);
    assert.strictEqual(results.zTransitions[1].toZ, 5);
    assert.strictEqual(results.zTransitions[2].fromZ, 5);
    assert.strictEqual(results.zTransitions[2].toZ, 2);
});

test('resetViewportComplete clears completion flag', () => {
    const collector = createMetricsCollector();

    // Force completion
    collector.forceViewportComplete();
    assert.strictEqual(collector.isViewportComplete(), true);

    // Reset
    collector.resetViewportComplete();
    assert.strictEqual(collector.isViewportComplete(), false);
});

// Summary
console.log('\n---');
console.log(`Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
}
