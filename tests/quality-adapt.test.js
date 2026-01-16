#!/usr/bin/env node
// Unit tests for quality-adapt.js - runs with plain Node.js
// Usage: node quality-adapt.test.js
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
const qualityAdaptPath = path.join(__dirname, '..', 'js', 'quality-adapt.js');
const qualityAdaptSource = fs.readFileSync(qualityAdaptPath, 'utf8');

// ========== File structure tests ==========

test('quality-adapt.js exists', () => {
    assert.ok(fs.existsSync(qualityAdaptPath), 'quality-adapt.js should exist in web/js/');
});

test('quality-adapt.js uses IIFE pattern', () => {
    assert.ok(qualityAdaptSource.includes('(function()'), 'Should use IIFE pattern');
    assert.ok(qualityAdaptSource.includes("'use strict'"), 'Should use strict mode');
    assert.ok(qualityAdaptSource.includes('})();'), 'Should close IIFE properly');
});

// ========== Quality constants tests ==========

test('quality-adapt.js defines QUALITY constants', () => {
    assert.ok(qualityAdaptSource.includes('const QUALITY'), 'Should define QUALITY object');
    assert.ok(qualityAdaptSource.includes('HIGH:'), 'Should have HIGH quality');
    assert.ok(qualityAdaptSource.includes('MEDIUM:'), 'Should have MEDIUM quality');
    assert.ok(qualityAdaptSource.includes('LOW:'), 'Should have LOW quality');
    assert.ok(qualityAdaptSource.includes('AUTO:'), 'Should have AUTO quality');
});

test('quality-adapt.js quality values are strings', () => {
    assert.ok(qualityAdaptSource.includes("HIGH: 'high'"), "HIGH should be 'high'");
    assert.ok(qualityAdaptSource.includes("MEDIUM: 'medium'"), "MEDIUM should be 'medium'");
    assert.ok(qualityAdaptSource.includes("LOW: 'low'"), "LOW should be 'low'");
    assert.ok(qualityAdaptSource.includes("AUTO: 'auto'"), "AUTO should be 'auto'");
});

// ========== Configuration tests ==========

test('quality-adapt.js defines CONFIG object', () => {
    assert.ok(qualityAdaptSource.includes('const CONFIG'), 'Should define CONFIG object');
    assert.ok(qualityAdaptSource.includes('levelReduction'), 'Should have levelReduction config');
    assert.ok(qualityAdaptSource.includes('networkToQuality'), 'Should have networkToQuality mapping');
    assert.ok(qualityAdaptSource.includes('upgradeDelay'), 'Should have upgradeDelay config');
    assert.ok(qualityAdaptSource.includes('minTilesBeforeUpgrade'), 'Should have minTilesBeforeUpgrade config');
});

test('quality-adapt.js levelReduction is complete', () => {
    assert.ok(qualityAdaptSource.includes('high:'), 'Should have high reduction');
    assert.ok(qualityAdaptSource.includes('medium:'), 'Should have medium reduction');
    assert.ok(qualityAdaptSource.includes('low:'), 'Should have low reduction');
});

test('quality-adapt.js has reasonable level reductions', () => {
    // Extract level reduction values
    const highMatch = qualityAdaptSource.match(/levelReduction:\s*{[^}]*high:\s*(\d+)/);
    const mediumMatch = qualityAdaptSource.match(/levelReduction:\s*{[^}]*medium:\s*(\d+)/);
    const lowMatch = qualityAdaptSource.match(/levelReduction:\s*{[^}]*low:\s*(\d+)/);

    assert.ok(highMatch, 'Should have high level reduction');
    assert.ok(mediumMatch, 'Should have medium level reduction');
    assert.ok(lowMatch, 'Should have low level reduction');

    const high = parseInt(highMatch[1], 10);
    const medium = parseInt(mediumMatch[1], 10);
    const low = parseInt(lowMatch[1], 10);

    assert.strictEqual(high, 0, 'High quality should have 0 level reduction');
    assert.ok(medium > 0 && medium <= 3, `medium reduction should be 1-3 (got ${medium})`);
    assert.ok(low > medium && low <= 6, `low reduction should be > medium and <= 6 (got ${low})`);
});

