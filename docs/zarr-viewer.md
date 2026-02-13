# OME-Zarr 3D Viewer

WebGL-powered 3D microscopy viewer for OME-Zarr datasets using Viv/deck.gl.

## Quick Start

1. Open `zarr-viewer.html` in a browser
2. Default: Loads IDR v0.3 demo dataset (2-channel fluorescence, 236 Z-planes)
3. Use slider or arrow keys to navigate Z-stack

**Custom data:** `zarr-viewer.html?zarr=https://your-server.com/data.zarr`

**evostitch data:** Served from `data.evostitch.net` (Cloudflare R2 custom domain, HTTP/2)

## Features

| Feature | Description |
|---------|-------------|
| **Z-stack navigation** | Smooth slider + keyboard navigation through depth planes |
| **Zoom & pan** | Mouse wheel zoom, drag to pan, WebGL-accelerated |
| **Scale bar** | Dynamic scale bar in µm (auto-adjusts with zoom) |
| **Coordinates** | Real-time cursor position in µm |
| **Channel controls** | Per-channel visibility, brightness, and contrast |
| **No-blank-flash Z-switches** | Old Z-plane stays visible as placeholder until new data loads (refinementStrategy: 'best-available') |
| **Viewport-aware prefetch** | Only prefetches chunks in viewport + 2-tile margin, reducing bandwidth |
| **SW caching** | Service worker caches zarr chunks (cache-first, 10K entry limit) |
| **Performance stats** | Built-in Z-switch timing + prefetch monitoring instrumentation |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate Z-stack up/down |
| `+` / `=` | Zoom in |
| `-` / `_` | Zoom out |
| `h` / `H` | Reset view (home) |

## URL Parameters

| Parameter | Example | Description |
|-----------|---------|-------------|
| `zarr` | `?zarr=mosaic_3d_zarr_v2` | Load evostitch Zarr (relative to CDN) |
| `zarr` | `?zarr=https://...` | Load external OME-Zarr (full URL) |

**Default:** Loads IDR v0.3 OME-Zarr demo when no parameter specified.

## User Interface

### Header
- **Back link:** Return to mosaic catalog
- **Compare link:** Side-by-side comparison with DZI viewer
- **Fullscreen button:** Toggle fullscreen mode

### Scale Bar (bottom left)
- Shows physical distance in µm or mm
- Automatically selects "nice" values (1, 2, 5, 10, 20, 50, 100µm, etc.)
- Updates dynamically as you zoom

### Coordinates (bottom center)
- Shows cursor position: `X: 123.4 µm, Y: 567.8 µm, Z: 42/236`
- When not hovering, shows Z-position only

### Zoom Controls (top right)
- `+` Zoom in
- `−` Zoom out
- `⌂` Reset view to initial state

### Channel Controls (top left)
- Collapsible panel showing all channels
- Per channel:
  - **Checkbox:** Toggle visibility
  - **Color swatch:** Channel color (from OME metadata)
  - **B slider:** Black point / brightness
  - **C slider:** White point / contrast
  - **Reset:** Restore default values

### Z-Slider (bottom)
- Drag slider to navigate Z-stack
- Shows current depth in µm
- Shows plane index: `(42/236)`

## Console API

Access viewer internals for debugging via `evostitch.zarrViewer`:

### Navigation

```javascript
// Set Z-plane (0-indexed)
evostitch.zarrViewer.setZ(100)

// Zoom
evostitch.zarrViewer.zoomIn(0.5)   // Step size optional
evostitch.zarrViewer.zoomOut(0.5)

// Reset view to initial centered state
evostitch.zarrViewer.resetView()
```

### State Inspection

```javascript
// Get current viewer state
evostitch.zarrViewer.getState()
// Returns: { initialized, currentZ, zCount, hasLoader, hasDeck, metadata }

// Get channel settings
evostitch.zarrViewer.getChannelSettings()
// Returns: [{ visible, min, max, defaultMin, defaultMax }, ...]
```

### Channel Controls

