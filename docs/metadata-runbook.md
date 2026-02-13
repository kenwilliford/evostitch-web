# Metadata Invalidation Runbook

Operational procedures for invalidating cached zarr metadata (`.zarray`, `.zattrs`, `.zgroup`) across CDN and browser layers.

## Cache Architecture

Zarr metadata flows through two cache layers:

```
R2 Origin → Cloudflare CDN Edge (1h TTL) → Service Worker (cache-first) → Browser
```

Both layers must be invalidated when metadata changes on R2.

### Domains

| Domain | Protocol | Notes |
|--------|----------|-------|
| `data.evostitch.net` | HTTP/2 | Primary (Cloudflare proxy) |
| `pub-db7ffa4b7df04b76aaae379c13562977.r2.dev` | HTTP/1.1 | Legacy (direct R2) |

### TTL by Artifact Class

| Artifact | CDN TTL | Cache-Control | SW Strategy |
|----------|---------|---------------|-------------|
| Zarr chunks (`/{level}/{t}/{c}/{z}/{y}/{x}`) | 1 year | `public, max-age=31536000, immutable` | Cache-first |
| Zarr metadata (`.zarray`, `.zattrs`, `.zgroup`) | 1 hour | `public, max-age=3600` | Cache-first |
| Static assets (JS, CSS, HTML) | None | Served from GitHub Pages | Network-first |

## Procedure 1: Path-Specific Cache Purge

Use when specific metadata files have changed (e.g., after re-converting a dataset).

### Step 1: Purge Cloudflare CDN Edge

```bash
# Purge specific metadata files via Cloudflare API
# Replace ZONE_ID and API_TOKEN with actual values

curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "files": [
      "https://data.evostitch.net/mosaic_3d_zarr/0/.zgroup",
      "https://data.evostitch.net/mosaic_3d_zarr/0/.zattrs",
      "https://data.evostitch.net/mosaic_3d_zarr/0/0/.zarray",
      "https://data.evostitch.net/mosaic_3d_zarr/0/1/.zarray",
      "https://data.evostitch.net/mosaic_3d_zarr/0/2/.zarray"
    ]
  }'
```

**URL pattern for zarr metadata files:**

```
https://data.evostitch.net/{dataset}/0/.zgroup        # Root group
https://data.evostitch.net/{dataset}/0/.zattrs        # Root attributes (multiscales)
https://data.evostitch.net/{dataset}/0/{level}/.zarray # Per-resolution-level array metadata
```

For `mosaic_3d_zarr` with 10 resolution levels, purge URLs are:
- `.zgroup` and `.zattrs` at root (`/mosaic_3d_zarr/0/`)
- `.zarray` at each level (`/mosaic_3d_zarr/0/0/.zarray` through `/mosaic_3d_zarr/0/9/.zarray`)

**Cloudflare limit:** 30 URLs per API call. Batch if needed.

### Step 2: Clear Service Worker Cache (User Browsers)

Users' SW caches persist independently. Options:

**Option A — Wait for natural expiry:** SW cache entries are evicted by LRU when the cache exceeds 10,000 entries. Metadata files are a small fraction of total cache.

**Option B — Bump SW version (forces full cache clear):** Change `SW_VERSION` in `web/sw.js`. On next page load, the activate event deletes all old caches and creates fresh ones. See Procedure 3 below.

**Option C — User self-service (dev/debug):** Users can clear via browser console:

```javascript
// Clear entire zarr cache (chunks + metadata)
await window.evostitch.sw.clearCache()

// Verify cache is empty
await window.evostitch.sw.getStats()
// → { entryCount: 0, cacheName: 'evostitch-zarr-v1.4.1' }
```

### Step 3: Verify

```bash
# Confirm Cloudflare serves fresh metadata (check Age header)
curl -sI "https://data.evostitch.net/mosaic_3d_zarr/0/0/.zarray" | grep -i 'age\|cache'
# Age: 0 (or small number) = recently fetched from origin
# cf-cache-status: MISS = not in CDN cache (will be re-cached on next request)
```

