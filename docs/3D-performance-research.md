# 3D Viewer Performance Research

Deep investigation into achieving smooth, microscope-like 3D viewing performance for evostitch web viewer.

**Date:** 2026-01-16
**Branch:** 20250115-3D-performance-research

---

## Executive Summary

This document presents a comprehensive analysis of performance optimization opportunities for the evostitch 3D web viewer. The goal is to achieve near-seamless, physical microscope-like analog feel when zooming, panning, and navigating Z-planes.

**Key findings:**
1. The current W1-W4 optimizations are well-designed but operate within OpenSeadragon's architectural constraints
2. Fundamental performance gains require deeper integration: WebGL rendering, Web Workers for decoding, and server-side optimizations
3. The biggest opportunities are: (a) parallel tile decoding in workers, (b) WebGL-based rendering, (c) R2 edge caching configuration, and (d) image format optimization
4. Some lag may be inherent to the data volume; user experience improvements (loading indicators, progressive quality) can mitigate perceived lag

---

## Table of Contents

1. [Current Implementation Analysis](#1-current-implementation-analysis)
2. [Performance Bottleneck Analysis](#2-performance-bottleneck-analysis)
3. [State-of-the-Art Research](#3-state-of-the-art-research)
4. [Optimization Opportunities](#4-optimization-opportunities)
5. [Recommendations](#5-recommendations)
6. [Appendix: Research Sources](#appendix-research-sources)

---

## 1. Current Implementation Analysis

### 1.1 Architecture Overview

The evostitch 3D viewer uses:
- **OpenSeadragon 4.1** for tile rendering (Canvas 2D)
- **Multi-image world** with all Z-planes loaded, opacity-switched
- **Service Worker** (W1) for tile caching
- **Tile Prioritizer** (W2) with predictive Z-prefetch
- **Network Detection** (W3) for adaptive quality
- **Quality Adaptation** (W4) for slow network degradation
- **Blur-up Loader** for progressive tile resolution

### 1.2 Data Characteristics

**3x3x3 Test Dataset (small):**
- 9 tiles × 3 Z-planes = 27 tile sets
- ~13 MB per JPX file (JPEG 2000, compression ratio 5)
- Total: ~111 MB

**Production 3D Dataset (SCH-55-22B_50xt_3D_test4):**
- 21 Z-planes × ~1,089 tiles/plane = ~22,869 tile pyramids
- DZI export: 542,955 tiles, 19 GB total
- Each Z-plane: ~1,000 high-resolution tiles at max zoom

### 1.3 Current Performance Profile

Based on the W1-W4 documentation:

| Optimization | Claimed Improvement | Mechanism |
|--------------|---------------------|-----------|
| Service Worker (W1) | ~80% faster repeat visits | Cache-first for immutable tiles |
| Tile Prioritizer (W2) | ~25% faster viewport completion | Current Z-plane prioritized |
| Predictive Z-Prefetch | ~94% faster Z-transition | Velocity-based prefetch depth |
| Blur-up Loading | ~88% faster time-to-first-visual | Low-res placeholders |

### 1.4 Identified Limitations

1. **OpenSeadragon Canvas 2D rendering** - CPU-bound, single-threaded
2. **Multi-image memory overhead** - 21 Z-planes × tiles = significant memory pressure
3. **Image decoding on main thread** - Browser JPEG decode blocks UI
4. **Network round-trip latency** - Each tile is a separate HTTP request
5. **R2 CDN configuration** - May not have optimal edge caching enabled

---

## 2. Performance Bottleneck Analysis

### 2.1 Rendering Pipeline Bottlenecks

```
User Input → Viewport Change → Tile Request → Network Fetch → JPEG Decode → Canvas Draw
   │              │                │               │              │            │
   └──────────────┴────────────────┴───────────────┴──────────────┴────────────┘
                              All on Main Thread
```

**Critical bottlenecks:**

1. **JPEG Decoding (30-200ms per tile):** Browser's native decoder runs on main thread. For a viewport showing 20+ tiles, this can cause 600-4000ms of decode time during rapid navigation.

2. **Canvas 2D Drawing:** Each `drawImage()` call synchronizes with the GPU, causing micro-stalls. With multiple Z-planes, even hidden planes consume memory.

3. **HTTP/1.1 Connection Limits:** Browsers limit concurrent connections per domain (typically 6). OpenSeadragon's `imageLoaderLimit` is capped at 4-6, creating a request queue.

4. **Memory Pressure:** 21 Z-planes with `maxImageCacheCount: 600` = potential for 12,600 cached tiles × ~20KB average = ~250MB tile cache, plus canvas memory.

### 2.2 Z-Stack Specific Issues

**Multi-Image World Overhead:**
From [OpenSeadragon Issue #180](https://github.com/openseadragon/openseadragon/issues/180):
> "After zooming and unzooming for a few minutes, the browser's RAM consumption can become close to 1GB, even when the total size of 11 Deep Zoom Images is only around 60MB."

**Opacity Switching Latency:**
When switching Z-planes, even with `setPreload(true)`, tiles must be:
1. Fetched (if not cached)
2. Decoded (always, unless using `createImageBitmap`)
3. Composited into the canvas

### 2.3 Quantified Bottleneck Estimates

For a 21-plane Z-stack viewed at high zoom (showing ~30 tiles in viewport):

| Operation | Estimated Time | Blocking? |
|-----------|----------------|-----------|
| Tile fetch (cache hit) | <5ms | No (async) |
| Tile fetch (cache miss, fast network) | 100-200ms | No (async) |
| JPEG decode (per tile) | 20-50ms | **Yes (main thread)** |
| Canvas drawImage (per tile) | 1-5ms | **Yes (main thread)** |
| Z-plane switch (20 visible tiles) | 400-1000ms decode | **Yes** |

---

## 3. State-of-the-Art Research

### 3.1 WebGL Rendering for Tile Viewers

**OpenSeadragon WebGL Proposal** ([Issue #1482](https://github.com/openseadragon/openseadragon/issues/1482)):
- Proposed replacing Canvas 2D with WebGL for GPU-accelerated rendering
- Benefits: Custom shaders, better memory management, parallel rendering
- Status: Closed in 2024, partial implementation exists but not default

**Key insight:** WebGL rendering provides:
- GPU-accelerated compositing (critical for Z-plane blending)
- Texture atlas optimization (batch multiple tiles into single draw call)
- Shader-based effects (smooth transitions, interpolation)

**Performance comparison** ([2D vs WebGL Canvas](https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/)):
- Initial WebGL setup: ~40ms (vs ~15ms for Canvas 2D)
- Per-frame render: 0.01ms WebGL vs 1.2ms Canvas 2D
- **100x faster re-renders** once initialized

### 3.2 Web Workers for Image Decoding

**createImageBitmap + Web Workers** ([Chrome Developer Blog](https://developer.chrome.com/blog/createimagebitmap-in-chrome-50)):
- Decode images off main thread using `createImageBitmap()` in a Worker
- Transfer decoded `ImageBitmap` to main thread via `postMessage([bitmap], [bitmap])`
- **Eliminates decode jank** on main thread

**Cross-browser considerations** ([Web Performance Calendar 2025](https://calendar.perfplanet.com/2025/non-blocking-image-canvas/)):
- Chrome/Safari: Worker + fetch + blob + createImageBitmap works
- Firefox: Different behavior, may still block
- Recommended: Browser detection with appropriate strategy per engine

**Pattern:**
```javascript
// Worker code
fetch(url)
  .then(r => r.blob())
  .then(blob => createImageBitmap(blob))
  .then(bitmap => postMessage(bitmap, [bitmap]));
```

### 3.3 OffscreenCanvas for Parallel Rendering

**OffscreenCanvas** ([web.dev](https://web.dev/articles/offscreen-canvas)):
- Render to canvas in Web Worker without blocking main thread
- Transfer rendered frames to visible canvas
- **Enables parallel rendering pipeline**

**Use case for tiles:**
1. Worker pool decodes tiles in parallel
2. Each worker renders decoded tiles to OffscreenCanvas
3. Transfer ImageBitmap to main thread
4. Main thread composites into viewer

### 3.4 Progressive Image Loading

**HTTP/2 + Progressive JPEG** ([Web Performance Calendar](https://calendar.perfplanet.com/2016/even-faster-images-using-http2-and-progressive-jpegs/)):
- Progressive JPEGs render at 25% data with full-image preview
- HTTP/2 multiplexing loads all progressive scans in parallel
- **50% faster time-to-visual-complete**

**Embedded Image Preview (EIP)** ([Smashing Magazine](https://www.smashingmagazine.com/2019/08/faster-image-loading-embedded-previews/)):
- Use HTTP Range requests to fetch initial progressive scan only
- Display blurry preview immediately
- Fetch remaining data for full quality

### 3.5 Modern Image Formats

**AVIF vs WebP vs JPEG** ([Photutorial](https://photutorial.com/image-format-comparison-statistics/)):

| Format | Size vs JPEG | Decode Speed | Browser Support |
|--------|--------------|--------------|-----------------|
| JPEG | baseline | fast | 100% |
| WebP | 25-34% smaller | fast | 95% |
| AVIF | 50% smaller | **slow** | 94% |

**Trade-off:** AVIF saves bandwidth but decode is CPU-intensive. For tile viewers, WebP may be better (fast decode, good compression).

**Resolution limits:**
- AVIF: 65536 × 65536 (with tiling artifacts at boundaries)
- WebP: 16383 × 16383

### 3.6 CDN and Network Optimization

**Cloudflare R2 Tiered Cache** ([Cloudflare Docs](https://developers.cloudflare.com/cache/how-to/tiered-cache/)):
- Smart Tiered Cache automatically places upper-tier near R2 bucket
- Edge caching reduces round-trip latency to ~50ms globally

**Tile batching strategy** ([PMTiles Discussion](https://github.com/protomaps/PMTiles/discussions/465)):
- Pack multiple tiles into single request
- Trade-off: Higher latency per tile but fewer round-trips
- Hilbert curve packing ensures spatially adjacent tiles are co-located

### 3.7 Request Scheduling

**requestIdleCallback + requestAnimationFrame** ([Chrome Developer Blog](https://developer.chrome.com/blog/using-requestidlecallback)):
- `requestIdleCallback`: Schedule low-priority work (prefetch) during idle
- `requestAnimationFrame`: Schedule visual updates before repaint
- **Prevents UI jank** from background tile loading

---

## 4. Optimization Opportunities

### 4.1 Immediate Opportunities (Low Risk, Moderate Impact)

#### 4.1.1 Enable R2 Edge Caching

**Current state:** Tiles served from R2 public URL; unclear if edge cache enabled.

**Opportunity:** Configure Cloudflare Cache Rules for tiles:
- Set `Cache-Control: public, max-age=31536000, immutable`
- Enable Smart Tiered Cache for R2 bucket
- Configure custom domain with CDN caching enabled

**Expected impact:** 30-50% reduction in cache-miss latency globally.

#### 4.1.2 Increase HTTP Concurrency

**Current state:** `imageLoaderLimit: 4-6`

**Opportunity:** With HTTP/2, browsers can multiplex many requests. Consider:
- Increase to 10-12 concurrent requests
- Use `requestIdleCallback` for prefetch requests to avoid UI contention

**Expected impact:** Faster viewport completion, especially on fast networks.

#### 4.1.3 Optimize Service Worker LRU

**Current state:** 5000 tile cache limit, LRU eviction via delete+put on every hit.

**Opportunity:**
- Increase cache limit for high-memory devices (10,000+ tiles)
- Batch LRU updates instead of per-hit
- Prioritize current Z-plane tiles in cache (never evict visible tiles)

**Expected impact:** Better cache hit rates for Z-navigation.

### 4.2 Medium-Term Opportunities (Moderate Risk, High Impact)

#### 4.2.1 Web Worker Tile Decoding

**Implementation approach:**
1. Create pool of 4-8 Web Workers
2. Intercept OpenSeadragon tile requests
3. Fetch and decode tiles in workers using `createImageBitmap(blob)`
4. Transfer `ImageBitmap` to main thread
5. Pass to OpenSeadragon for drawing

**Complexity:** Medium - requires custom tile source or OSD integration

**Expected impact:** Eliminate 90%+ of main-thread decode blocking.

**Reference implementation:** [WebGL Fundamentals - Background Image Loading](https://webglfundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html)

#### 4.2.2 WebGL-Based Tile Rendering

**Options:**

1. **OpenSeadragon WebGL Drawer** - Partial support exists, needs testing
2. **Custom WebGL Compositor** - Render tiles as GPU textures, composite with shaders
3. **pixi.js or Three.js Integration** - Use established WebGL libraries

**Benefits:**
- GPU-accelerated compositing
- Smooth Z-plane transitions (alpha blending in shader)
- Texture atlas batching (fewer draw calls)

**Complexity:** High - significant development effort

**Expected impact:** 10x faster render loop, smooth animations.

#### 4.2.3 Image Format Migration (WebP)

**Approach:**
1. Generate DZI tiles as WebP instead of JPEG
2. Maintain JPEG fallback for old browsers
3. Use `<picture>` srcset or server-side content negotiation

**Benefits:**
- 25-34% smaller tiles = faster network transfer
- WebP decode speed comparable to JPEG
- Supports alpha channel (potential for masking)

**Complexity:** Low (core pipeline change) to Medium (viewer fallback logic)

**Expected impact:** 25-34% reduction in network transfer time.

### 4.3 Long-Term Opportunities (High Risk, Transformative Impact)

#### 4.3.1 Single-File Tile Archive (SISF/PMTiles)

**Concept:** Pack all tiles for a Z-stack into single file with internal index.

**Benefits:**
- Single HTTP connection for entire mosaic
- Seek to specific tile via byte range requests
- Eliminates per-tile HTTP overhead

**Reference:** [SISF Format](https://www.researchgate.net/publication/384641079) handles 37 teravoxels.

**Complexity:** Very high - requires new format, server support, viewer integration

#### 4.3.2 Virtual Focus / Z-Interpolation

**Concept:** Instead of discrete Z-planes, interpolate between planes in shader.

**Benefits:**
- Smooth focus wheel experience (no discrete steps)
- Reduced tile loading (only load bounding planes)
- True microscope-like feel

**Complexity:** Very high - requires WebGL, custom shaders, significant UX work

#### 4.3.3 Iris/IrisTileSource Integration

**From research:** [Iris RESTful Server](https://arxiv.org/abs/2508.06615) achieves 5000+ tile requests/second with 21ms median latency.

**Potential:** If migrating to Iris format, could significantly improve server-side performance.

---

## 5. Recommendations

### 5.1 Priority Matrix

| Optimization | Impact | Effort | Risk | Priority |
|--------------|--------|--------|------|----------|
| R2 Edge Caching Config | Medium | Low | Low | **P0** |
| Increase HTTP Concurrency | Low-Medium | Low | Low | **P0** |
| Web Worker Decoding | High | Medium | Medium | **P1** |
| WebP Tile Format | Medium | Low-Medium | Low | **P1** |
| WebGL Rendering | Very High | High | Medium | **P2** |
| Tile Archive Format | Very High | Very High | High | **P3** |

### 5.2 Recommended Implementation Order

**Phase 1: Quick Wins (1-2 days)**
1. Verify/configure R2 edge caching with appropriate headers
2. Increase `imageLoaderLimit` to 10-12 on fast networks
3. Add loading state indicators for user feedback during tile loads

**Phase 2: Core Performance (1-2 weeks)**
1. Implement Web Worker tile decoding pool
2. Migrate tile format from JPEG to WebP
3. Optimize service worker cache for Z-stack patterns

**Phase 3: Rendering Upgrade (2-4 weeks)**
1. Evaluate OpenSeadragon WebGL drawer
2. If insufficient, implement custom WebGL tile compositor
3. Add smooth Z-plane transitions via alpha blending

**Phase 4: Future Architecture (Research)**
1. Investigate single-file tile archive formats
2. Prototype virtual focus / Z-interpolation
3. Consider Iris format migration

### 5.3 Metrics to Track

| Metric | Current Baseline | Target |
|--------|------------------|--------|
| Time to first tile | ~100-200ms (cold) | <50ms (edge cached) |
| Time to viewport complete | ~1-2s (cold) | <500ms |
| Z-plane switch time | ~400-1000ms | <100ms |
| Main thread blocking | Unknown | <16ms per frame |
| Memory usage (21 Z-planes) | Unknown | <500MB |

### 5.4 User Experience Mitigations

While optimizing, improve perceived performance with:

1. **Loading skeleton** - Show grid pattern while tiles load
2. **Progressive blur-up** - Already implemented, verify effectiveness
3. **Z-navigation feedback** - Show "Loading plane X..." indicator
4. **Quality selector** - Let user choose performance vs quality trade-off
5. **Network speed indicator** - Show current connection quality

---

## Appendix: Research Sources

### OpenSeadragon Performance
- [WebGL Rendering Proposal #1482](https://github.com/openseadragon/openseadragon/issues/1482)
- [WebGL Rendering Speed #2533](https://github.com/openseadragon/openseadragon/issues/2533)
- [Multi-image Memory #180](https://github.com/openseadragon/openseadragon/issues/180)
- [Mobile Performance 5.0+ #2667](https://github.com/openseadragon/openseadragon/issues/2667)

### Web Workers and Image Decoding
- [OffscreenCanvas - web.dev](https://web.dev/articles/offscreen-canvas)
- [createImageBitmap in Chrome 50](https://developer.chrome.com/blog/createimagebitmap-in-chrome-50)
- [Non-blocking Image Canvas - Perf Calendar 2025](https://calendar.perfplanet.com/2025/non-blocking-image-canvas/)
- [Background Image Loading - WebGL Fundamentals](https://webglfundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html)

### Canvas and WebGL Performance
- [2D vs WebGL Canvas Performance](https://semisignal.com/a-look-at-2d-vs-webgl-canvas-performance/)
- [Faster WebGL with OffscreenCanvas - Evil Martians](https://evilmartians.com/chronicles/faster-webgl-three-js-3d-graphics-with-offscreencanvas-and-web-workers)

### Image Formats
- [AVIF vs WebP - ShortPixel](https://shortpixel.com/blog/avif-vs-webp/)
- [Image Format Comparison - Photutorial](https://photutorial.com/image-format-comparison-statistics/)
- [Modern Image Formats - Smashing Magazine](https://www.smashingmagazine.com/2021/09/modern-image-formats-avif-webp/)

### CDN and Network
- [R2 Edge Caching - Cloudflare Docs](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [Tiered Cache - Cloudflare Docs](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [PMTiles Optimization - GitHub Discussion](https://github.com/protomaps/PMTiles/discussions/465)

### Progressive Loading
- [HTTP/2 Progressive JPEG - Perf Calendar](https://calendar.perfplanet.com/2016/even-faster-images-using-http2-and-progressive-jpegs/)
- [Embedded Image Previews - Smashing Magazine](https://www.smashingmagazine.com/2019/08/faster-image-loading-embedded-previews/)
- [requestIdleCallback - Chrome Blog](https://developer.chrome.com/blog/using-requestidlecallback)

### Scientific Visualization
- [IMAGE-IN 3D Viewer - PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0279825)
- [Browser-based Large 3D Images - ResearchGate](https://www.researchgate.net/publication/384641079)
- [FlexTileSource - PubMed](https://pubmed.ncbi.nlm.nih.gov/34760328/)
- [Iris RESTful Server - arXiv](https://arxiv.org/abs/2508.06615)

---

## Conclusion

The evostitch 3D viewer has a solid foundation with the W1-W4 optimizations. To achieve truly smooth, microscope-like performance, the next level of optimization requires:

1. **Moving work off the main thread** via Web Workers for tile decoding
2. **GPU acceleration** via WebGL rendering instead of Canvas 2D
3. **Network optimization** via proper CDN configuration and modern image formats
4. **User experience improvements** to mask unavoidable latency

The performance ceiling for web-based 3D tile viewers is ultimately bounded by:
- Network bandwidth (tile download speed)
- GPU capability (texture upload and rendering)
- Browser memory limits (tile cache size)

With the recommended optimizations, a target of <100ms Z-plane transitions and 60fps panning/zooming is achievable on desktop systems with fast internet connections. For lower-resourced systems, the existing adaptive quality mechanisms (W3/W4) provide graceful degradation.
