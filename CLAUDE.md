# evostitch Web - Viewer Component

JavaScript viewer for displaying stitched microscopy mosaics with Z-plane navigation.

## Before You Start

1. Review current state: Open `index.html` and `viewer.html` in browser
2. Read `docs/architecture.md` for module structure
3. Check for TODOs: `grep -r "TODO(#" js/`

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Catalog page listing available mosaics |
| `viewer.html` | Main viewer page with OpenSeadragon |
| `sw.js` | Service worker for tile caching (W1) |
| `js/catalog.js` | Catalog loading and display logic |
| `js/viewer.js` | Viewer initialization and Z-navigation |
| `js/telemetry.js` | Tile load performance measurement |
| `js/tile-prioritizer.js` | Request prioritization and Z-prefetch (W2) |
| `js/network-detect.js` | Network speed detection (W3) |
| `js/quality-adapt.js` | Adaptive quality based on network (W4) |
| `zarr-viewer.html` | OME-Zarr 3D Explorer (Viv/deck.gl) |
| `js/zarr-viewer.js` | Zarr viewer initialization, Z-navigation, channel controls |
| `js/zarr-prefetch.js` | Predictive Z-plane prefetching for zarr viewer |
| `js/zarr-render-opt.js` | Z-debounce, zoom capping for zarr viewer |
| `js/zarr-3d-loader.js` | "Load 3D" mode: viewport-scoped prefetch for smooth Z-focus |
| `css/style.css` | Shared styles |
| `CNAME` | GitHub Pages custom domain (evostitch.net) |

## Key Patterns

- **IIFE pattern:** All JS uses immediately-invoked function expressions to avoid global pollution
- **OpenSeadragon:** Core viewer library for pyramidal image display
- **DZI format:** Deep Zoom Image format for tile pyramids

## Testing

