# Tile Loading Research: Fixing 3D Stalls

Research findings from fixing tile loading stall behavior in the evostitch 3D viewer.

**Date:** 2026-01-16
**Branch:** `3d-tile-loading-stall-fix`

---

## Problem Statement

When using the 3D viewer at deep zoom with a stationary viewport (no user interaction), tiles would stop loading indefinitely. The vanilla 2D OpenSeadragon viewer loads tiles to completion under the same conditions. This document explains the root cause and the solution.

---

## 1. OpenSeadragon 2D Tile Loading Behavior

### 1.1 Event-Driven Architecture

OpenSeadragon's tile loading is event-driven. The core loading cycle:

```
User Input → Viewport Change → OSD Events → Tile Requests → Image Decode → Canvas Draw
```

Key events that trigger tile loading:
- `animation-start` / `animation` / `animation-finish` - viewport changes
- `pan` / `zoom` - user navigation
- `tile-loaded` / `tile-load-failed` - request completion

### 1.2 How 2D Loads Tiles to Completion

In vanilla 2D mode, OSD loads tiles continuously because:

1. **Viewport animations**: Even a "stop" after zooming includes a brief deceleration animation
2. **Draw cycle**: OSD's `requestAnimationFrame` loop continues until all visible tiles are loaded
3. **Self-sustaining queue**: Each `tile-loaded` event triggers checking for more needed tiles

The critical insight: **OSD assumes continuous event flow**. When events fire, tiles load. When events stop, loading stops.

### 1.3 2D Reference Behavior

Testing with `https://evostitch.net/viewer.html?mosaic=SCH-55-22B_50xt_global` (2D mosaic):
- Zoom to max, release mouse → all tiles load within seconds
- No intervention needed, OSD's internal loop handles completion

---

## 2. 3D Extension Architecture

### 2.1 Multi-Image World

The evostitch 3D viewer uses OSD's `world` container with multiple `TiledImage` instances:

```javascript
// Each Z-plane is a separate TiledImage
for (let z = 0; z < zCount; z++) {
    tileSources.push(`${TILES_BASE_URL}/${mosaicId}/z_${z}/mosaic.dzi`);
}

viewer = OpenSeadragon({ tileSources: tileSources });
```

All Z-planes are loaded into the world simultaneously. Only the current plane has `opacity: 1`; others have `opacity: 0` but remain active for prefetching.

### 2.2 Tile Prioritizer (tile-prioritizer.js)

The tile prioritizer intercepts OSD's `imageLoader.addJob()` to implement:

1. **Priority queue**: Viewport tiles before prefetch, current Z before adjacent
2. **Request throttling**: Lower limits during animation, higher when idle
3. **Z-aware prefetching**: Preload adjacent planes based on navigation velocity

```javascript
const PRIORITY = {
    VIEWPORT_CURRENT_Z: 1,   // Highest priority
    VIEWPORT_ADJACENT_Z: 2,
    PREFETCH: 3,
    DEFAULT: 2
};
```

### 2.3 The Stall Problem

When a user:
1. Zooms deep into a 3D mosaic
2. Changes Z-plane
3. Stops interacting (stationary viewport)

The following happens:
- OSD switches to the new TiledImage (opacity 1)
- The new plane needs tiles at high resolution
- **But no OSD events fire** - the viewport isn't changing
- `processQueue()` in tile-prioritizer is never called
- Tiles sit in the pending queue indefinitely

**Root cause**: Tile prioritizer wrapped `addJob()` but relied on OSD events to trigger `processQueue()`. When the viewport is stationary, no events fire, so the queue never drains.

---

## 3. The Heartbeat Solution

### 3.1 Design

Add a periodic heartbeat that processes the queue regardless of OSD events:

```javascript
const HEARTBEAT_INTERVAL_MS = 500;  // Process queue every 500ms
let heartbeatIntervalId = null;

function startHeartbeat() {
    if (heartbeatIntervalId !== null) return;  // Already running

    heartbeatIntervalId = setInterval(function() {
        if (pendingJobs.length > 0) {
            processQueue();
        } else {
            stopHeartbeat();  // Queue drained, stop polling
        }
    }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
    if (heartbeatIntervalId === null) return;
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
}
```

### 3.2 Lifecycle

