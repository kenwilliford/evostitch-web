# 3D Viewer Roadmap

**Last updated:** 2026-02-18
**Status:** Post-Viv optimization phase complete. Strategic architecture decision pending.

---

## What We've Built (W7–W12 + JPEG Zarr)

The OME-Zarr viewer has received substantial investment since early 2026:

| Sprint | What Was Done |
|--------|--------------|
| W7 | Viv 0.19 + deck.gl 9 upgrade; zarrita for zarr loading |
| W8 | zarr-cache.js removed (SW is sole cache layer) |
| W9 | `refinementStrategy: 'best-available'` — old frame persists during Z-switch, no blank flash |
| W10 | Viewport-aware prefetch (only visible tiles + 2-tile margin) |
| W12 | Custom domain `data.evostitch.net`, HTTP/2, 1-year immutable chunk caching |
| JPEG zarr | Q=95 JPEG encoding, WASM libjpeg-turbo decoder (1–3ms per chunk) |
| UX | Zoom-gated Z-slider, seamless Z-focus UX, smart loading indicator |

**Current performance (real GPU browser, warm cache):** ~65ms Z-switch avg, ~88ms p50.
**Cold Z-switch:** ~300–400ms perceived (perceptible but not painful).

The 2D DZI viewer at viewer.html is **truly seamless** — Z-switches are imperceptible.
The 3D Zarr viewer is substantially improved but **not yet seamless** by the same standard.

---

## Why Further Viv Optimization Hits a Wall

The fundamental constraint is architectural:

> **Viv's `MultiscaleImageLayer` invalidates its entire tile cache on every Z-switch.**
> The `selections` field in `updateTriggers.getTileData` forces a full tile reload.

Every optimization we've implemented operates *around* this constraint:
- SW caching reduces network latency, but Viv still re-requests and re-processes all chunks
- WASM JPEG decoder reduces decode time, but Viv still triggers the reload pipeline
- `refinementStrategy: 'best-available'` hides the visual gap, but doesn't reduce actual latency

Forking Viv to add Z-plane texture persistence would be high-complexity and would couple us tightly to Viv's internals, which change across versions. Incremental Viv work is likely to yield diminishing returns from here.

---

## Strategic Direction: Custom WebGL Renderer

### The goal

Truly seamless Z-switching — imperceptible latency, comparable to a physical microscope focus wheel.

### Why it's achievable

The 2D viewer achieves seamless performance by rendering from a pre-loaded tile cache. The equivalent for 3D is: **pre-load Z-plane data as WebGL textures and hold them in GPU memory**. Z-switch then becomes a texture swap — sub-millisecond. No network round-trip, no Viv tile reload pipeline.

The data infrastructure already supports this:
- OME-Zarr on R2 with JPEG-compressed chunks (61 GB, 3.1× smaller than Blosc)
- WASM libjpeg-turbo decoder (1–3ms per 512×512 chunk)
- SW cache-first strategy (chunks served from browser cache after first load)
- HTTP/2 + CDN (parallel chunk fetching, 1-year immutable cache)

What's missing is a renderer that can hold the decoded data in persistent GPU texture memory across Z-switches.

### Architecture concept

```
OME-Zarr chunks (R2 / SW cache)
    ↓
WASM JPEG decode → Uint8Array
    ↓
WebGL texture upload → GPU memory
    ↓  (one-time per Z-plane per viewport position)
Texture atlas / per-Z texture cache
    ↓  (Z-switch = texture swap, sub-ms)
WebGL shader → render to canvas
```

Key difference from Viv: textures are *retained* in GPU memory across Z-switches. Loading is amortized over the background prefetch phase, not triggered on every Z-switch.

### Potential extensions

Once the base renderer exists:

| Feature | What It Enables |
|---------|-----------------|
| **Z-interpolation** | GPU shader interpolates between adjacent Z-planes → smooth "focus wheel" feel (no discrete steps) |
| **Depth of field** | Simulate optical focus falloff — the deeper planes blur as focus shifts |
| **Multi-plane MIP** | Maximum intensity projection from a ±N plane window |
| **Export** | Pre-render a Z-sweep to video for cinematic output |

These all become incremental shader changes on top of the base renderer.

### Options

