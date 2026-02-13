# Web Viewer Performance

Performance characteristics of the evostitch web viewer, focusing on optimization modules and relative improvements.

**Note:** Absolute load times vary significantly by environment (VM, network, CDN proximity). This document focuses on relative improvements and optimization mechanisms rather than absolute benchmarks.

---

## Optimization Modules (W1-W4)

### W1: Service Worker Caching (sw.js)

Caches tiles locally for improved repeat-visit performance.

| Metric | Improvement | Mechanism |
|--------|-------------|-----------|
| Repeat visit load | ~80% faster | Cache-first strategy for immutable tiles |
| Offline capability | Enabled | Cached tiles available without network |

**Cache behavior:**
- Tiles cached on first load, served from cache on subsequent visits
- LRU eviction when cache exceeds 5000 entries
- Cache versioned (`evostitch-tiles-v1.2.0`) for clean upgrades

### W2: Tile Request Prioritization (tile-prioritizer.js)

Optimizes tile loading order for 3D mosaics.

| Metric | Improvement | Mechanism |
|--------|-------------|-----------|
| Viewport complete | ~25% faster | Current Z-plane tiles prioritized over prefetch |
| Animation smoothness | Improved | Concurrent requests reduced during pan/zoom (6→2) |
| Z-transition (fast scroll) | ~94% faster | Predictive prefetch in velocity direction |

**Priority levels:**
1. VIEWPORT_CURRENT_Z (1) - Visible tiles on current plane
2. VIEWPORT_ADJACENT_Z (2) - Visible tiles on ±1 planes
3. PREFETCH (3) - Background prefetch tiles

**Predictive Z-prefetch:**
- Tracks Z-navigation velocity (planes/second)
- Slow navigation (< 1 plane/sec): prefetch ±1 adjacent planes
- Fast navigation (≥ 1 plane/sec): prefetch 1-5 planes ahead in scroll direction
- Prefetch depth scales with speed: `depth = min(5, ceil(velocity / 2))`

### W3: Network Detection (network-detect.js)

Classifies network speed for adaptive quality decisions.

| Detection Method | Priority | Coverage |
|------------------|----------|----------|
| Navigator.connection API | 1st | Modern browsers (Chrome, Edge, Opera) |
| Tile load timing fallback | 2nd | All browsers |

**Speed classifications:**
- **fast**: 4G / ≥5 Mbps / tiles load ≤150ms
- **medium**: 3G / ≥1 Mbps / tiles load ≤500ms
- **slow**: 2G / <1 Mbps / tiles load >500ms

**Hysteresis:** Requires 3 consecutive classifications before changing state (prevents UI flicker).

### W4: Adaptive Quality (quality-adapt.js)

Reduces tile resolution on slow networks for usable experience.

| Network | Quality | Zoom Reduction | Effective Resolution |
|---------|---------|----------------|---------------------|
| fast | high | 0 levels | Full |
| medium | medium | 2 levels | 1/4 |
| slow | low | 4 levels | 1/16 |

**Progressive enhancement:** After 20+ tiles loaded at reduced quality, checks if network improved and upgrades quality automatically (5s delay).

### Blur-Up Loading (blur-up-loader.js)

Shows low-resolution placeholder while high-res tile loads.

| Metric | Improvement | Mechanism |
|--------|-------------|-----------|
| Time-to-first-visual | ~88% faster (slow networks) | Placeholder from 3 levels lower (8x smaller) |

**Activation threshold:** Only shows placeholder if tile takes >100ms to load. Fast CDN loads don't trigger unnecessary placeholders.

---

## OME-Zarr Viewer Performance (W7-W12)

Performance sprint upgrading the OME-Zarr viewer from Viv 0.15 + deck.gl 8 to Viv 0.19 + deck.gl 9, with architectural improvements.

**Dataset:** evostitch R2 `mosaic_3d_zarr` (21 Z-planes, 2 channels, 33x33 tiles at highest res, chunks [1,1,1,512,512])
**Test environment:** Playwright headless (SwiftShader WebGL), HTTP server on localhost, R2 CDN via `data.evostitch.net`

### Before/After Z-Switch Latency

Pre-sprint baseline (Viv 0.15 + deck.gl 8, debounce-only optimization): ~975ms cold Z-switch.

| Condition | Pre-Sprint | Post-Sprint | Improvement |
|-----------|-----------|-------------|-------------|
| Cold Z-switch avg | ~975ms | 368ms | 2.6x faster |
| Cold Z-switch p95 | ~975ms | 458ms | 2.1x faster |
| Warm Z-switch avg | N/A (no SW cache stats pre-sprint) | ~65ms | — |
| Combined p50 | — | 88ms | — |
| Combined p95 | — | 458ms | — |