```javascript
// Toggle channel visibility
evostitch.zarrViewer.setChannelVisible(0, false)  // Hide channel 0

// Adjust contrast (black point, white point)
evostitch.zarrViewer.setChannelContrast(0, 500, 30000)

// Reset all channels to defaults
evostitch.zarrViewer.resetChannels()
```

### Performance Measurement

```javascript
// Get Z-switch timing stats
evostitch.zarrViewer.getPerfStats()
// Returns: { sampleCount, avgMs, minMs, maxMs, p50Ms, p95Ms, lastMs }

// Log summary to console
evostitch.zarrViewer.logPerfSummary()

// Clear stats
evostitch.zarrViewer.clearPerfStats()
```

### Prefetch Monitoring

```javascript
// Get prefetch stats (viewport-aware prefetch + late fetch tracking)
evostitch.zarrPrefetch.getStats()
// Returns: { hits, misses, prefetched, aborted, errors,
//            lateFetchCount, totalZSwitches, prefetchedBytes,
//            prefetchedBytesPerZSwitch, prefetchedPlanes, pendingFetches,
//            velocity, currentZ, zCount, resolutionLevels, ... }

// Toggle debug logging
evostitch.zarrPrefetch.setDebug(true)
```

### Service Worker Cache

```javascript
// Get SW zarr cache stats
evostitch.sw.getStats()     // Returns: { size, maxEntries, ... }

// List cached URLs
evostitch.sw.getCacheContents()

// Clear zarr cache (forces re-fetch from CDN)
evostitch.sw.clearCache()

// Check if SW is active
evostitch.sw.isActive()     // Returns: true/false
```

### Transitions

```javascript
// Enable/disable smooth Z-plane transitions
evostitch.zarrViewer.setZTransition(true)   // Enable
evostitch.zarrViewer.setZTransition(false)  // Disable
```

### Debug Logging

```javascript
// Enable verbose logging
evostitch.zarrViewer.setDebug(true)
```

## Technical Architecture

### Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| [@hms-dbmi/viv](https://github.com/hms-dbmi/viv) | 0.19.0 | OME-Zarr loading & rendering |
| [deck.gl](https://deck.gl/) | ~9.1.11 | WebGL layer rendering |
| [@luma.gl/*](https://luma.gl/) | ~9.1.9 | WebGL2 abstraction (peer dep of deck.gl 9) |
| [@math.gl/*](https://math.gl/) | ^4.0.1 | Math utilities (peer dep of deck.gl 9) |

Dependencies are bundled via esbuild: `npm run build:zarr`

> **Note:** Requires WebGL2 (all modern browsers). deck.gl 9 dropped WebGL1 support.

### Rendering Pipeline

```
OME-Zarr URL
    ↓
loadOmeZarr() → metadata + chunked data loader
    ↓
MultiscaleImageLayer → WebGL rendering
    ↓
deck.gl OrthographicView → pan/zoom control
    ↓
Canvas → display
```

### OME-Zarr Metadata

The viewer extracts from OME-Zarr `.zattrs`:

1. **Axes:** Dimension order (typically `['t', 'c', 'z', 'y', 'x']`)
2. **Coordinate transforms:** Pixel sizes in µm (for scale bar and coordinates)
3. **Omero metadata:** Channel names, colors, and contrast windows

### Performance Optimizations

| Optimization | Purpose |
|--------------|---------|
| **refinementStrategy: 'best-available'** | Old Z-plane tiles stay visible as placeholders during Z-switch (no blank flash) |
| **Viewport-aware prefetch** | Only prefetches chunks in viewport + 2-tile margin, not the entire Z-plane |
| **SW cache-first** | Service worker (v1.4.1) intercepts zarr chunk fetches, serves from cache before network |
| **Z-switch debounce** | 50ms debounce prevents redundant tile reloads during rapid Z-slider dragging |
| **Smart loading indicator** | 150ms delay prevents flash on fast loads |
| **Throttled scale bar** | 100ms minimum update interval during zoom/pan |
| **RAF batching** | Coordinate display uses requestAnimationFrame |
| **Chunked loading** | Only visible Z-plane data is loaded |
| **HTTP/2 + custom domain** | `data.evostitch.net` via Cloudflare with immutable chunk caching (1yr TTL) |

### File Structure

```
web/
├── zarr-viewer.html           # Main viewer page (IIFE script tags + ES module)
├── sw.js                      # Service worker v1.4.1 (zarr chunk caching)
├── js/
│   ├── zarr-viewer.js         # ES module: init, Z-nav, channel controls, deck.gl setup
│   ├── zarr-prefetch.js       # IIFE: viewport-aware Z-plane prefetching
│   ├── zarr-render-opt.js     # IIFE: Z-debounce (50ms), zoom capping
│   ├── zarr-viewport-math.js  # IIFE: shared viewport math (zoomToLevel, viewStateToBounds, boundsToTileRange)
│   ├── zarr-3d-loader.js      # IIFE: "Load 3D" mode (viewport-scoped prefetch)
│   ├── zarr-perf-test.js      # Performance test runner
│   └── loading-indicator.js   # IIFE: smart loading indicator (150ms delay)
├── dist/
│   └── zarr-viewer-bundle.js  # Built bundle (Viv 0.19 + deck.gl 9)
├── build/
│   └── bundle-zarr-viewer.js  # esbuild script
├── package.json               # Build configuration + dependencies
└── docs/
    ├── zarr-viewer.md         # This file
    ├── zarr-evaluation.md     # Performance comparison vs DZI
    ├── performance.md         # Benchmark results, numeric gates
    └── metadata-runbook.md    # CDN/SW cache invalidation procedures
```

**IIFE load order** (zarr-viewer.html): loading-indicator → zarr-viewport-math → zarr-prefetch → zarr-render-opt → zarr-3d-loader → zarr-viewer (ES module)

## Building

```bash
cd web
npm install
npm run build:zarr  # Creates dist/zarr-viewer-bundle.js
```

## Performance vs DZI Viewer

See [zarr-evaluation.md](zarr-evaluation.md) for detailed comparison.
See [performance.md](performance.md) for W7-W12 benchmark results and numeric gates.

**Summary:**
- **Zarr:** Better for large Z-stacks, random Z-access, memory efficiency
- **DZI:** Better for sequential Z-navigation with prefetch

| Metric | Zarr (W7-W12) | DZI |
|--------|---------------|-----|
| Cold Z-switch | avg 368ms, p95 458ms | 400-1000ms* |
| Warm Z-switch | avg ~65ms, p50 88ms | Near-instant† |

\* DZI varies by visible tile count
† DZI uses opacity toggle with prefetched tiles

## Caching Architecture

Two-layer cache: CDN (Cloudflare) + Service Worker (browser).

| Layer | Cache Name | Strategy | TTL |
|-------|-----------|----------|-----|
| CDN | Cloudflare edge | Chunks: immutable (1yr). Metadata: 1hr | Transform Rules |
| SW | `evostitch-zarr-v1.4.1` | Cache-first for chunks, network-first for metadata | 10K entry limit |

The SW recognizes both `data.evostitch.net` (primary) and `pub-*.r2.dev` (legacy) domains.

For cache invalidation procedures, see [metadata-runbook.md](metadata-runbook.md).

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome | Tested |
| Firefox | Expected to work |
| Safari | Not tested |

Requires WebGL2 (deck.gl 9 requirement). All modern browsers support WebGL2.

## Troubleshooting

### "Canvas shows black"
- Check browser console for WebGL errors
- Verify OME-Zarr URL is accessible (CORS headers required)
- Try with default demo data first

### "Tiles not loading"
- Check Network tab for 403/404 errors
- Verify CORS headers on data server
- Check if `.zattrs` is accessible

### "Slow Z-navigation"
- Expected: Cold loads avg ~370ms (p95 < 460ms)
- Warm loads (SW cached) avg ~65ms
- Use `evostitch.zarrViewer.logPerfSummary()` to check timing
- Use `evostitch.zarrPrefetch.getStats()` to check prefetch stats
- Use `evostitch.sw.getStats()` to check SW cache status
- Try `evostitch.sw.clearCache()` if stale data suspected