## Procedure 2: Emergency Purge-All

Use when metadata across all datasets must be invalidated immediately.

### Step 1: Purge Entire Cloudflare Cache

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything": true}'
```

**Impact:** All CDN-cached content (chunks + metadata) will be re-fetched from R2 on next request. First requests after purge will be slower (cache miss). Chunk data will re-populate quickly since chunks are immutable and frequently requested.

### Step 2: Bump SW Version

Edit `web/sw.js`:

```javascript
// Before
const SW_VERSION = '1.4.0';

// After (increment patch)
const SW_VERSION = '1.4.1';
```

Deploy the updated `sw.js` to GitHub Pages. On next page load:
1. Browser detects byte-changed `sw.js` and triggers install event
2. `skipWaiting()` activates the new SW immediately
3. Activate event deletes all `evostitch-zarr-v1.4.1` caches
4. Fresh `evostitch-zarr-v1.4.1` cache starts empty

### Step 3: Verify

```bash
# CDN: confirm purge
curl -sI "https://data.evostitch.net/mosaic_3d_zarr/0/0/.zarray" | grep -i 'cf-cache-status'
# → cf-cache-status: MISS

# Browser: check SW version in console
navigator.serviceWorker.controller.scriptURL
# → should show new sw.js with cache-busting
```

```javascript
// Browser console: verify new cache name
await window.evostitch.sw.getStats()
// → { entryCount: 0, cacheName: 'evostitch-zarr-v1.4.1' }
```

## Procedure 3: Service Worker Update Flow

Use when deploying code changes to `sw.js` (new features, bug fixes, version bumps).

### How SW Updates Propagate

1. Browser checks for `sw.js` changes every 24 hours (or on each navigation if `updateViaCache: 'none'`)
2. If `sw.js` content differs by even one byte, browser installs the new version
3. `skipWaiting()` in our install handler activates immediately (no waiting for tabs to close)
4. Activate handler runs: `clients.claim()` takes over open tabs, old caches deleted
5. Next fetch from any tab uses new SW with empty cache

### Deployment Checklist

1. Update `SW_VERSION` constant in `web/sw.js`
2. Update corresponding cache name constants if cache schema changed
3. Commit and push to `main` (GitHub Pages deploys automatically)
4. Verify deployment:
   ```bash
   curl -s "https://evostitch.net/sw.js" | head -5
   # Should show new SW_VERSION
   ```
5. Open browser, navigate to zarr viewer, check console:
   ```
   [evostitch SW] Installing v1.4.1
   [evostitch SW] Activating v1.4.1
   [evostitch SW] Deleting old cache: evostitch-zarr-v1.4.1
   ```

### Cache Name Convention

```
evostitch-zarr-v{SW_VERSION}
evostitch-tiles-v{SW_VERSION}
evostitch-static-v{SW_VERSION}
```

Bumping `SW_VERSION` clears all three cache stores. This is intentional — it provides a clean slate without selective invalidation complexity.

## Quick Reference

| Scenario | CDN Action | SW Action | Downtime |
|----------|-----------|-----------|----------|
| Single dataset metadata changed | Path-specific purge | Wait or bump SW version | None |
| All metadata changed | Purge everything | Bump SW version | None (slower first loads) |
| SW bug fix / feature deploy | N/A | Bump SW version + deploy | None |
| Suspected stale data in user's browser | N/A | User runs `clearCache()` | None |

## Environment Variables

Required for CDN purge commands:

| Variable | Source | Notes |
|----------|--------|-------|
| `ZONE_ID` | Cloudflare dashboard > Overview | Zone for `evostitch.net` |
| `API_TOKEN` | Cloudflare dashboard > API Tokens | Needs `Zone.Cache Purge` permission |

Store in `~/.secrets` (sourced as env vars, never committed).