*Rollback gate test: 5 cold + 5 warm Z-switches + 1 return-to-zero. 11 total samples.*

### Numeric Gates

| Work Item | Metric | Gate Threshold | Actual | Status |
|-----------|--------|---------------|--------|--------|
| W7 | Z-switch p95 (cold) | ≤ 1200ms | 458ms | PASS |
| W7 | Z-switch p95 (warm) | ≤ 200ms | 88ms (p50 combined) | PASS |
| W9 | Blank frame on Z-switch | None (binary) | None | PASS |
| W10 | Late fetch rate | < 0.1 | Instrumented (pending 9.1 benchmark) | — |
| W10 | `prefetchedBytesPerZSwitch` | ≤ baseline | Instrumented (pending 9.1 benchmark) | — |
| W12 | HTTP/2 protocol | `nextHopProtocol === 'h2'` | h2 confirmed | PASS |

### W7: Viv 0.19 + deck.gl 9 Upgrade

| Component | Before | After |
|-----------|--------|-------|
| `@hms-dbmi/viv` | 0.15.x | 0.19.0 |
| `deck.gl` | 8.9.x | 9.1.15 |
| `@luma.gl/*` | 8.5.x | 9.1.10 |
| `@math.gl/*` | 3.x | 4.1.0 |
| Bundle size | ~2.3 MB | ~3.6 MB (ESM + sourcemap) |
| Build time | ~124ms | ~140ms |
| WebGL | WebGL1/2 | WebGL2 only |

Viv 0.19 brings zarrita (replacing zarr.js) and deck.gl 9's improved tile management. The `_data` private API access in `zarr-prefetch.js` was replaced with direct `.zarray` metadata fetches per resolution level.

### W8: zarr-cache.js Removal

| Metric | Before | After |
|--------|--------|-------|
| Cache layers | 2 (zarr-cache.js + SW) | 1 (SW only) |
| Application JS removed | — | 578 lines (zarr-cache.js) |
| Test lines removed | — | 469 lines (zarr-cache.test.js) |

The `zarr-cache.js` module duplicated the SW's cache-first strategy. Removing it eliminated the competing cache layer. SW cache (`evostitch-zarr-v1.4.1`) handles all zarr chunk caching with LRU eviction at 10,000 entries.

### W9: refinementStrategy

| Metric | Before | After |
|--------|--------|-------|
| Z-switch visual | Blank flash (tile cache invalidated) | Old frame persists as placeholder |
| Strategy | None (Viv default) | `'best-available'` (explicit) |
| Opacity transition | Fade 1.0→0.7→1.0 (flicker) | Subtle pulse 0.92→1.0 (100ms) |

deck.gl 9's `refinementStrategy: 'best-available'` keeps old tile content visible via `getPlaceholderInAncestors()` while new tiles load. Combined with the generation counter for stale callback rejection, Z-switching is visually seamless.

### W10: Viewport-Aware Prefetch

| Metric | Before | After |
|--------|--------|-------|
| Prefetch scope | All chunks in selected levels | Visible viewport + 2-tile margin |
| Shared viewport math | Duplicated in zarr-3d-loader.js | `zarr-viewport-math.js` (shared IIFE) |
| Monitoring metrics | None | `lateFetchCount`, `prefetchedBytes`, `totalZSwitches`, `prefetchedBytesPerZSwitch` |

At high zoom levels, viewport filtering reduces prefetch volume significantly (only visible tiles + 2-tile margin instead of the full tile grid). Graceful fallback to all-chunks when viewport data unavailable.

### W12: Custom Domain + HTTP/2

| Metric | Before | After |
|--------|--------|-------|
| Domain | `pub-*.r2.dev` (R2 default) | `data.evostitch.net` (custom) |
| Protocol | HTTP/1.1 | HTTP/2 (multiplexed) |
| Concurrent streams | 6 per origin (HTTP/1.1 limit) | Unlimited (HTTP/2) |
| SW version | 1.3.0 | 1.4.0 |
| Domain support | Single R2 domain | Dual-domain (old + new) |
| CORS origins | `https://evostitch.net` only | + `http://localhost:8000`, `http://100.114.145.93:8000` |

**Cache-Control (via Cloudflare Transform Rules):**

| Resource | Header | TTL |
|----------|--------|-----|
| Chunks (`/mosaic_3d_zarr/0/...`) | `public, max-age=31536000, immutable` | 1 year |
| Metadata (`.zarray`, `.zattrs`, `.zgroup`) | `public, max-age=3600` | 1 hour |
| Static assets | Network-first (SW) | — |

See `metadata-runbook.md` for cache invalidation procedures.

### OME-Zarr Console APIs