1. **Start**: Heartbeat starts on first `addJob()` call
2. **Active**: Every 500ms, check `pendingJobs.length > 0`, call `processQueue()`
3. **Stop**: When queue drains (`pendingJobs.length === 0`), heartbeat self-terminates

### 3.3 Why 500ms?

- **Not too fast**: Avoids wasting cycles when OSD events are already firing
- **Not too slow**: Provides responsive loading when stationary
- **Self-limiting**: Only active when there's work to do

### 3.4 Verification

Playwright test confirms:
- Before fix: 0 tiles loaded in 30s at max zoom after Z-change
- After fix: 57+ tiles loaded during stationary phase, heartbeat active until queue drains

### 3.5 Resolution Detection and Fix

After the heartbeat ensures tiles load, a secondary problem remains: OSD may display low-resolution tiles (preloaded from adjacent planes) when zoomed in, even after tiles finish loading. This happens because OSD's coverage tracking thinks the viewport is covered with tiles, not knowing they're at the wrong resolution.

**Detection functions:**

```javascript
// Get highest tile level currently drawn on screen
function getDrawnTileLevel() {
    const ti = viewer.world.getItemAt(currentZ);
    let maxLevel = 0;
    for (const level in ti.tilesMatrix) {
        const tiles = ti.tilesMatrix[level];
        for (const x in tiles) {
            for (const y in tiles[x]) {
                if (tiles[x][y] && tiles[x][y].loaded) {
                    maxLevel = Math.max(maxLevel, parseInt(level));
                }
            }
        }
    }
    return maxLevel;
}

// Get tile level needed for ~1:1 pixel mapping at current zoom
function getNeededTileLevel() {
    const ti = viewer.world.getItemAt(currentZ);
    const zoom = viewer.viewport.getZoom(true);
    const containerWidth = viewer.container.clientWidth;
    const imageWidth = ti.source.width;
    const visiblePixels = containerWidth / zoom;
    const neededLevel = Math.ceil(Math.log2(imageWidth / visiblePixels));
    return Math.min(neededLevel, ti.source.maxLevel);
}

// Compare drawn vs needed level
function checkResolutionState() {
    const drawnLevel = getDrawnTileLevel();
    const neededLevel = getNeededTileLevel();
    return {
        drawnLevel,
        neededLevel,
        mismatch: drawnLevel < neededLevel
    };
}
```

**Fix mechanism:**

When heartbeat detects `drawnLevel < neededLevel`, it triggers a resolution fix:

```javascript
function triggerResolutionFix() {
    const ti = viewer.world.getItemAt(currentZ);

    // Clear OSD's coverage tracking (makes OSD think tiles are needed)
    ti._coverage = {};

    // Force redraw (triggers OSD to recalculate and request tiles)
    viewer.forceRedraw();
}
```

**Loop prevention:**

A 2-second cooldown prevents infinite loops. State resets on Z-plane change to allow immediate fix for the new plane.

```javascript
const resolutionFixState = {
    lastFixZ: -1,
    lastFixZoom: -1,
    lastFixTime: 0,
    cooldownMs: 2000
};
```

---

## 4. Related Fixes

### 4.1 Z-Plane Priority Fix

**Problem**: After Z-change, tiles got `PRIORITY.DEFAULT` instead of `PRIORITY.VIEWPORT_CURRENT_Z`.

**Root cause**: OSD's timing quirk - when `addJob()` is called for a tile, `tile.tiledImage` may be `undefined` even though the tile belongs to a valid TiledImage.

**Fix**: Fall back to parsing Z-plane from tile URL:

```javascript
function getZPlaneFromUrl(url) {
    // Match /z_XX/ pattern (e.g., /z_00/, /z_05/, /z_12/)
    const match = url.match(/\/z_(\d+)\//);
    if (match) {
        return parseInt(match[1], 10);
    }
    return -1;
}
```

### 4.2 Progressive Tile Loading After Z-Change

**Problem**: OSD preloading fills TiledImage cache with edge tiles (for pan), not viewport center tiles. After Z-change, OSD draws low-resolution tiles because correct high-res center tiles aren't loaded.

**Original workaround** (deprecated): Reset TiledImage cache and trigger zoom animation. This worked but caused visible zoom-out/zoom-in animation on every Z-change.

