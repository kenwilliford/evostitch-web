#!/usr/bin/env node
// Unit tests for network-detect.js - runs with plain Node.js
// Usage: node network-detect.test.js
//
// Tests verify file structure and logic patterns.
// Full integration tests require browser environment with Navigator.connection.

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
const networkDetectPath = path.join(__dirname, '..', 'js', 'network-detect.js');
const networkDetectSource = fs.readFileSync(networkDetectPath, 'utf8');

// ========== File structure tests ==========

test('network-detect.js exists', () => {
    assert.ok(fs.existsSync(networkDetectPath), 'network-detect.js should exist in web/js/');
});

test('network-detect.js uses IIFE pattern', () => {
    assert.ok(networkDetectSource.includes('(function()'), 'Should use IIFE pattern');
    assert.ok(networkDetectSource.includes("'use strict'"), 'Should use strict mode');
    assert.ok(networkDetectSource.includes('})();'), 'Should close IIFE properly');
});

// ========== Network speed constants tests ==========

test('network-detect.js defines NETWORK_SPEED constants', () => {
    assert.ok(networkDetectSource.includes('const NETWORK_SPEED'), 'Should define NETWORK_SPEED object');
    assert.ok(networkDetectSource.includes('FAST:'), 'Should have FAST speed');
    assert.ok(networkDetectSource.includes('MEDIUM:'), 'Should have MEDIUM speed');
    assert.ok(networkDetectSource.includes('SLOW:'), 'Should have SLOW speed');
    assert.ok(networkDetectSource.includes('UNKNOWN:'), 'Should have UNKNOWN speed');
});

test('network-detect.js speed values are strings', () => {
    assert.ok(networkDetectSource.includes("FAST: 'fast'"), "FAST should be 'fast'");
    assert.ok(networkDetectSource.includes("MEDIUM: 'medium'"), "MEDIUM should be 'medium'");
    assert.ok(networkDetectSource.includes("SLOW: 'slow'"), "SLOW should be 'slow'");
    assert.ok(networkDetectSource.includes("UNKNOWN: 'unknown'"), "UNKNOWN should be 'unknown'");
});

// ========== Configuration tests ==========

test('network-detect.js defines CONFIG object', () => {
    assert.ok(networkDetectSource.includes('const CONFIG'), 'Should define CONFIG object');
    assert.ok(networkDetectSource.includes('connectionTypeMapping'), 'Should have connectionTypeMapping config');
    assert.ok(networkDetectSource.includes('downlinkThresholds'), 'Should have downlinkThresholds config');
    assert.ok(networkDetectSource.includes('tileLoadThresholds'), 'Should have tileLoadThresholds config');
    assert.ok(networkDetectSource.includes('minSamples'), 'Should have minSamples config');
});

test('network-detect.js connection type mapping is complete', () => {
    assert.ok(networkDetectSource.includes("'4g':"), 'Should map 4g');
    assert.ok(networkDetectSource.includes("'3g':"), 'Should map 3g');
    assert.ok(networkDetectSource.includes("'2g':"), 'Should map 2g');
    assert.ok(networkDetectSource.includes("'slow-2g':"), 'Should map slow-2g');
});

test('network-detect.js has reasonable threshold values', () => {
    // Extract threshold values
    const fastThresholdMatch = networkDetectSource.match(/tileLoadThresholds:\s*{[^}]*fast:\s*(\d+)/);
    const mediumThresholdMatch = networkDetectSource.match(/tileLoadThresholds:\s*{[^}]*medium:\s*(\d+)/);

    assert.ok(fastThresholdMatch, 'Should have fast tile load threshold');
    assert.ok(mediumThresholdMatch, 'Should have medium tile load threshold');

    const fast = parseInt(fastThresholdMatch[1], 10);
    const medium = parseInt(mediumThresholdMatch[1], 10);

    assert.ok(fast > 0 && fast <= 300, `fast threshold should be 1-300ms (got ${fast})`);
    assert.ok(medium > fast && medium <= 1000, `medium threshold should be > fast and <= 1000ms (got ${medium})`);
});

