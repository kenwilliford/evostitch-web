# Performance Test Harness & Baseline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create automated performance testing harness and capture pre-optimization baseline metrics for the web viewer.

**Architecture:** Playwright test script with Chrome DevTools Protocol (CDP) for network throttling. Injects instrumentation into the viewer to capture tile timing events, then aggregates into JSON metrics. Runs a configurable test matrix across network/cache/viewport conditions.

**Tech Stack:** Playwright, Chrome DevTools Protocol, Node.js, vanilla JS instrumentation

**Issues:** #50 (harness), #51 (baseline)

---

## Task 1: Project Setup

**Files:**
- Create: `web/package.json`
- Create: `web/.gitignore` (append node_modules)

**Step 1: Create package.json**

```json
{
  "name": "evostitch-web",
  "version": "1.0.0",
  "private": true,
  "description": "evostitch web viewer",
  "scripts": {
    "perf-test": "node tests/perf/run-harness.js",
    "perf-test:quick": "node tests/perf/run-harness.js --quick"
  },
  "devDependencies": {
    "playwright": "^1.40.0"
  }
}
```

**Step 2: Update .gitignore**

Append to `web/.gitignore`:
```
node_modules/
```

**Step 3: Install dependencies**

Run: `cd web && npm install`
Expected: `node_modules/` created, playwright installed

**Step 4: Install Playwright browsers**

Run: `cd web && npx playwright install chromium`
Expected: Chromium browser installed for Playwright

**Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/.gitignore
git commit -m "feat(web): add package.json for performance testing (#50)"
```

---

## Task 2: Add TODO Markers

**Files:**
- Modify: `web/js/viewer.js` (add TODO for #50 instrumentation point)
- Create: `web/docs/performance-baseline.md` (add TODO for #51)

**Step 1: Add TODO to viewer.js**

Add after line 3 (inside IIFE, at top):
```javascript
    // TODO(#50): Add performance instrumentation hooks for harness
```

**Step 2: Create placeholder baseline doc with TODO**

Create `web/docs/performance-baseline.md`:
```markdown
# Performance Baseline