**Current fix** (via `triggerResolutionFix`): Clear OSD's coverage tracking and force redraw. This makes OSD recalculate tile needs without any visible animation:

```javascript
function triggerResolutionFix() {
    const ti = viewer.world.getItemAt(currentZ);

    // Clear OSD's coverage tracking (makes OSD think tiles are needed)
    ti._coverage = {};

    // Force redraw (triggers OSD to recalculate and request tiles)
    viewer.forceRedraw();
}
```

See Section 3.5 for the complete resolution detection and fix mechanism.

### 4.3 Loading Indicator Accuracy

**Problem**: `getFullyLoaded()` returns stale values after Z-plane changes.

**Fix**: Use viewport-based tile coverage calculation instead of trusting `getFullyLoaded()`:

```javascript
// Don't use: tiledImage.getFullyLoaded()
// Instead: calculate actual tile coverage
function calculateTileCoverageForPlane(tiledImage) {
    // Check tilesMatrix directly for loaded tiles at viewport positions
    // Returns 0-1 coverage ratio
}
```

---

## 5. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenSeadragon Viewer                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                        World                             │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐     ┌─────────┐   │   │
│  │  │TiledImg │ │TiledImg │ │TiledImg │ ... │TiledImg │   │   │
│  │  │ Z=0     │ │ Z=1     │ │ Z=2     │     │ Z=n     │   │   │
│  │  │opacity:0│ │opacity:1│ │opacity:0│     │opacity:0│   │   │
│  │  └─────────┘ └─────────┘ └─────────┘     └─────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                     ImageLoader.addJob()                        │
│                              │                                  │
│  ┌───────────────────────────▼──────────────────────────────┐  │
│  │              Tile Prioritizer (wrapped)                   │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │              Priority Queue                       │    │  │
│  │  │  [P1: viewport+currentZ] [P2: adjacent] [P3: far] │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  │                         │                                 │  │
│  │  ┌─────────────┐  ┌─────▼─────┐  ┌──────────────────┐   │  │
│  │  │ OSD Events  │  │processQueue│  │    Heartbeat     │   │  │
│  │  │ (animation, │──│           │──│ (500ms interval) │   │  │
│  │  │  tile-load) │  │           │  │ when queue > 0   │   │  │
│  │  └─────────────┘  └───────────┘  └──────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Key Learnings

### 6.1 OSD Assumptions

OpenSeadragon assumes:
- Continuous user interaction during critical loading phases
- Events flow from user input through the rendering pipeline
- The viewport is rarely "truly stationary" (animations, deceleration)

When extending OSD for 3D (multi-plane switching), these assumptions break down because:
- Z-plane changes are instantaneous (no animation)
- The viewport may be stationary during Z-changes
- Hidden planes need background loading

### 6.2 Wrapping vs. Extending

The tile prioritizer wraps `addJob()` rather than extending OSD's ImageLoader class. This is fragile because:
- It depends on OSD's internal timing
- Tile metadata (`tile.tiledImage`) may not be set when expected
- URL parsing becomes a necessary fallback

### 6.3 Trust But Verify

OSD's `getFullyLoaded()` method is unreliable after Z-plane switches because:
- It checks internal state that wasn't updated for opacity-switched images
- The loading indicator must use viewport-based coverage calculation instead

---

## 7. Test Coverage

| Test File | Purpose |
|-----------|---------|
| `tile-loading-stall.test.js` | Confirms tiles load when viewport stationary |
| `heartbeat-idle.test.js` | Confirms heartbeat deactivates when queue empty |
| `z-change-full-resolution.test.js` | Confirms Z-change reaches full resolution |
| `z-change-pan-zoom.test.js` | Confirms pan/zoom after Z-change works |
| `loading-indicator-smooth-progress.test.js` | Confirms 0→100% progress flow |
| `z-ring-coverage-accuracy.test.js` | Confirms Z ring uses actual coverage |

All tests use Playwright with the live site (`evostitch.net`) or local server.

---

## 8. Future Considerations

### 8.1 Preload Experience Button

A potential UX improvement: "Preload Experience" button that enables butter-smooth Z navigation by pre-caching tiles before the user explores.

#### What It Would Cache