1. **Custom renderer (recommended research direction)**
   - Build a bespoke WebGL2 tiled pyramid renderer, specifically for single-channel Z-stacks
   - Fine-grained control over texture lifecycle and Z-plane caching
   - No Viv dependency; can evolve independently
   - Build on top of the existing OME-Zarr data format + WASM decoder

2. **deck.gl custom layer**
   - Write a custom deck.gl `Layer` that manages its own GPU texture cache
   - Keep deck.gl for interaction (pan/zoom/orthographic view)
   - Medium complexity; would still depend on deck.gl's rendering loop

3. **Viv fork**
   - Modify Viv's `MultiscaleImageLayer` to support Z-plane texture retention
   - Highest compatibility, but ties us to Viv's internals
   - Not recommended unless options 1/2 prove infeasible

### Research questions before committing

Before writing the renderer, answer these:

1. **GPU memory budget:** How many bytes does one Z-plane at full resolution require as WebGL textures? Can we hold 21 planes at once? (Target: stay within 2–4 GB VRAM, the typical WebGL budget)
2. **Texture upload speed:** How fast can we upload decoded WASM bytes to a WebGL texture? Is this fast enough for background prefetch during navigation?
3. **Existing libraries:** Is there a lightweight WebGL tiled image viewer (not Viv, not OSD) we could fork rather than build from scratch?
4. **Tile pyramid + textures:** How to handle multi-resolution (high zoom needs full-res tiles, low zoom uses coarser levels)? WebGL texture mipmaps may handle this.
5. **Channel support:** The current dataset is single-channel (grayscale). Multi-channel support (evostitch future) would complicate the texture management.

---

## Open Issues — Current Status

### Close (work already done)

| Issue | Reason to Close |
|-------|----------------|
| #38 HTTP/2 verification | Confirmed `h2` protocol during W12; custom domain live |
| #40 Cache headers audit | 1-year immutable headers on chunks, 1h on metadata — set via Cloudflare Transform Rules during W12 |

### Deprioritize: OBE or superseded

| Issue | Status |
|-------|--------|
| #25 Placeholder & skeleton foundation | W9's `refinementStrategy: 'best-available'` keeps old frame visible during Z-switch — this *is* the skeleton. Moot for Zarr viewer. |
| #35 Skeleton tiles during load | Same — old frame is already the visual placeholder. |

### Deprioritize: Hold pending architecture decision

These are valid goals but the implementation will differ significantly depending on whether we use Viv or a custom renderer. Doing them now on Viv is likely throwaway work.

| Issue | Notes |
|-------|-------|
| #31 Keyboard hold-to-animate | Right direction; re-evaluate once renderer decision made |
| #32 Touch/mouse hold controls | Depends on #31 |
| #33 Animation frame rate control | Depends on renderer — 10fps target may be conservative if Z-switch becomes sub-ms |
| #34 Range boundary feedback | Valid UX regardless; low effort, can do anytime |
| #30 Progressive loading UI | Still useful; implement when returning to 3D |
| #41 Auto-loop toggle | Depends on animation performance |
| #42 Loop preparation phase | Depends on animation performance |
| #43 Cinematic mode foundation | Long-term; natural extension of custom renderer |

### Still active (independent of renderer decision)

| Issue | Notes |
|-------|-------|
| #39 SW strategic caching | Mostly done (10K zarr chunk LRU). If specific gaps emerge after testing, revisit. |
| #37 Mobile touch optimization | Independent of renderer — touch UX improvements are always valid |

---

## Next Steps

1. **Complete 2D pipeline production readiness** (immediate, see sprint plan)
2. **Research phase (1–2 sessions):** Answer the GPU memory and texture upload questions above. Prototype a minimal WebGL2 tiled renderer for a single Z-plane, measure texture swap time.
3. **Architecture decision:** Based on research, decide between options 1/2/3 above.
4. **Renderer sprint:** Implement the chosen approach, targeting sub-100ms warm Z-switch and true seamlessness on repeat navigation.
5. **Re-evaluate animation issues** (#31–34, #41–43) in context of new renderer.

---

## Reference

- [zarr-viewer.md](zarr-viewer.md) — current Viv-based viewer documentation
- [3D-performance-research.md](3D-performance-research.md) — SOTA research from Jan 2026 (OSD/DZI era; foundational research on WebGL, Workers, PMTiles still relevant)
- [performance.md](performance.md) — W7–W12 benchmark results and numeric gates