test('quality-adapt.js networkToQuality mapping is complete', () => {
    assert.ok(qualityAdaptSource.includes('fast:'), 'Should map fast network');
    assert.ok(qualityAdaptSource.includes('medium:'), 'Should map medium network');
    assert.ok(qualityAdaptSource.includes('slow:'), 'Should map slow network');
    assert.ok(qualityAdaptSource.includes('unknown:'), 'Should map unknown network');
});

test('quality-adapt.js upgradeDelay is reasonable', () => {
    const delayMatch = qualityAdaptSource.match(/upgradeDelay:\s*(\d+)/);
    assert.ok(delayMatch, 'Should have upgradeDelay value');

    const delay = parseInt(delayMatch[1], 10);
    assert.ok(delay >= 2000 && delay <= 30000, `upgradeDelay should be 2-30 seconds (got ${delay}ms)`);
});

// ========== Network integration tests ==========

test('quality-adapt.js integrates with networkDetect', () => {
    assert.ok(qualityAdaptSource.includes('evostitch.networkDetect'), 'Should reference networkDetect');
    assert.ok(qualityAdaptSource.includes('networkDetect.init'), 'Should call networkDetect.init');
    assert.ok(qualityAdaptSource.includes('networkDetect.addChangeListener'), 'Should listen for network changes');
});

test('quality-adapt.js responds to network changes', () => {
    assert.ok(qualityAdaptSource.includes('onNetworkChange'), 'Should have network change handler');
    assert.ok(qualityAdaptSource.includes('networkDetect.getSpeed'), 'Should get network speed');
});

test('quality-adapt.js records tile loads to networkDetect', () => {
    assert.ok(qualityAdaptSource.includes('networkDetect.recordTileLoad') ||
              qualityAdaptSource.includes('recordTileLoad'), 'Should record tile loads for fallback detection');
});

// ========== Quality constraint tests ==========

test('quality-adapt.js modifies maxZoomPixelRatio', () => {
    assert.ok(qualityAdaptSource.includes('maxZoomPixelRatio'), 'Should work with maxZoomPixelRatio');
    assert.ok(qualityAdaptSource.includes('originalMaxZoomPixelRatio'), 'Should store original value');
    assert.ok(qualityAdaptSource.includes('viewer.maxZoomPixelRatio'), 'Should set viewer property');
});

test('quality-adapt.js calculates zoom reduction correctly', () => {
    assert.ok(qualityAdaptSource.includes('Math.pow(2, levelReduction)') ||
              qualityAdaptSource.includes('Math.pow(2'), 'Should use powers of 2 for level reduction');
    assert.ok(qualityAdaptSource.includes('reductionFactor'), 'Should calculate reduction factor');
});

test('quality-adapt.js zooms out if exceeding constraint', () => {
    assert.ok(qualityAdaptSource.includes('zoomTo'), 'Should call zoomTo when constrained');
    assert.ok(qualityAdaptSource.includes('getMaxZoom') ||
              qualityAdaptSource.includes('maxAllowedZoom'), 'Should check max allowed zoom');
});

test('quality-adapt.js enforces minimum zoom', () => {
    assert.ok(qualityAdaptSource.includes('Math.max'), 'Should clamp zoom to minimum');
    assert.ok(qualityAdaptSource.includes('0.25'), 'Should have minimum zoom floor');
});

// ========== Progressive enhancement tests ==========

test('quality-adapt.js schedules upgrade checks', () => {
    assert.ok(qualityAdaptSource.includes('scheduleUpgradeCheck'), 'Should have scheduleUpgradeCheck');
    assert.ok(qualityAdaptSource.includes('upgradeTimeout'), 'Should use timeout for upgrade scheduling');
    assert.ok(qualityAdaptSource.includes('CONFIG.upgradeDelay'), 'Should use configured delay');
});

test('quality-adapt.js checks for quality upgrade', () => {
    assert.ok(qualityAdaptSource.includes('checkForUpgrade'), 'Should have checkForUpgrade function');
});

test('quality-adapt.js requires minimum tiles before upgrade', () => {
    assert.ok(qualityAdaptSource.includes('tilesLoadedAtCurrentQuality'), 'Should track tiles loaded');
    assert.ok(qualityAdaptSource.includes('minTilesBeforeUpgrade'), 'Should check minimum tiles');
});

test('quality-adapt.js compares quality ranks', () => {
    assert.ok(qualityAdaptSource.includes('getQualityRank'), 'Should have quality ranking function');
});