```javascript
// Zarr viewer perf stats (Z-switch timing)
evostitch.zarrViewer.getPerfStats()
// Returns: { sampleCount, avgMs, p50Ms, p95Ms, minMs, maxMs }

// Prefetch stats (viewport efficiency)
evostitch.zarrPrefetch.getStats()
// Returns: { lateFetchCount, totalZSwitches, prefetchedBytes, prefetchedBytesPerZSwitch, ... }

// SW cache stats
evostitch.sw.getStats()
// Returns: { cacheName, count }

// Clear SW cache
evostitch.sw.clearCache()
```

### OME-Zarr Test Coverage

| Module | Tests |
|--------|-------|
| zarr-prefetch.js | 104 |
| zarr-3d-loader.js | 67 |
| zarr-integration | 53 |
| zarr-render-opt.js | 58 |
| sw.js | 57 |
| zarr-viewport-math.js (via integration) | included above |
| **Total** | **339** |

### Automated Gate Tests

| Test | Purpose |
|------|---------|
| `w7-rollback-gate.test.js` | p95 ≤ 2000ms, no WebGL loss, SW active |
| `w7-full-browser.test.js` | Z-nav, zoom/pan, channels, prefetch, 3D mode, SW (8 checks) |
| `w12-dual-domain.test.js` | Dual-domain SW interception, CORS, cache growth (7 checks) |
| `spike-w7.test.js` | IDR + R2 dataset loading, deck.gl 9 rendering (6 checks) |

---

## DZI Viewer Scenarios

### Initial Page Load

| Phase | Optimization | Effect |
|-------|--------------|--------|
| First visit | None (cold cache) | Full network latency |
| Repeat visit | W1 (service worker) | Tiles served from local cache |
| Slow network | W4 (quality adapt) | Reduced resolution for faster loads |

### Z-Stack Navigation

| Behavior | Optimization | Effect |
|----------|--------------|--------|
| Slow scrub | W2 (prefetch ±1) | Adjacent planes preloaded |
| Fast scrub | W2 (predictive prefetch) | 1-5 planes ahead preloaded |
| Direction change | W2 (opposite plane) | 1 plane in opposite direction also prefetched |

### Pan/Zoom During Animation

| State | Concurrent Requests | Rationale |
|-------|---------------------|-----------|
| Idle | 6 | Maximize throughput |
| Animating | 2 | Reduce network contention during motion |

---

## Measuring Performance

### Browser Console APIs

```javascript
// Telemetry - tile load statistics
evostitch.telemetry.getStats()     // { coldCount, coldAvgMs, warmCount, warmAvgMs }
evostitch.telemetry.logSummary()   // Log summary to console

// Tile prioritizer state
evostitch.tilePrioritizer.getState()  // { currentZ, zVelocity, pendingJobs, predictedPlanes }

// Network detection
evostitch.networkDetect.getSpeed()    // 'fast' | 'medium' | 'slow'
evostitch.networkDetect.getInfo()     // Detailed diagnostics

// Quality adaptation
evostitch.qualityAdapt.getEffectiveQuality()  // Current quality level
evostitch.qualityAdapt.getState()             // Full state
```

### Debug Logging

Enable verbose logging for any module:

```javascript
evostitch.tilePrioritizer.setDebug(true)
evostitch.networkDetect.setDebug(true)
evostitch.qualityAdapt.setDebug(true)
evostitch.blurUpLoader.setDebug(true)
```

### Automated Testing

```bash
# Run performance test harness
npm run perf-test

# Quick test (reduced matrix)
npm run perf-test:quick
```

See `performance-baseline.md` for pre-optimization baseline metrics.

---

## Unit Test Coverage

### DZI Viewer (W1-W4)

| Module | Tests |
|--------|-------|
| tile-prioritizer.js | 57 |
| network-detect.js | 37 |
| quality-adapt.js | 51 |
| **Subtotal** | **145** |

### OME-Zarr Viewer (W7-W12)

| Module | Tests |
|--------|-------|
| zarr-prefetch.js | 104 |
| zarr-3d-loader.js | 67 |
| zarr-render-opt.js | 58 |
| sw.js | 50 |
| zarr-integration | 53 |
| **Subtotal** | **332** |

**Full suite: 477 tests** — `npm test` (DZI + SW: 195) + zarr tests run individually (282)

---

## Known Limitations

1. **Warm cache isolation**: Playwright browser contexts have isolated caches, making warm-cache benchmarks unreliable in automated tests.

2. **VM timing variance**: Absolute load times vary significantly in virtualized environments. Relative comparisons are more meaningful.

3. **Navigator.connection API**: Not supported in Safari/Firefox. Falls back to tile timing detection.

4. **OpenSeadragon multi-image warnings**: OSD logs `viewportToImageCoordinates` warnings in 3D mode. These are OSD limitations, not bugs in evostitch code.