<!-- TODO(#51): Capture baseline metrics before W1-W6 optimizations -->

This document will contain pre-optimization baseline metrics.
```

**Step 3: Commit**

```bash
git add web/js/viewer.js web/docs/performance-baseline.md
git commit -m "chore: add TODO markers for #50 and #51"
```

---

## Task 3: Create Harness Configuration

**Files:**
- Create: `web/tests/perf/config.js`

**Step 1: Create configuration module**

```javascript
// Performance test harness configuration

const CONFIG = {
    // Test mosaic - use small 3D mosaic for faster tests
    TEST_MOSAIC: '3x3x3-test',

    // Viewer URL (use local server or production)
    VIEWER_BASE_URL: 'https://evostitch.net/viewer.html',

    // Network throttling profiles (CDP Network.emulateNetworkConditions)
    NETWORK_PROFILES: {
        'unthrottled': null,  // No throttling
        'fast-3g': {
            downloadThroughput: 1.6 * 1024 * 1024 / 8,  // 1.6 Mbps
            uploadThroughput: 750 * 1024 / 8,           // 750 Kbps
            latency: 150                                 // 150ms RTT
        },
        'slow-3g': {
            downloadThroughput: 400 * 1024 / 8,         // 400 Kbps
            uploadThroughput: 400 * 1024 / 8,
            latency: 400                                 // 400ms RTT
        }
    },

    // Viewport sizes
    VIEWPORTS: {
        'desktop': { width: 1920, height: 1080 },
        'mobile': { width: 375, height: 812 }
    },

    // Cache states
    CACHE_STATES: ['cold', 'warm'],

    // Timing thresholds
    VIEWPORT_COMPLETE_TIMEOUT_MS: 60000,  // Max wait for viewport complete
    SETTLE_DELAY_MS: 2000,                // Wait after load for late tiles

    // Output paths
    OUTPUT_DIR: 'web/docs',
    BASELINE_JSON: 'performance-baseline.json',
    BASELINE_MD: 'performance-baseline.md'
};

module.exports = CONFIG;
```

**Step 2: Commit**

```bash
git add web/tests/perf/config.js
git commit -m "feat(web): add performance harness configuration (#50)"
```

---

## Task 4: Create Metrics Collector (Browser-Side)

**Files:**
- Create: `web/tests/perf/metrics-collector.js`

This module is injected into the browser to collect timing data.

**Step 1: Create metrics collector**

```javascript
// Browser-side metrics collector - injected via page.evaluate()
// Hooks into OpenSeadragon events to capture tile timing

function createMetricsCollector() {
    const metrics = {
        startTime: performance.now(),
        firstTileTime: null,
        viewportCompleteTime: null,
        tileLoads: [],
        tilesInViewport: new Set(),
        tilesLoaded: new Set(),
        viewportComplete: false
    };

    // Track tiles currently in viewport
    function updateViewportTiles(viewer) {
        if (!viewer || !viewer.world) return;

        const item = viewer.world.getItemAt(0);
        if (!item) return;

        const tiledImage = item;
        const viewportBounds = viewer.viewport.getBounds();

        metrics.tilesInViewport.clear();

        // Get tiles at current zoom level
        const zoom = viewer.viewport.getZoom(true);
        const containerWidth = viewer.viewport.getContainerSize().x;
        const imageWidth = tiledImage.source.width;
        const level = tiledImage._getLevelForViewportSize(
            viewer.viewport.getContainerSize()
        );

        // Approximate: mark viewport as needing tiles
        // Actual tile enumeration is complex, use tile-loaded events instead
    }

    // Hook into OpenSeadragon viewer
    function attachToViewer(viewer) {
        viewer.addHandler('tile-loaded', function(event) {
            const now = performance.now();
            const elapsed = now - metrics.startTime;

            // Record first tile
            if (metrics.firstTileTime === null) {
                metrics.firstTileTime = elapsed;
            }

            // Get tile URL for tracking
            const tileUrl = event.tile.getUrl ? event.tile.getUrl() : event.tile.url;
            const tileKey = `${event.tile.level}-${event.tile.x}-${event.tile.y}`;

            // Get latency from PerformanceResourceTiming
            let latencyMs = 0;
            if (tileUrl && performance.getEntriesByName) {
                const entries = performance.getEntriesByName(tileUrl, 'resource');
                if (entries.length > 0) {
                    latencyMs = Math.round(entries[entries.length - 1].duration);
                }
            }

            metrics.tileLoads.push({
                time: elapsed,
                level: event.tile.level,
                latencyMs: latencyMs,
                key: tileKey
            });

            metrics.tilesLoaded.add(tileKey);
        });

        // Detect when initial viewport is fully loaded
        viewer.addHandler('tile-load-failed', function(event) {
            console.warn('[perf] Tile load failed:', event.tile.url);
        });

        // Use update-viewport to check completion
        viewer.addHandler('animation-finish', checkViewportComplete);
        viewer.addHandler('open', function() {
            // Give viewer time to request initial tiles
            setTimeout(checkViewportComplete, 500);
        });
    }

    function checkViewportComplete() {
        if (metrics.viewportComplete) return;

        // Check if all requested tiles are loaded
        // This is heuristic: if no new tiles loaded in last 500ms, consider complete
        const now = performance.now();
        const recentLoads = metrics.tileLoads.filter(
            t => (now - metrics.startTime - t.time) < 500
        );

        if (metrics.tileLoads.length > 0 && recentLoads.length === 0) {
            metrics.viewportComplete = true;
            metrics.viewportCompleteTime = performance.now() - metrics.startTime;
        }
    }

    function getResults() {
        // Calculate p50/p95 tile load latency
        const latencies = metrics.tileLoads
            .map(t => t.latencyMs)
            .filter(l => l > 0)
            .sort((a, b) => a - b);

        const p50 = latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.5)]
            : 0;
        const p95 = latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.95)]
            : 0;

        return {
            timeToFirstTile: Math.round(metrics.firstTileTime || 0),
            timeToViewportComplete: Math.round(metrics.viewportCompleteTime || 0),
            p50TileLoad: p50,
            p95TileLoad: p95,
            totalTilesLoaded: metrics.tileLoads.length,
            tileLoads: metrics.tileLoads  // Raw data for analysis
        };
    }

    function forceViewportComplete() {
        if (!metrics.viewportComplete) {
            metrics.viewportComplete = true;
            metrics.viewportCompleteTime = performance.now() - metrics.startTime;
        }
    }

    return {
        attachToViewer,
        checkViewportComplete,
        forceViewportComplete,
        getResults,
        isViewportComplete: () => metrics.viewportComplete
    };
}