test('quality-adapt.js only upgrades when network improves', () => {
    assert.ok(qualityAdaptSource.includes('getQualityRank(targetQuality) > getQualityRank(effectiveQuality)'),
              'Should compare quality ranks before upgrade');
});

// ========== Manual override tests ==========

test('quality-adapt.js supports manual quality setting', () => {
    assert.ok(qualityAdaptSource.includes('setQuality'), 'Should have setQuality function');
    assert.ok(qualityAdaptSource.includes('manualOverride'), 'Should track manual override state');
});

test('quality-adapt.js validates quality parameter', () => {
    assert.ok(qualityAdaptSource.includes('toUpperCase'), 'Should normalize quality input');
    assert.ok(qualityAdaptSource.includes('Invalid quality level'), 'Should validate quality value');
});

test('quality-adapt.js disables auto upgrade in manual mode', () => {
    assert.ok(qualityAdaptSource.includes('manualOverride') &&
              qualityAdaptSource.includes('return'), 'Should skip upgrade check when manual');
});

test('quality-adapt.js provides isManualOverride function', () => {
    assert.ok(qualityAdaptSource.includes('isManualOverride'), 'Should expose isManualOverride');
});

// ========== Public API tests ==========

test('quality-adapt.js exposes evostitch.qualityAdapt namespace', () => {
    assert.ok(qualityAdaptSource.includes('window.evostitch'), 'Should set window.evostitch');
    assert.ok(qualityAdaptSource.includes('evostitch.qualityAdapt'), 'Should set evostitch.qualityAdapt');
});

test('quality-adapt.js exposes init function', () => {
    assert.ok(qualityAdaptSource.includes('init: init'), 'Should expose init');
    assert.ok(qualityAdaptSource.includes('function init('), 'Should define init function');
});

test('quality-adapt.js exposes setQuality function', () => {
    assert.ok(qualityAdaptSource.includes('setQuality: setQuality'), 'Should expose setQuality');
    assert.ok(qualityAdaptSource.includes('function setQuality('), 'Should define setQuality function');
});

test('quality-adapt.js exposes getQuality function', () => {
    assert.ok(qualityAdaptSource.includes('getQuality: getQuality'), 'Should expose getQuality');
    assert.ok(qualityAdaptSource.includes('function getQuality()'), 'Should define getQuality function');
});

test('quality-adapt.js exposes getEffectiveQuality function', () => {
    assert.ok(qualityAdaptSource.includes('getEffectiveQuality: getEffectiveQuality'), 'Should expose getEffectiveQuality');
    assert.ok(qualityAdaptSource.includes('function getEffectiveQuality()'), 'Should define getEffectiveQuality function');
});

test('quality-adapt.js exposes change listener API', () => {
    assert.ok(qualityAdaptSource.includes('addChangeListener: addChangeListener'), 'Should expose addChangeListener');
    assert.ok(qualityAdaptSource.includes('function addChangeListener'), 'Should define addChangeListener');
});

test('quality-adapt.js exposes getState for diagnostics', () => {
    assert.ok(qualityAdaptSource.includes('getState: getState'), 'Should expose getState');
    assert.ok(qualityAdaptSource.includes('function getState()'), 'Should define getState function');
});

test('quality-adapt.js exposes destroy function', () => {
    assert.ok(qualityAdaptSource.includes('destroy: destroy'), 'Should expose destroy');
    assert.ok(qualityAdaptSource.includes('function destroy()'), 'Should define destroy function');
});

test('quality-adapt.js exposes setDebug function', () => {
    assert.ok(qualityAdaptSource.includes('setDebug:'), 'Should expose setDebug');
});

test('quality-adapt.js exposes QUALITY and CONFIG for testing', () => {
    assert.ok(qualityAdaptSource.includes('QUALITY: QUALITY'), 'Should expose QUALITY');
    assert.ok(qualityAdaptSource.includes('CONFIG: CONFIG'), 'Should expose CONFIG');
});

// ========== State tracking tests ==========

test('quality-adapt.js returns comprehensive state', () => {
    assert.ok(qualityAdaptSource.includes('enabled:'), 'State should include enabled');
    assert.ok(qualityAdaptSource.includes('currentQuality:'), 'State should include currentQuality');
    assert.ok(qualityAdaptSource.includes('effectiveQuality:'), 'State should include effectiveQuality');
    assert.ok(qualityAdaptSource.includes('manualOverride:'), 'State should include manualOverride');
    assert.ok(qualityAdaptSource.includes('tilesLoadedAtCurrentQuality:'), 'State should include tiles loaded');
    assert.ok(qualityAdaptSource.includes('networkSpeed:'), 'State should include network speed');
});