test('network-detect.js minSamples is reasonable', () => {
    const minSamplesMatch = networkDetectSource.match(/minSamples:\s*(\d+)/);
    assert.ok(minSamplesMatch, 'Should have minSamples value');

    const minSamples = parseInt(minSamplesMatch[1], 10);
    assert.ok(minSamples >= 3 && minSamples <= 20, `minSamples should be 3-20 (got ${minSamples})`);
});

// ========== Navigator.connection API tests ==========

test('network-detect.js checks for Navigator.connection API', () => {
    assert.ok(networkDetectSource.includes('navigator.connection'), 'Should check navigator.connection');
    assert.ok(networkDetectSource.includes('navigator.mozConnection'), 'Should check mozConnection fallback');
    assert.ok(networkDetectSource.includes('navigator.webkitConnection'), 'Should check webkitConnection fallback');
});

test('network-detect.js uses effectiveType when available', () => {
    assert.ok(networkDetectSource.includes('effectiveType'), 'Should use effectiveType');
    assert.ok(networkDetectSource.includes('connection.effectiveType'), 'Should access connection.effectiveType');
});

test('network-detect.js falls back to downlink speed', () => {
    assert.ok(networkDetectSource.includes('downlink'), 'Should use downlink');
    assert.ok(networkDetectSource.includes('connection.downlink'), 'Should access connection.downlink');
});

test('network-detect.js respects saveData flag', () => {
    assert.ok(networkDetectSource.includes('saveData'), 'Should check saveData');
    assert.ok(networkDetectSource.includes('connection.saveData'), 'Should access connection.saveData');
});

test('network-detect.js listens for connection changes', () => {
    assert.ok(networkDetectSource.includes("addEventListener('change'"), 'Should add change listener');
    assert.ok(networkDetectSource.includes('onConnectionChange'), 'Should have change handler');
});

// ========== Fallback detection tests ==========

test('network-detect.js implements tile load fallback', () => {
    assert.ok(networkDetectSource.includes('tileLoadSamples'), 'Should track tile load samples');
    assert.ok(networkDetectSource.includes('recordTileLoad'), 'Should have recordTileLoad function');
    assert.ok(networkDetectSource.includes('classifyFromTileLoads'), 'Should have classifyFromTileLoads function');
});

test('network-detect.js calculates average tile load time', () => {
    // Should calculate average from samples
    assert.ok(networkDetectSource.includes('total / tileLoadSamples.length'), 'Should calculate average');
});

test('network-detect.js expires old samples', () => {
    // Should filter out old samples (30 second window)
    assert.ok(networkDetectSource.includes('30000'), 'Should have 30 second sample window');
    assert.ok(networkDetectSource.includes('filter'), 'Should filter samples');
});

test('network-detect.js waits for minimum samples', () => {
    assert.ok(networkDetectSource.includes('CONFIG.minSamples'), 'Should check minimum samples');
    assert.ok(networkDetectSource.includes('tileLoadSamples.length >= CONFIG.minSamples') ||
              networkDetectSource.includes('tileLoadSamples.length < CONFIG.minSamples'),
              'Should compare sample count to minimum');
});

// ========== Public API tests ==========

test('network-detect.js exposes evostitch.networkDetect namespace', () => {
    assert.ok(networkDetectSource.includes('window.evostitch'), 'Should set window.evostitch');
    assert.ok(networkDetectSource.includes('evostitch.networkDetect'), 'Should set evostitch.networkDetect');
});

test('network-detect.js exposes init function', () => {
    assert.ok(networkDetectSource.includes('init: init'), 'Should expose init');
    assert.ok(networkDetectSource.includes('function init()'), 'Should define init function');
});

test('network-detect.js exposes getSpeed function', () => {
    assert.ok(networkDetectSource.includes('getSpeed: getSpeed'), 'Should expose getSpeed');
    assert.ok(networkDetectSource.includes('function getSpeed()'), 'Should define getSpeed function');
});

test('network-detect.js exposes convenience functions', () => {
    assert.ok(networkDetectSource.includes('isSlow: isSlow'), 'Should expose isSlow');
    assert.ok(networkDetectSource.includes('isFast: isFast'), 'Should expose isFast');
});

test('network-detect.js exposes change listener API', () => {
    assert.ok(networkDetectSource.includes('addChangeListener: addChangeListener'), 'Should expose addChangeListener');
    assert.ok(networkDetectSource.includes('function addChangeListener'), 'Should define addChangeListener');
});