// Export for Node.js (when reading file) or browser (when injected)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createMetricsCollector };
}
```

**Step 2: Commit**

```bash
git add web/tests/perf/metrics-collector.js
git commit -m "feat(web): add browser-side metrics collector (#50)"
```

---

## Task 5: Create Main Harness Runner

**Files:**
- Create: `web/tests/perf/run-harness.js`

**Step 1: Create harness runner**

```javascript
#!/usr/bin/env node
// Performance test harness - runs test matrix and outputs JSON results

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

// Read metrics collector source to inject into browser
const metricsCollectorSource = fs.readFileSync(
    path.join(__dirname, 'metrics-collector.js'),
    'utf8'
);

async function runTest(options) {
    const { network, cache, viewport, mosaicId } = options;

    console.log(`  Running: network=${network}, cache=${cache}, viewport=${viewport}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: CONFIG.VIEWPORTS[viewport]
    });

    // Clear cache for cold runs
    if (cache === 'cold') {
        await context.clearCookies();
        // Note: Playwright context is fresh, so cache is already cold
    }

    const page = await context.newPage();

    // Set up CDP for network throttling
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('Network.enable');

    const networkProfile = CONFIG.NETWORK_PROFILES[network];
    if (networkProfile) {
        await cdpSession.send('Network.emulateNetworkConditions', {
            offline: false,
            downloadThroughput: networkProfile.downloadThroughput,
            uploadThroughput: networkProfile.uploadThroughput,
            latency: networkProfile.latency
        });
    }

    // Navigate to viewer
    const url = `${CONFIG.VIEWER_BASE_URL}?mosaic=${mosaicId}`;

    // Inject metrics collector before page loads
    await page.addInitScript(metricsCollectorSource + `
        window.__perfMetrics = createMetricsCollector();
    `);

    // Hook into viewer initialization
    await page.addInitScript(`
        // Wait for OpenSeadragon viewer to be created, then attach
        const checkViewer = setInterval(() => {
            if (window.OpenSeadragon && document.querySelector('.openseadragon-container')) {
                // Find the viewer instance
                const container = document.getElementById('viewer');
                if (container && container.viewer) {
                    window.__perfMetrics.attachToViewer(container.viewer);
                    clearInterval(checkViewer);
                }
            }
        }, 100);
    `);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for viewer to initialize and tiles to load
    const startTime = Date.now();
    let viewportComplete = false;

    while (!viewportComplete && (Date.now() - startTime) < CONFIG.VIEWPORT_COMPLETE_TIMEOUT_MS) {
        await page.waitForTimeout(500);

        viewportComplete = await page.evaluate(() => {
            if (window.__perfMetrics) {
                window.__perfMetrics.checkViewportComplete();
                return window.__perfMetrics.isViewportComplete();
            }
            return false;
        });

        // Also check if tiles have been loading
        const tilesLoaded = await page.evaluate(() => {
            return window.__perfMetrics ?
                window.__perfMetrics.getResults().totalTilesLoaded : 0;
        });

        if (tilesLoaded > 0) {
            // Wait a bit more for viewport to settle
            await page.waitForTimeout(CONFIG.SETTLE_DELAY_MS);
            viewportComplete = true;
        }
    }

    // Force completion if timeout
    await page.evaluate(() => {
        if (window.__perfMetrics) {
            window.__perfMetrics.forceViewportComplete();
        }
    });

    // Collect metrics
    const metrics = await page.evaluate(() => {
        return window.__perfMetrics ? window.__perfMetrics.getResults() : null;
    });

    await browser.close();

    if (!metrics) {
        throw new Error('Failed to collect metrics');
    }

    // Return without raw tileLoads for JSON output
    const { tileLoads, ...summaryMetrics } = metrics;
    return summaryMetrics;
}

async function warmCache(mosaicId) {
    // Run a quick pass to warm browser cache
    console.log('  Warming cache...');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: CONFIG.VIEWPORTS['desktop']
    });
    const page = await context.newPage();

    const url = `${CONFIG.VIEWER_BASE_URL}?mosaic=${mosaicId}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);  // Let tiles load

    await browser.close();
}