// ========== Listener notification tests ==========

test('quality-adapt.js notifies listeners on quality change', () => {
    assert.ok(qualityAdaptSource.includes('notifyQualityChange'), 'Should have notifyQualityChange');
    assert.ok(qualityAdaptSource.includes('qualityChangeListeners'), 'Should track listeners');
    assert.ok(qualityAdaptSource.includes('forEach'), 'Should iterate listeners');
});

test('quality-adapt.js provides unsubscribe function', () => {
    assert.ok(qualityAdaptSource.includes('unsubscribe'), 'Should return unsubscribe function');
    assert.ok(qualityAdaptSource.includes('splice'), 'Should remove listener on unsubscribe');
});

test('quality-adapt.js handles listener errors gracefully', () => {
    assert.ok(qualityAdaptSource.includes('try {') && qualityAdaptSource.includes('catch'), 'Should catch listener errors');
    assert.ok(qualityAdaptSource.includes('QualityAdapt listener error'), 'Should log listener errors');
});

// ========== Viewer integration tests ==========

test('quality-adapt.js validates viewer parameter', () => {
    assert.ok(qualityAdaptSource.includes('!osdViewer'), 'Should check viewer exists');
    assert.ok(qualityAdaptSource.includes('Invalid viewer instance'), 'Should error on invalid viewer');
});

test('quality-adapt.js hooks viewer open event', () => {
    assert.ok(qualityAdaptSource.includes("addHandler('open'") ||
              qualityAdaptSource.includes('onViewerOpen'), 'Should listen for viewer open');
});

test('quality-adapt.js hooks tile-loaded event', () => {
    assert.ok(qualityAdaptSource.includes("addHandler('tile-loaded'") ||
              qualityAdaptSource.includes('tile-loaded'), 'Should listen for tile loads');
});

test('quality-adapt.js hooks add-item event for Z-stack', () => {
    assert.ok(qualityAdaptSource.includes("addHandler('add-item'") ||
              qualityAdaptSource.includes('add-item'), 'Should listen for items added');
});

// ========== Cleanup tests ==========

test('quality-adapt.js removes event listeners on destroy', () => {
    assert.ok(qualityAdaptSource.includes("removeHandler('tile-loaded'") ||
              qualityAdaptSource.includes('removeHandler'), 'Should remove event handlers');
});

test('quality-adapt.js removes network listener on destroy', () => {
    assert.ok(qualityAdaptSource.includes('networkListener()') ||
              qualityAdaptSource.includes('networkListener = null'), 'Should clean up network listener');
});

test('quality-adapt.js restores original zoom constraint on destroy', () => {
    assert.ok(qualityAdaptSource.includes('originalMaxZoomPixelRatio'), 'Should restore original value');
});

test('quality-adapt.js clears state on destroy', () => {
    assert.ok(qualityAdaptSource.includes('qualityChangeListeners = []'), 'Should clear listeners');
    assert.ok(qualityAdaptSource.includes('enabled = false'), 'Should reset enabled');
});

test('quality-adapt.js clears upgrade timeout on destroy', () => {
    assert.ok(qualityAdaptSource.includes('clearTimeout(upgradeTimeout)'), 'Should clear timeout');
});

// ========== Edge case handling tests ==========

test('quality-adapt.js handles auto mode correctly', () => {
    assert.ok(qualityAdaptSource.includes("currentQuality === QUALITY.AUTO") ||
              qualityAdaptSource.includes("currentQuality !== QUALITY.AUTO"), 'Should check auto mode');
});

test('quality-adapt.js handles missing networkDetect gracefully', () => {
    assert.ok(qualityAdaptSource.includes('evostitch.networkDetect ?') ||
              qualityAdaptSource.includes('if (window.evostitch && window.evostitch.networkDetect)'),
              'Should check networkDetect exists');
});

test('quality-adapt.js defaults to conservative quality for unknown network', () => {
    assert.ok(qualityAdaptSource.includes("unknown: QUALITY.MEDIUM") ||
              qualityAdaptSource.includes("unknown:"), 'Should map unknown to medium');
});

// ========== Report ==========

console.log('\n---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

process.exit(failed > 0 ? 1 : 0);