No test suite yet (see Issue #18). For now:
- Manual testing in browser
- Check console for errors

## Performance Optimization Workflow

**Every optimization task follows this protocol.** This is non-negotiable for W1-W6 work.

### The Cycle

```
Hypothesis → Baseline → Implement → Measure → Validate → Document
```

### Before Implementation

1. **Hypothesis**: What will improve? By how much? Why do you expect this?
   - Be specific: "Service worker will reduce p95 cold tile load by 40% on 3G"
   - Not vague: "This should make things faster"

2. **Baseline**: Run test harness, record metrics under test matrix conditions
   - Use `npm run perf-test` (see #50)
   - Compare against `docs/performance-baseline.json`

3. **Prediction Table**: Document expected impact per condition
   ```
   | Condition | Metric | Baseline | Predicted |
   |-----------|--------|----------|-----------|
   | 3G/Cold   | p95 tile load | 2400ms | 1440ms (-40%) |
   ```

### After Implementation

4. **Measurement**: Re-run test harness with identical conditions

5. **Validation**: Compare actual vs predicted
   - Did it improve the predicted metric?
   - Were there unexpected regressions elsewhere?
   - Was the magnitude correct?

6. **Documentation**: Record learnings
   - What matched predictions?
   - What surprised you?
   - How should this inform future predictions?

### Test Matrix Dimensions

| Dimension | Values |
|-----------|--------|
| Network | Unthrottled, Fast 3G (1.6Mbps), Slow 3G (400kbps) |
| Cache | Cold (cleared), Warm (primed) |
| Viewport | Desktop (1920x1080), Mobile (375x812) |

### When This Applies

- **Always**: W1-W6 optimization tasks
- **Maybe**: Bug fixes that might affect performance
- **Skip**: Pure refactoring with no performance intent

### Red Flags (You're Rationalizing)

| Thought | Reality |
|---------|---------|
| "This obviously helps" | Measure it. Obvious improvements sometimes don't. |
| "Too small to measure" | Small changes compound. Measure anyway. |
| "I'll measure after a few changes" | Measure after EACH. Otherwise you can't attribute impact. |
| "The harness isn't set up yet" | Set it up first (#50). No optimization without measurement. |

### Relevant Issues

- #50: Performance test harness
- #51: Baseline capture

## Code Style

- ES6+ JavaScript
- No build step currently (vanilla JS)
- Follow existing IIFE patterns

## Documentation Updates

See **repo-level CLAUDE.md § Documentation Updates** for criteria and checklist.

**Web-specific doc locations:**

| Doc | When to Update |
|-----|----------------|
| `docs/architecture.md` | New module, structural changes, new APIs |
| `CLAUDE.md` | AI session context (e.g., telemetry API below) |

No CHANGELOG for web component currently.

## Telemetry

Tile load telemetry measures cold (network) vs warm (browser cache) performance.

### Console API

```javascript
// View current stats
evostitch.telemetry.getStats()
// Returns: { deviceTier, lastUpdated, byZoom: {...}, totals: { coldCount, coldAvgMs, warmCount, warmAvgMs } }

// Log summary to console
evostitch.telemetry.logSummary()
// Output: "[evostitch] Telemetry: cold=206 tiles (avg 135ms), warm=72 tiles (avg 1ms)"

// Clear all telemetry data
evostitch.telemetry.clearStats()

// Force flush pending data to localStorage
evostitch.telemetry.flushToStorage()
```

### How It Works

1. **Measurement:** Uses `PerformanceResourceTiming` API to get actual tile load duration
2. **Classification:** Tiles loading < 50ms are "warm" (cache hits), >= 50ms are "cold" (network)
3. **Storage:** Batched writes to localStorage (flushes every 5s or 50 tiles)
4. **Persistence:** Data persists across sessions in `localStorage['evostitch_tile_telemetry']`

### Interpreting Results

| Metric | Typical Values | Meaning |
|--------|----------------|---------|
| Cold avg | 100-200ms | Network latency + decode time |
| Warm avg | 0-5ms | Browser cache hit |
| Warm ratio | Higher = better | User revisiting same areas |

### Limitations

- Only measures tiles loaded via OpenSeadragon events
- Browser cache behavior varies by browser/settings
- No server-side aggregation (local to each browser)

## Performance Modules (W1-W4)

The performance optimization modules are documented in detail in `docs/architecture.md`. Quick reference for console debugging:

### Tile Prioritizer (W2)

```javascript
evostitch.tilePrioritizer.getState()   // { enabled, currentZ, pendingJobs, isAnimating }
evostitch.tilePrioritizer.setDebug(true) // Enable debug logging
```

### Network Detection (W3)

```javascript
evostitch.networkDetect.getSpeed()    // 'fast' | 'medium' | 'slow' | 'unknown'
evostitch.networkDetect.getInfo()     // { speed, effectiveType, downlink, ... }
evostitch.networkDetect.setDebug(true)
```

### Quality Adaptation (W4)

```javascript
evostitch.qualityAdapt.getQuality()          // 'auto' | 'high' | 'medium' | 'low'
evostitch.qualityAdapt.getEffectiveQuality() // What's actually being used
evostitch.qualityAdapt.setQuality('high')    // Manual override
evostitch.qualityAdapt.getState()            // Full debugging state
evostitch.qualityAdapt.setDebug(true)
```

### Loading Indicator

```javascript
evostitch.loadingIndicator.show()           // Show with 300ms delay
evostitch.loadingIndicator.setProgress(0.5, 0.8)  // 50% XY tiles, 80% Z-planes
evostitch.loadingIndicator.hide()           // Hide and reset
evostitch.loadingIndicator.getState()       // { initialized, isLoading, visible, xyProgress, zProgress }
```

### Worker Pool (W5)

```javascript
evostitch.workerPool.decode(url)  // Returns Promise<ImageBitmap>
evostitch.workerPool.getState()   // { initialized, workerCount, pendingJobs, nextJobId }
evostitch.workerPool.setDebug(true)
evostitch.workerPool.terminate()  // Shut down all workers
```

### Worker Tile Source (W5)

```javascript
evostitch.workerTileSource.getStats()  // { enabled, workerDecodes, fallbackDecodes, errors }
evostitch.workerTileSource.setEnabled(true/false)  // Enable/disable
evostitch.workerTileSource.setDebug(true)
```

**Note:** Worker tile decoding requires CORS headers on tile server for cross-origin tiles. R2 CDN tiles currently use standard OSD loader.

### Browser Decode Detection

```javascript
evostitch.browserDecode.getInfo()  // { browser, canUseWorkers, strategy }
```

## GitHub Pages

Deployed from `web/` directory to evostitch.net
- CNAME file configures custom domain
- Static files only, no server-side code

## Playwright Browser Testing

### Ubuntu 24.04 Setup

Chrome sandbox requires AppArmor exception on Ubuntu 24.04+:

```bash
# Create Chrome-specific AppArmor profile (persists across reboots)
echo 'abi <abi/4.0>,
include <tunables/global>

profile playwright-chrome /home/*/.cache/ms-playwright/*/chrome-linux/chrome flags=(unconfined) {
  userns,
}' | sudo tee /etc/apparmor.d/playwright-chrome

sudo apparmor_parser -r /etc/apparmor.d/playwright-chrome
```

This enables Chromium's sandbox without disabling system-wide unprivileged user namespace restrictions.

### Unit Tests

```bash
node tests/tile-prioritizer.test.js  # 45 tests
node tests/network-detect.test.js    # 37 tests
node tests/quality-adapt.test.js     # 51 tests
```