test('network-detect.js exposes getInfo for diagnostics', () => {
    assert.ok(networkDetectSource.includes('getInfo: getInfo'), 'Should expose getInfo');
    assert.ok(networkDetectSource.includes('function getInfo()'), 'Should define getInfo function');
});

test('network-detect.js exposes recordTileLoad for fallback', () => {
    assert.ok(networkDetectSource.includes('recordTileLoad: recordTileLoad'), 'Should expose recordTileLoad');
});

test('network-detect.js exposes resetFallback', () => {
    assert.ok(networkDetectSource.includes('resetFallback: resetFallback'), 'Should expose resetFallback');
});

test('network-detect.js exposes destroy function', () => {
    assert.ok(networkDetectSource.includes('destroy: destroy'), 'Should expose destroy');
    assert.ok(networkDetectSource.includes('function destroy()'), 'Should define destroy function');
});

test('network-detect.js exposes setDebug function', () => {
    assert.ok(networkDetectSource.includes('setDebug:'), 'Should expose setDebug');
});

test('network-detect.js exposes NETWORK_SPEED and CONFIG for testing', () => {
    assert.ok(networkDetectSource.includes('NETWORK_SPEED: NETWORK_SPEED'), 'Should expose NETWORK_SPEED');
    assert.ok(networkDetectSource.includes('CONFIG: CONFIG'), 'Should expose CONFIG');
});

// ========== Listener notification tests ==========

test('network-detect.js notifies listeners on change', () => {
    assert.ok(networkDetectSource.includes('notifyListeners'), 'Should have notifyListeners function');
    assert.ok(networkDetectSource.includes('listeners.forEach'), 'Should iterate listeners');
});

test('network-detect.js provides unsubscribe function', () => {
    assert.ok(networkDetectSource.includes('unsubscribe'), 'Should return unsubscribe function');
    assert.ok(networkDetectSource.includes('splice'), 'Should remove listener on unsubscribe');
});

test('network-detect.js handles listener errors gracefully', () => {
    assert.ok(networkDetectSource.includes('try {') && networkDetectSource.includes('catch'), 'Should catch listener errors');
});

// ========== Cleanup tests ==========

test('network-detect.js removes event listener on destroy', () => {
    assert.ok(networkDetectSource.includes("removeEventListener('change'"), 'Should remove change listener');
});

test('network-detect.js clears state on destroy', () => {
    assert.ok(networkDetectSource.includes('listeners = []'), 'Should clear listeners');
    assert.ok(networkDetectSource.includes('tileLoadSamples = []'), 'Should clear samples');
    assert.ok(networkDetectSource.includes('currentSpeed = NETWORK_SPEED.UNKNOWN'), 'Should reset speed');
});

// ========== Classification logic tests ==========

test('network-detect.js classifies based on tile load thresholds', () => {
    // Check that classification uses thresholds correctly
    assert.ok(networkDetectSource.includes('CONFIG.tileLoadThresholds.fast'), 'Should check fast threshold');
    assert.ok(networkDetectSource.includes('CONFIG.tileLoadThresholds.medium'), 'Should check medium threshold');
});

test('network-detect.js classifies based on downlink thresholds', () => {
    assert.ok(networkDetectSource.includes('CONFIG.downlinkThresholds.fast'), 'Should check fast downlink');
    assert.ok(networkDetectSource.includes('CONFIG.downlinkThresholds.medium'), 'Should check medium downlink');
});

// ========== Edge case handling tests ==========

test('network-detect.js validates tile load input', () => {
    assert.ok(networkDetectSource.includes("typeof loadTimeMs !== 'number'"), 'Should validate loadTimeMs type');
    assert.ok(networkDetectSource.includes('loadTimeMs < 0'), 'Should validate loadTimeMs is positive');
});

test('network-detect.js skips fallback when connection API available', () => {
    assert.ok(networkDetectSource.includes('if (connectionApiSupported)'), 'Should check API support');
    assert.ok(networkDetectSource.match(/connectionApiSupported[^}]*return/), 'Should return early when API available');
});

// ========== Report ==========

console.log('\n---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

process.exit(failed > 0 ? 1 : 0);
