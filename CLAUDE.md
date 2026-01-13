# evostitch Web - Viewer Component

JavaScript viewer for displaying stitched microscopy mosaics with Z-plane navigation.

## Before You Start

1. Review current state: Open `index.html` and `viewer.html` in browser
2. Read `docs/architecture.md` for module structure
3. Check for TODOs: `grep -r "TODO(#" js/`

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Catalog page listing available mosaics |
| `viewer.html` | Main viewer page with OpenSeadragon |
| `js/catalog.js` | Catalog loading and display logic |
| `js/viewer.js` | Viewer initialization and Z-navigation |
| `js/telemetry.js` | Tile load performance measurement |
| `css/style.css` | Shared styles |
| `CNAME` | GitHub Pages custom domain (evostitch.net) |

## Key Patterns

- **IIFE pattern:** All JS uses immediately-invoked function expressions to avoid global pollution
- **OpenSeadragon:** Core viewer library for pyramidal image display
- **DZI format:** Deep Zoom Image format for tile pyramids

## Testing

No test suite yet (see Issue #1). For now:
- Manual testing in browser
- Check console for errors

## Code Style

- ES6+ JavaScript
- No build step currently (vanilla JS)
- Follow existing IIFE patterns

## Documentation Updates

See **repo-level CLAUDE.md § Documentation Updates** for criteria and checklist.

**Web-specific doc locations:**

| Doc | When to Update |
|-----|----------------|
| `docs/architecture.md` | New module, structural changes, new APIs |
| `CLAUDE.md` | AI session context (e.g., telemetry API below) |

No CHANGELOG for web component currently.

## Telemetry

Tile load telemetry measures cold (network) vs warm (browser cache) performance.

### Console API

```javascript
// View current stats
evostitch.telemetry.getStats()
// Returns: { deviceTier, lastUpdated, byZoom: {...}, totals: { coldCount, coldAvgMs, warmCount, warmAvgMs } }

// Log summary to console
evostitch.telemetry.logSummary()
// Output: "[evostitch] Telemetry: cold=206 tiles (avg 135ms), warm=72 tiles (avg 1ms)"

// Clear all telemetry data
evostitch.telemetry.clearStats()

// Force flush pending data to localStorage
evostitch.telemetry.flushToStorage()
```

### How It Works

1. **Measurement:** Uses `PerformanceResourceTiming` API to get actual tile load duration
2. **Classification:** Tiles loading < 50ms are "warm" (cache hits), >= 50ms are "cold" (network)
3. **Storage:** Batched writes to localStorage (flushes every 5s or 50 tiles)
4. **Persistence:** Data persists across sessions in `localStorage['evostitch_tile_telemetry']`

### Interpreting Results

| Metric | Typical Values | Meaning |
|--------|----------------|---------|
| Cold avg | 100-200ms | Network latency + decode time |
| Warm avg | 0-5ms | Browser cache hit |
| Warm ratio | Higher = better | User revisiting same areas |

### Limitations

- Only measures tiles loaded via OpenSeadragon events
- Browser cache behavior varies by browser/settings
- No server-side aggregation (local to each browser)

## GitHub Pages

Deployed from `web/` directory to evostitch.net
- CNAME file configures custom domain
- Static files only, no server-side code