async function runTestMatrix(options = {}) {
    const { quick = false } = options;
    const mosaicId = CONFIG.TEST_MOSAIC;

    const results = {
        timestamp: new Date().toISOString(),
        mosaic: mosaicId,
        conditions: []
    };

    // Define test matrix
    let networks = Object.keys(CONFIG.NETWORK_PROFILES);
    let viewports = Object.keys(CONFIG.VIEWPORTS);
    let cacheStates = CONFIG.CACHE_STATES;

    // Quick mode: reduced matrix
    if (quick) {
        networks = ['unthrottled', 'fast-3g'];
        viewports = ['desktop'];
        cacheStates = ['cold'];
    }

    console.log(`Running performance tests on mosaic: ${mosaicId}`);
    console.log(`Matrix: ${networks.length} networks x ${viewports.length} viewports x ${cacheStates.length} cache states`);
    console.log('');

    for (const viewport of viewports) {
        for (const network of networks) {
            for (const cache of cacheStates) {
                // For warm cache tests, we need to warm first
                if (cache === 'warm') {
                    await warmCache(mosaicId);
                }

                try {
                    const metrics = await runTest({
                        network,
                        cache,
                        viewport,
                        mosaicId
                    });

                    results.conditions.push({
                        conditions: { network, cache, viewport },
                        metrics
                    });

                    console.log(`    -> First tile: ${metrics.timeToFirstTile}ms, Viewport: ${metrics.timeToViewportComplete}ms, p50: ${metrics.p50TileLoad}ms`);
                } catch (error) {
                    console.error(`    -> ERROR: ${error.message}`);
                    results.conditions.push({
                        conditions: { network, cache, viewport },
                        error: error.message
                    });
                }
            }
        }
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const quick = args.includes('--quick');

    try {
        const results = await runTestMatrix({ quick });

        // Output JSON to stdout
        console.log('\n--- Results JSON ---');
        console.log(JSON.stringify(results, null, 2));

        // Also save to file
        const outputPath = path.join(
            __dirname, '..', '..', 'docs',
            CONFIG.BASELINE_JSON
        );
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`\nResults saved to: ${outputPath}`);

    } catch (error) {
        console.error('Harness failed:', error);
        process.exit(1);
    }
}

main();
```

**Step 2: Commit**

```bash
git add web/tests/perf/run-harness.js
git commit -m "feat(web): add performance test harness runner (#50)"
```

---

## Task 6: Fix Viewer Instrumentation Hook

**Files:**
- Modify: `web/js/viewer.js`

The current viewer doesn't expose the OSD viewer instance. We need to expose it for the harness.

**Step 1: Expose viewer instance**

In `web/js/viewer.js`, after line 171 (where viewer is created in init2D), add:

```javascript
        // Expose viewer for external instrumentation (performance testing)
        document.getElementById('viewer').viewer = viewer;
