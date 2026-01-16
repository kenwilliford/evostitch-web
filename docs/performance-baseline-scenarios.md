# Performance Baseline - Scenario Tests

**Dataset:** SCH-55-22B_50xt_3D_test4_33x33x21 (85,719 × 58,754 × 21 Z-planes, ~23K tiles)
**Captured:** 2026-01-15
**Branch:** `w1-w4-perf-optimizations` (pre-optimization baseline)

## Summary

This baseline captures performance metrics for realistic usage scenarios against the large 3D dataset.
These metrics serve as comparison points for W1-W4 optimization work.

## Scenario Results

### Scenario A: Navigate-then-Z

Pan to different area, zoom in, then Z-slide through planes.

| Network | Z-trans p50 | Z-trans p95 | Tile p50 | Tile p95 | Total Tiles |
|---------|-------------|-------------|----------|----------|-------------|
| Unthrottled | 2ms | 6ms | 107ms | 459ms | 233 |
| Fast-3G | 2ms | 13ms | 1976ms | 8431ms | 74 |

**Observations:**
- Z-transitions are extremely fast (~2ms) on both networks because tiles are pre-cached during initial navigation
- Fast-3G shows significantly higher tile latency (p50 1976ms vs 107ms) but loads fewer tiles in the test window
- Warm Z-transitions (revisiting planes) show 0 tiles loaded per transition

### Scenario B: Z-then-explore

Navigate to middle Z-plane, then explore via panning and zooming.

| Network | Z-trans p50 | Z-trans p95 | Tile p50 | Tile p95 | Cache Hit % | Total Tiles |
|---------|-------------|-------------|----------|----------|-------------|-------------|
| Unthrottled | 3ms | 3ms | 94ms | 582ms | 0% | 79 |
| Fast-3G | 3036ms | 3036ms | 3102ms | 3961ms | 57% | 656 |

**Observations:**
- Initial Z-slide takes ~3s on Fast-3G (waiting for viewport tiles)
- Fast-3G shows 57% cache hit rate during exploration (revisiting areas)
- Unthrottled shows 0% cache hits because operations complete faster than browser can populate cache metrics

### Scenario C: Mixed browsing

Realistic mixed usage: pan, zoom, Z-slide interleaved.

| Network | Z-trans p50 | Z-trans p95 | Tile p50 | Tile p95 | Total Tiles |
|---------|-------------|-------------|----------|----------|-------------|
| Unthrottled | 2ms | 2ms | 88ms | 407ms | 385 |
| Fast-3G | 1646ms | 1646ms | 3254ms | 8616ms | 22 |

**Observations:**
- Z-transitions on Fast-3G take ~1.6s (waiting for initial tiles at new plane)
- Fast-3G loads far fewer tiles in same time window (22 vs 385)
- p95 tile load on Fast-3G is 8.6s - significant user-facing delay

## Key Findings for Optimization

1. **Z-transition time (warm):** Already excellent on unthrottled (~2ms), but ~1.6s on Fast-3G
   - Opportunity: Pre-fetch adjacent Z-plane tiles to reduce cold transition time

2. **Tile cache hit rate:** 57% on Fast-3G exploration scenario
   - Opportunity: Service worker caching could improve this significantly

3. **Tile load latency (Fast-3G):** p95 = 8.4-8.6s
   - This is the primary bottleneck for perceived performance on slow networks
   - Opportunity: Request prioritization, adaptive quality

4. **Tiles loaded per session:** Varies significantly with network (74-656 tiles)
   - Fast-3G users see incomplete viewports during navigation
   - Opportunity: Prioritize visible viewport tiles

## Test Configuration

- Viewport: Desktop (1920×1080)
- Cache state: Cold (fresh browser context per scenario)
- Network profiles: Unthrottled, Fast-3G (1.6 Mbps, 150ms latency)
- Viewer URL: https://evostitch.net/viewer.html

## Raw Data

Full JSON results saved to `performance-scenarios.json`.
