# OME-Zarr Viewer Evaluation Findings

**Date:** 2026-01-18
**Test Data:** SCH-55-22B_50xt_3D_test4 (33x33x21 Z-stack)
**Original Format:** JPX-based DZI (~16 GB)
**Converted Format:** OME-Zarr via bioformats2raw

---

## Summary

The OME-Zarr/Viv viewer successfully loads and renders 3D microscopy data, proving the architecture works. However, several significant issues make it unsuitable for production use in its current form.

**Verdict:** Proof of concept successful, but not ready for production. Further optimization or alternative approaches needed.

---

## Issues Identified

### 1. File Size Explosion

| Format | Size | Notes |
|--------|------|-------|
| Original JPX/DZI | ~16 GB | Production format |
| OME-Zarr (lossless) | ~208 GB | First conversion attempt |
| OME-Zarr (compressed) | ~196 GB | zlib compression |

**Problem:** 12x size increase even with compression. This is unsustainable for storage costs and transfer times.

**Possible causes:**
- bioformats2raw may not use optimal compression settings
- Zarr chunk overhead
- Different compression algorithm than JPX (JPEG2000)

**Questions to investigate:**
- What compression does bioformats2raw use by default?
- Can we use more aggressive lossy compression (JPEG, WebP)?
- Is there a Zarr equivalent to JPEG2000 quality settings?

---

### 2. Over-Zoom Behavior

**Problem:** Viewer allows zooming past 100% (native resolution), showing pixelated/interpolated data. Makes it difficult to assess actual image quality.

**Expected:** Zoom should stop at native resolution, or clearly indicate when viewing beyond 100%.

**Impact:** Cannot accurately assess whether visible artifacts are:
- Compression artifacts from conversion
- Interpolation artifacts from over-zoom
- Original image quality issues

---

### 3. 2D Tile Loading Performance

**Problem:** Tile loading is noticeably slower than OpenSeadragon (OSD).

**Symptoms:**
- Tiles visibly appear in pieces across the screen
- Progressive loading pattern is distracting
- Not immersive or pleasing

**Positive:** Loading is "robust" - always completes (unlike previous DZI implementation that sometimes stalled).

**Comparison to OSD:**
- OSD feels more immediate
- OSD has better tile prioritization (center-out loading)
- OSD has smoother progressive refinement

---

### 4. Z-Navigation Performance

**Symptoms:**
- "Dimming" behavior during Z-switch (intentional fade transition)
- Loading is jerky but functional
- Once loaded, Z-slider movement is smooth but "flickery"

**Positive:**
- Dimming provides useful loading feedback
- Z-switching does work reliably

**Negative:**
- Flickering during Z-navigation is distracting
- Not the "instant" feel we hoped for

---

### 5. Large Viewport Performance Failure

**Problem:** At full-screen viewport sizes, viewer cannot reach stable loaded state.

**Symptoms:**
- Continuous loading, never completes
- Tiles keep refreshing/reloading
- Unusable for actual work

**Severity:** Critical - makes the viewer impractical for real use cases where users typically work full-screen.

**Possible causes:**
- Too many tiles requested simultaneously
- Tile priority/cancellation issues
- Memory pressure from large tile count
- Network request throttling

---

## What Worked Well

1. **Reliability:** Unlike previous DZI issues, the Zarr viewer consistently loads data without stalling
2. **Z-stack support:** Native 5D (TCZYX) support from OME-Zarr format
3. **Metadata:** Scale/resolution info preserved in Zarr metadata
4. **Architecture:** Viv/deck.gl WebGL rendering works
5. **Loading feedback:** Fade transition provides clear loading state indication

---

## Recommendations for Future Investigation

### Short-term
1. Investigate compression options to reduce file size
2. Add zoom limit to prevent over-zoom
3. Profile tile loading to identify bottlenecks

### Medium-term
1. Compare Zarr chunk sizes (current 512x512) with alternatives
2. Test with HTTP/2 or HTTP/3 for better parallel loading
3. Investigate Viv's tile prioritization options

### Long-term
1. Consider hybrid approach: keep JPX/DZI for 2D performance, use Zarr only for Z-metadata
2. Evaluate alternative viewers (Neuroglancer, webKnossos)
3. Consider server-side tile serving with caching layer

---

## Test Configuration

- **Browser:** Chrome (via local http server)
- **Network:** Local (localhost:8080)
- **Viewport:** Default and fullscreen
- **Data source:** R2 cloud storage (pub-db7ffa4b7df04b76aaae379c13562977.r2.dev)

---

## Related Documents

- [3D Streaming Tools Research](../../.ralph/research/3d-streaming-tools-report.md)
- [Zarr Viewer Documentation](zarr-viewer.md)
- [Original Zarr Evaluation](zarr-evaluation.md)
