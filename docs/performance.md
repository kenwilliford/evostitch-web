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

## Performance Characteristics by Scenario

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

| Module | Tests |
|--------|-------|
| tile-prioritizer.js | 45 |
| network-detect.js | 37 |
| quality-adapt.js | 51 |
| **Total** | **133** |

Run tests: `node tests/<module>.test.js`

---

## Known Limitations

1. **Warm cache isolation**: Playwright browser contexts have isolated caches, making warm-cache benchmarks unreliable in automated tests.

2. **VM timing variance**: Absolute load times vary significantly in virtualized environments. Relative comparisons are more meaningful.

3. **Navigator.connection API**: Not supported in Safari/Firefox. Falls back to tile timing detection.

4. **OpenSeadragon multi-image warnings**: OSD logs `viewportToImageCoordinates` warnings in 3D mode. These are OSD limitations, not bugs in evostitch code.
