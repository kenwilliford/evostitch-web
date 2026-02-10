# Performance Baseline

Pre-optimization baseline metrics captured before W1-W6 improvements.

**Captured:** 2026-01-14T16:31:55.045Z
**Test Mosaic:** 3x3x3-test (8404x5815px, 3 Z-planes)

## Current Architecture State

- No service worker (all tiles fetched fresh)
- No adaptive prefetching (only adjacent Z-planes preloaded)
- No tile request prioritization
- Basic OpenSeadragon configuration
- Tiles served from Cloudflare R2

## Baseline Metrics

### Desktop (1920x1080)

| Network | Cache | First Tile | Viewport Complete | p50 Load | p95 Load | Tiles |
|---------|-------|------------|-------------------|----------|----------|-------|
| Unthrottled | Cold | 547ms | 1204ms | 88ms | 121ms | 49 |
| Unthrottled | Warm* | 360ms | 1095ms | 103ms | 136ms | 66 |
| Fast 3G | Cold | 1599ms | 7209ms | 1579ms | 1971ms | 31 |
| Fast 3G | Warm* | 1806ms | 8152ms | 1429ms | 2129ms | 35 |
| Slow 3G | Cold | 6147ms | 29339ms | 6562ms | 8495ms | 29 |
| Slow 3G | Warm* | 6178ms | 29209ms | 6502ms | 8493ms | 29 |

### Mobile (375x812)

| Network | Cache | First Tile | Viewport Complete | p50 Load | p95 Load | Tiles |
|---------|-------|------------|-------------------|----------|----------|-------|
| Unthrottled | Cold | 379ms | 468ms | 124ms | 152ms | 9 |
| Unthrottled | Warm* | 404ms | 502ms | 103ms | 125ms | 9 |
| Fast 3G | Cold | 1696ms | 2457ms | 727ms | 1513ms | 9 |
| Fast 3G | Warm* | 1684ms | 2449ms | 723ms | 1509ms | 9 |
| Slow 3G | Cold | 6236ms | 9241ms | 3043ms | 6016ms | 7 |
| Slow 3G | Warm* | 6207ms | 9198ms | 3007ms | 5979ms | 7 |

\* Warm cache tests have limited accuracy due to browser isolation. See Known Limitations in architecture.md.

## Observations

### Key Findings

1. **Network is the primary bottleneck**: Time to first tile increases ~3x from unthrottled (547ms) to fast-3G (1599ms), and ~11x for slow-3G (6147ms)

2. **Mobile loads fewer tiles**: Desktop loads 49 tiles for initial viewport vs 9 for mobile. Smaller viewport = fewer visible tiles

3. **Slow-3G shows severe delays**: Desktop viewport completion takes 29s under slow-3G conditions, reflecting the ~6.5s per-tile latency

4. **Tile counts now accurate**: With the fixed completion detection, desktop shows 29-49 tiles (vs previous inaccurate 4-72), mobile shows 7-9 tiles

5. **Warm cache shows minimal improvement**: Due to browser isolation limitation, warm cache results are similar to cold

### Bottlenecks Identified

1. **No tile caching beyond browser cache**: Service worker could cache tiles across sessions
2. **No request prioritization**: All tiles treated equally, no prioritization of visible viewport tiles
3. **Network latency compounds**: Each tile is a separate request with full RTT
4. **Slow-3G is unusable**: 29s viewport load time indicates need for adaptive quality

## Optimization Predictions

| Optimization | Expected Impact | Affected Conditions |
|--------------|-----------------|---------------------|
| Service Worker (W1) | Reduce repeat visit load times by 60-80% | All conditions (repeat visits) |
| Request Prioritization (W2) | Reduce viewport complete by 20-30% | All conditions |
| Tile Batching (W3) | Reduce p95 variance, improve slow-3G | Throttled conditions |
| Adaptive Quality (W4) | Reduce slow-3G viewport time by 50%+ | Throttled conditions |

## Scenario Baselines

Scenario-based tests simulate realistic usage patterns. See `performance-scenarios.json` for raw data.

### Scenario A: Navigate-then-Z

Pan and zoom first, then Z-slide through planes. Measures Z-transition latency.

| Network | Z-trans p50 | Z-trans avg | Tiles/Z-change | Total tiles |
|---------|-------------|-------------|----------------|-------------|
| Unthrottled | | | | |
| Fast 3G | | | | |
| Slow 3G | | | | |

### Scenario B: Z-then-explore

Z-slide to middle first, then pan around. Measures cache hit rate.

| Network | Cache hit % | Pan p50 | Pan avg | Total tiles |
|---------|-------------|---------|---------|-------------|
| Unthrottled | | | | |
| Fast 3G | | | | |
| Slow 3G | | | | |

### Scenario C: Mixed browsing

Realistic mixed session: pan, zoom, Z-slide interleaved. Overall performance.

| Network | p50 latency | p95 latency | Z-trans avg | Total tiles |
|---------|-------------|-------------|-------------|-------------|
| Unthrottled | | | | |
| Fast 3G | | | | |
| Slow 3G | | | | |

## Raw Data

See `performance-baseline.json` for matrix test metrics.
See `performance-scenarios.json` for scenario test metrics.

## Methodology

- **Harness**: Playwright with Chrome DevTools Protocol for network throttling
- **Mosaic**: 3x3x3-test (small 3D mosaic for consistent testing)
- **Metrics**: PerformanceResourceTiming API for accurate tile latency
- **Viewport completion**: OpenSeadragon's `fully-loaded-change` event (accurate detection)
- **Scenarios**: Run via `npm run perf-test -- --scenario <A|B|C|all>`
  - Scenario A: Navigate-then-Z (pan/zoom, then Z-slide through 5 planes)
  - Scenario B: Z-then-explore (Z-slide to middle, then pan to 4 areas)
  - Scenario C: Mixed browsing (realistic interleaved pan/zoom/Z operations)