```

Also add the same after line 200 (in initZStack, after viewer creation):

```javascript
        // Expose viewer for external instrumentation (performance testing)
        document.getElementById('viewer').viewer = viewer;
```

**Step 2: Remove TODO marker**

Remove the TODO(#50) comment added in Task 2 (the instrumentation is now complete).

**Step 3: Commit**

```bash
git add web/js/viewer.js
git commit -m "feat(web): expose viewer instance for performance instrumentation (#50)"
```

---

## Task 7: Update Architecture Documentation

**Files:**
- Modify: `web/docs/architecture.md`

**Step 1: Add Performance Testing section**

Append to `web/docs/architecture.md`:

```markdown

---

## Performance Testing

Automated harness for measuring viewer performance under controlled conditions.

### Structure

```
web/tests/perf/
├── config.js           # Test matrix configuration
├── metrics-collector.js # Browser-side instrumentation
└── run-harness.js      # Main test runner
```

### Usage

```bash
# Full test matrix (all conditions)
npm run perf-test

# Quick test (reduced matrix for fast iteration)
npm run perf-test:quick
```

### Test Matrix

| Dimension | Values |
|-----------|--------|
| Network | Unthrottled, Fast 3G (1.6Mbps), Slow 3G (400kbps) |
| Cache | Cold (cleared), Warm (primed) |
| Viewport | Desktop (1920x1080), Mobile (375x812) |

### Metrics Captured

| Metric | Description |
|--------|-------------|
| `timeToFirstTile` | Time from navigation to first tile loaded (ms) |
| `timeToViewportComplete` | Time until all visible tiles loaded (ms) |
| `p50TileLoad` | Median tile load latency (ms) |
| `p95TileLoad` | 95th percentile tile load latency (ms) |

### Output

Results written to `docs/performance-baseline.json`:

```json
{
  "timestamp": "2026-01-13T...",
  "mosaic": "3x3x3-test",
  "conditions": [
    {
      "conditions": { "network": "fast-3g", "cache": "cold", "viewport": "desktop" },
      "metrics": { "timeToFirstTile": 234, "timeToViewportComplete": 1892, "p50TileLoad": 145 }
    }
  ]
}
```

### Implementation Notes

- Uses Playwright with Chrome DevTools Protocol for network throttling
- Browser-side metrics collector injected via `addInitScript`
- Viewer exposes OSD instance via `document.getElementById('viewer').viewer`
```

**Step 2: Commit**

```bash
git add web/docs/architecture.md
git commit -m "docs(web): add performance testing section to architecture (#50)"
```

---

## Task 8: Test the Harness

**Step 1: Run quick test**

Run: `cd web && npm run perf-test:quick`

Expected:
- Tests run for 2-4 conditions
- JSON output to stdout
- File created at `web/docs/performance-baseline.json`

**Step 2: Verify JSON structure**

Run: `cat web/docs/performance-baseline.json | head -30`

Expected: Valid JSON with timestamp, mosaic, conditions array

**Step 3: Fix any issues**

If tests fail, debug and fix before proceeding.

---

## Task 9: Capture Full Baseline (#51)

**Files:**
- Create: `web/docs/performance-baseline.json` (generated)
- Modify: `web/docs/performance-baseline.md`

**Step 1: Run full test matrix**

Run: `cd web && npm run perf-test`

Expected: Full matrix runs (3 networks x 2 viewports x 2 cache states = 12 conditions)

**Step 2: Update baseline markdown**

Replace `web/docs/performance-baseline.md` with actual results (format table from JSON):

```markdown
# Performance Baseline

Pre-optimization baseline metrics captured before W1-W6 improvements.

**Captured:** [timestamp from JSON]
**Test Mosaic:** 3x3x3-test (8404x5815px, 3 Z-planes)

