# OME-Zarr 3D Viewer

WebGL-powered 3D microscopy viewer for OME-Zarr datasets using Viv/deck.gl.

## Quick Start

1. Open `zarr-viewer.html` in a browser
2. Default: Loads IDR v0.3 demo dataset (2-channel fluorescence, 236 Z-planes)
3. Use slider or arrow keys to navigate Z-stack

**Custom data:** `zarr-viewer.html?zarr=https://your-server.com/data.zarr`

## Features

| Feature | Description |
|---------|-------------|
| **Z-stack navigation** | Smooth slider + keyboard navigation through depth planes |
| **Zoom & pan** | Mouse wheel zoom, drag to pan, WebGL-accelerated |
| **Scale bar** | Dynamic scale bar in µm (auto-adjusts with zoom) |
| **Coordinates** | Real-time cursor position in µm |
| **Channel controls** | Per-channel visibility, brightness, and contrast |
| **Fade transitions** | Smooth opacity transitions between Z-planes |
| **Performance stats** | Built-in Z-switch timing instrumentation |

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
| `zarr` | `?zarr=mosaic_3d_zarr` | Load evostitch Zarr (relative to CDN) |
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
| [@hms-dbmi/viv](https://github.com/hms-dbmi/viv) | 0.18.2 | OME-Zarr loading & rendering |
| [@deck.gl/core](https://deck.gl/) | 9.0.38 | WebGL layer rendering |

Dependencies are bundled via esbuild: `npm run build:zarr`

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
| **Throttled scale bar** | 100ms minimum update interval during zoom/pan |
| **RAF batching** | Coordinate display uses requestAnimationFrame |
| **Chunked loading** | Only visible Z-plane data is loaded |
| **Fade transitions** | Opacity transitions mask tile loading latency |

### File Structure

```
web/
├── zarr-viewer.html        # Main viewer page
├── js/
│   └── zarr-viewer.js      # ES module (bundled entry point)
├── dist/
│   └── zarr-viewer-bundle.js  # Built bundle (Viv + deck.gl)
├── package.json            # Build configuration
└── docs/
    ├── zarr-viewer.md      # This file
    └── zarr-evaluation.md  # Performance comparison vs DZI
```

## Building

```bash
cd web
npm install
npm run build:zarr  # Creates dist/zarr-viewer-bundle.js
```

## Performance vs DZI Viewer

See [zarr-evaluation.md](zarr-evaluation.md) for detailed comparison.

**Summary:**
- **Zarr:** Better for large Z-stacks, random Z-access, memory efficiency
- **DZI:** Better for sequential Z-navigation with prefetch

| Metric | Zarr | DZI |
|--------|------|-----|
| Cold Z-switch | 485-514ms | 400-1000ms* |
| Warm Z-switch | 39-57ms | Near-instant† |

\* DZI varies by visible tile count
† DZI uses opacity toggle with prefetched tiles

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome | Tested |
| Firefox | Expected to work |
| Safari | Not tested |

Requires WebGL2 support for optimal rendering.

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
- Expected: Cold loads take 400-500ms
- Warm loads (same Z revisited) should be ~50ms
- Use `evostitch.zarrViewer.logPerfSummary()` to check timing
