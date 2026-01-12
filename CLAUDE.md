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

## GitHub Pages

Deployed from `web/` directory to evostitch.net
- CNAME file configures custom domain
- Static files only, no server-side code