1. **Current viewport, all Z-planes**: All tiles visible at current zoom for every Z-plane
   - If viewport shows 3x3 tiles at level 15, cache 9 tiles × 21 Z-planes = 189 tiles
   - Uses OSD's `setPreload(true)` to queue tiles for hidden (opacity:0) planes

2. **One level deeper for current Z**: Higher resolution tiles for the current plane
   - Anticipates user zooming in slightly after preload completes
   - ~4× more tiles per level (4 tiles replace each parent tile)

3. **Lower resolution backup for all Z**: Level 12-13 tiles for smooth zoom-out
   - Ensures zooming out during Z-scrubbing remains smooth
   - Small tile count (typically 1-4 tiles per plane)

#### UX Design

**Button placement**: Top-right controls, next to zoom buttons

**States**:
| State | Button appearance | Behavior |
|-------|-------------------|----------|
| Idle | "⚡ Preload" (outlined) | Click to start |
| Loading | Progress ring + percentage | Shows tiles cached / total |
| Complete | "✓ Ready" (solid green) | Click to re-preload |
| Error | "⚠ Retry" | Click to retry |

**Progress indication**:
- Ring fills 0→100% as tiles cache
- Text shows "42 / 189 tiles" count
- Fade out after 2s on completion

**Abort behavior**:
- Clicking during preload cancels (return to Idle)
- Navigation during preload continues preload in background
- Preload pauses if user actively navigating (yields to interactive priority)

#### Implementation Notes

```javascript
// Conceptual implementation
async function preloadExperience() {
    const totalPlanes = viewer.world.getItemCount();
    const currentViewport = viewer.viewport.getBounds();
    const currentLevel = getCurrentBestLevel();

    // Calculate total tiles to cache
    const tilesPerPlane = estimateTilesInViewport(currentLevel);
    const totalTiles = tilesPerPlane * totalPlanes;
    let loadedTiles = 0;

    // Preload each plane
    for (let z = 0; z < totalPlanes; z++) {
        const ti = viewer.world.getItemAt(z);

        // Force tiles at current viewport for this plane
        ti.setPreload(true);
        ti._needsDraw = true;
        viewer.forceRedraw();

        // Wait for tiles to load (with timeout)
        await waitForTilesCovered(ti, currentViewport, currentLevel, {
            timeout: 10000,
            onProgress: (loaded) => {
                loadedTiles += loaded;
                updateProgressUI(loadedTiles / totalTiles);
            }
        });
    }

    showComplete();
}

// Progress tracking uses tile coverage, not getFullyLoaded()
// (see Section 4.3 for why getFullyLoaded() is unreliable)
function waitForTilesCovered(tiledImage, bounds, level, options) {
    return new Promise((resolve, reject) => {
        const check = () => {
            const coverage = calculateTileCoverageForPlane(tiledImage, bounds, level);
            if (coverage >= 0.99) {
                resolve();
            } else if (Date.now() > startTime + options.timeout) {
                reject(new Error('Preload timeout'));
            } else {
                options.onProgress?.(coverage);
                setTimeout(check, 100);
            }
        };
        const startTime = Date.now();
        check();
    });
}
```

**Key considerations**:

1. **Priority coordination**: Preload jobs should use `PRIORITY.PREFETCH` to yield to interactive loading
2. **Heartbeat integration**: Heartbeat ensures preload tiles actually load when viewport stationary
3. **Memory limits**: Browser may evict tiles under memory pressure; no guarantee tiles stay cached
4. **Network awareness**: Could disable on slow connections or warn user about data usage
5. **Cancel token**: Use AbortController pattern for clean cancellation

**When to trigger automatically**:
- On deep zoom (> level 14), show subtle "Preload for smooth Z?" prompt
- After 5s of stationary viewport, offer preload
- Never auto-preload on metered connections

### 8.2 WebGL Rendering

The current Canvas 2D rendering is CPU-bound. WebGL rendering could:
- Parallelize tile compositing
- Enable GPU-based blending for Z-transitions
- Reduce main thread blocking

OSD has WebGL drawing plugins, but integration with 3D Z-switching would require custom work.

### 8.3 Worker-Based Tile Decoding

Moving JPEG decoding to Web Workers would:
- Unblock the main thread during tile loads
- Enable parallel decoding of multiple tiles
- Improve responsiveness during rapid navigation

The current `worker-tile-source.js` module attempts this but requires CORS headers on the tile server.
