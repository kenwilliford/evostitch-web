# Performance Baseline

Pre-optimization baseline metrics captured before W1-W6 improvements.

**Captured:** 2026-01-14T07:16:16.519Z
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
| Unthrottled | Cold | 413ms | 2108ms | 83ms | 161ms | 72 |
| Unthrottled | Warm* | 319ms | 2035ms | 75ms | 97ms | 72 |
| Fast 3G | Cold | 1756ms | 2669ms | 731ms | 760ms | 4 |
| Fast 3G | Warm* | 1694ms | 2651ms | 634ms | 660ms | 4 |
| Slow 3G | Cold | 6707ms | 8360ms | 3085ms | 3145ms | 4 |
| Slow 3G | Warm* | 6705ms | 8346ms | 3124ms | 3140ms | 4 |

### Mobile (375x812)

| Network | Cache | First Tile | Viewport Complete | p50 Load | p95 Load | Tiles |
|---------|-------|------------|-------------------|----------|----------|-------|
| Unthrottled | Cold | 346ms | 1043ms | 109ms | 150ms | 9 |
| Unthrottled | Warm* | 378ms | 1043ms | 121ms | 169ms | 9 |
| Fast 3G | Cold | 1829ms | 3143ms | 740ms | 1512ms | 9 |
| Fast 3G | Warm* | 1821ms | 3139ms | 723ms | 1510ms | 9 |
| Slow 3G | Cold | 6764ms | 8344ms | 2678ms | 2795ms | 6 |
| Slow 3G | Warm* | 6707ms | 7348ms | 3009ms | 3038ms | 3 |

\* Warm cache tests have limited accuracy due to browser isolation. See Known Limitations in architecture.md.

## Observations

### Key Findings

1. **Network is the primary bottleneck**: Time to first tile increases ~4x from unthrottled (413ms) to fast-3G (1756ms), and ~16x for slow-3G (6707ms)

2. **Mobile loads fewer tiles**: Desktop loads 72 tiles for initial viewport vs 9 for mobile. This is expected - smaller viewport = fewer visible tiles

3. **Throttled connections show severely limited tile loading**: Under fast-3G and slow-3G, only 3-6 tiles load within the test window. This may indicate timeout before viewport completion

4. **p50 and p95 are close under throttling**: Network latency dominates, so individual tile variance is low

5. **Warm cache shows minimal improvement**: Due to browser isolation limitation, warm cache results are similar to cold

### Bottlenecks Identified

1. **No tile caching beyond browser cache**: Service worker could cache tiles across sessions
2. **No request prioritization**: All tiles treated equally, no prioritization of visible viewport tiles
3. **Network latency compounds**: Each tile is a separate request with full RTT

## Optimization Predictions

| Optimization | Expected Impact | Affected Conditions |
|--------------|-----------------|---------------------|
| Service Worker (W1) | Reduce repeat visit load times by 60-80% | All conditions (repeat visits) |
| Request Prioritization (W2) | Reduce viewport complete by 20-30% | All conditions |
| Tile Batching (W3) | Reduce p95 variance, improve slow-3G | Throttled conditions |
| Adaptive Quality (W4) | Load more tiles under throttling | Throttled conditions |

## Raw Data

See `performance-baseline.json` for complete metrics including all 12 test conditions.

## Methodology

- **Harness**: Playwright with Chrome DevTools Protocol for network throttling
- **Mosaic**: 3x3x3-test (small 3D mosaic for consistent testing)
- **Metrics**: PerformanceResourceTiming API for accurate tile latency
- **Viewport settle**: 500ms with no new tiles = viewport complete