## Current Architecture State

- No service worker (all tiles fetched fresh)
- No adaptive prefetching (only adjacent Z-planes preloaded)
- No tile request prioritization
- Basic OpenSeadragon configuration

## Baseline Metrics

### Desktop (1920x1080)

| Network | Cache | First Tile | Viewport Complete | p50 Load | p95 Load |
|---------|-------|------------|-------------------|----------|----------|
| Unthrottled | Cold | [val]ms | [val]ms | [val]ms | [val]ms |
| Unthrottled | Warm | [val]ms | [val]ms | [val]ms | [val]ms |
| Fast 3G | Cold | [val]ms | [val]ms | [val]ms | [val]ms |
| Fast 3G | Warm | [val]ms | [val]ms | [val]ms | [val]ms |
| Slow 3G | Cold | [val]ms | [val]ms | [val]ms | [val]ms |
| Slow 3G | Warm | [val]ms | [val]ms | [val]ms | [val]ms |

### Mobile (375x812)

| Network | Cache | First Tile | Viewport Complete | p50 Load | p95 Load |
|---------|-------|------------|-------------------|----------|----------|
| Unthrottled | Cold | [val]ms | [val]ms | [val]ms | [val]ms |
| Unthrottled | Warm | [val]ms | [val]ms | [val]ms | [val]ms |
| Fast 3G | Cold | [val]ms | [val]ms | [val]ms | [val]ms |
| Fast 3G | Warm | [val]ms | [val]ms | [val]ms | [val]ms |
| Slow 3G | Cold | [val]ms | [val]ms | [val]ms | [val]ms |
| Slow 3G | Warm | [val]ms | [val]ms | [val]ms | [val]ms |

## Observations

[Fill in after reviewing results]

### Bottlenecks Identified

1. [Observation from data]
2. [Observation from data]

### Optimization Predictions

| Optimization | Expected Impact | Affected Conditions |
|--------------|-----------------|---------------------|
| Service Worker (W1) | Reduce warm p50 by ~80% | All warm conditions |
| Request Prioritization (W2) | Reduce viewport complete by ~20% | All conditions |
| Adaptive Prefetch (W3) | Reduce first tile on pan by ~30% | Warm conditions |

## Raw Data

See `performance-baseline.json` for complete metrics.
```

**Step 3: Remove TODO marker from performance-baseline.md**

The TODO(#51) was added as a placeholder - now we have real content.

**Step 4: Commit**

```bash
git add web/docs/performance-baseline.json web/docs/performance-baseline.md
git commit -m "docs(web): capture pre-optimization performance baseline (#51)"
```

---

## Task 10: Final Cleanup

**Files:**
- Verify: All TODO markers removed
- Verify: Documentation complete

**Step 1: Check for orphan TODOs**

Run: `grep -r "TODO(#50)" web/ && grep -r "TODO(#51)" web/`

Expected: No output (all TODOs removed)

**Step 2: Verify npm script works**

Run: `cd web && npm run perf-test:quick`

Expected: Completes successfully

**Step 3: Final commit (if any changes)**

Only if cleanup needed.

---

## Code Review Checkpoints

**After Task 8 (harness complete):** Run `superpowers:requesting-code-review` before proceeding to baseline capture.

**After Task 9 (baseline complete):** Run `superpowers:requesting-code-review` before creating PR.

---

## Acceptance Criteria Verification

Before creating PR, verify:

- [ ] `npm run perf-test` runs full matrix
- [ ] `npm run perf-test:quick` runs reduced matrix
- [ ] `web/docs/performance-baseline.json` exists with valid data
- [ ] `web/docs/performance-baseline.md` has filled tables
- [ ] No orphan TODOs (`make todos-orphans` is empty)
- [ ] `web/docs/architecture.md` updated with testing section
- [ ] Works in headless mode (CI-compatible)
