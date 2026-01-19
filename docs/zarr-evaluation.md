# OME-Zarr vs DZI Performance Evaluation

Comparative analysis of Z-stack viewing performance between OME-Zarr (Viv/deck.gl) and DZI (OpenSeadragon) approaches.

**Date:** 2026-01-17
**Status:** Complete (Phase 6)

---

## Z-Switch Latency Comparison

### Test Methodology

**Zarr Viewer (zarr-viewer.html)**
- Data: IDR v0.3 OME-Zarr (6001240.zarr) - 271×275 px, 236 Z-planes, 2 channels
- Measurement: Built-in `perfStartZSwitch()` / `perfEndZSwitch()` timing via `onViewportLoad` callback
- Test: 10 Z-plane switches across range (0→50→100→150→200→150→100→50→0→118→200)

**DZI Viewer (viewer.html)**
- Data: 3x3x3-test mosaic - 3 Z-planes, DZI tile pyramid
- Measurement: Tile telemetry via `evostitch.telemetry.getStats()`
- Architecture: Multi-image world with opacity switching, predictive Z-prefetch (W2)

### Results

| Metric | Zarr Viewer | DZI Viewer |
|--------|-------------|------------|
| **Cold Z-switch** | 485-514ms | ~400-1000ms* |
| **Warm Z-switch** | 39-57ms | Near-instant† |
| **Average** | 272ms (mixed) | Varies by prefetch |
| **p50** | 484ms | N/A |
| **p95** | 514ms | N/A |

\* DZI cold Z-switch depends on viewport tile count. For ~20 visible tiles at ~144ms/tile avg, theoretical cold load is 400-1000ms before prefetch optimization.

† DZI viewer uses opacity toggle for Z-switching when tiles are prefetched. Adjacent Z-planes (±1-5) are preloaded based on navigation velocity (W2 tile prioritizer).

### Key Observations

1. **Zarr benefits from chunked loading**: OME-Zarr loads only the needed Z-plane chunk, making cold loads predictable and independent of total Z-depth. Switching from Z=0 to Z=200 takes the same time as Z=0 to Z=1.

2. **DZI benefits from prefetch**: The tile prioritizer (W2) preloads adjacent Z-planes, making sequential Z-navigation feel instant. However, large Z-jumps incur full tile load latency.

3. **Warm cache performance**: Both approaches show dramatic improvement with warm caches:
   - Zarr: ~40-60ms (browser cache hit)
   - DZI: Near-instant (tiles already in OpenSeadragon world)

4. **Data size matters**: The IDR demo is a small image (271×275 px per Z-plane). Production evostitch mosaics are much larger (~thousands of tiles per Z-plane), which would increase DZI cold load times but not Zarr chunk loads.

### Architecture Comparison

| Aspect | Zarr (Viv/deck.gl) | DZI (OpenSeadragon) |
|--------|-------------------|---------------------|
| **Rendering** | WebGL (GPU) | Canvas 2D (CPU) |
| **Z-plane loading** | On-demand chunks | All planes preloaded |
| **Memory model** | Load what's visible | Multi-image world |
| **Prefetch strategy** | None (single Z) | Predictive (W2) |
| **Format efficiency** | Cloud-optimized chunks | Individual tile files |

### Implications for evostitch

1. **Large Z-stacks favor Zarr**: For 20+ Z-plane mosaics, Zarr's on-demand loading avoids preloading hundreds of tile sets.

2. **Sequential navigation favors DZI**: The W2 prefetch makes slow Z-scrubbing feel smooth. Zarr could implement similar prefetch.

3. **Random access favors Zarr**: Jumping to arbitrary Z-planes is O(1) with Zarr vs O(tiles) with DZI.

4. **Memory efficiency favors Zarr**: Zarr only loads visible Z-plane data. DZI preloads multiple Z-planes in memory.

---

## Completed Evaluations

- [x] Smooth fade transitions (Phase 5.4) - Implemented CSS opacity transitions
- [x] Jank prevention (Phase 5.5) - Throttled DOM updates during zoom/pan
- [x] Multi-channel controls (Phase 5.6) - Brightness/contrast sliders per channel
- [x] Chrome cross-browser testing (Phase 6.3) - All features verified via Playwright

**Pending:**
- [ ] Test with evostitch Zarr data when available (Phase 4 blocked on data)
- [ ] Firefox/Safari testing (not available on Linux development machine)

---

## Recommendation

### For evostitch 3D Microscopy Viewing

**Use OME-Zarr (Viv/deck.gl) as the primary viewer for Z-stack mosaics.**

#### Rationale

1. **Scalability**: Zarr's chunked loading handles large Z-stacks (100+ planes) without preloading all tile pyramids. Memory usage is proportional to viewport, not dataset size.

2. **Random Access Performance**: Z-plane jumps are O(1) regardless of distance. Critical for exploring 3D structures where users jump between distant planes.

3. **Cloud-Native Design**: OME-Zarr is designed for cloud storage (R2/S3). Chunked format enables efficient HTTP range requests and CDN caching.

4. **Modern WebGL Rendering**: deck.gl provides GPU-accelerated rendering with smooth zoom/pan. Channel blending is hardware-accelerated.

5. **Standard Format**: OME-Zarr is becoming the standard for bioimaging data. Ensures compatibility with OME ecosystem tools.

#### When to Keep DZI

- **2D Mosaics**: Single-plane mosaics without Z-stacks work well with OpenSeadragon
- **Sequential Z-Navigation**: If users primarily scroll through adjacent planes, DZI's prefetch optimization (W2) may feel smoother
- **Existing Infrastructure**: Mosaics already processed to DZI format

#### Implementation Path

1. ✅ **Phase 1-5**: Zarr viewer implemented with full features
2. ✅ **Phase 6.1-6.2**: Catalog integration complete
3. ⏳ **Phase 4**: Integrate evostitch Zarr data when available
4. 🔄 **Future**: Consider Zarr-first processing pipeline for new Z-stacks

---

## Console APIs for Testing

### Zarr Viewer

```javascript
// Get Z-switch performance stats
evostitch.zarrViewer.getPerfStats()
// Returns: { sampleCount, avgMs, minMs, maxMs, p50Ms, p95Ms, lastMs }

// Log summary to console
evostitch.zarrViewer.logPerfSummary()

// Clear stats
evostitch.zarrViewer.clearPerfStats()
```

### DZI Viewer

```javascript
// Get tile load telemetry
evostitch.telemetry.getStats()
// Returns: { totals: { coldCount, coldAvgMs, warmCount, warmAvgMs }, byZoom: {...} }

// Get tile prioritizer state (including Z-prefetch info)
evostitch.tilePrioritizer.getState()
// Returns: { currentZ, prefetch: { zVelocity, predictedPlanes, ... } }
```
