# Zarr Cache & Network Audit

**Date:** 2026-02-05
**Auditor:** Worker 3 (cache-worker)
**Scope:** R2 CDN (pub-db7ffa4b7df04b76aaae379c13562977.r2.dev) and IDR MinIO (minio-dev.openmicroscopy.org)

---

## R2 CDN Headers (evostitch tile data)

Tested against DZI tiles and descriptors served from Cloudflare R2 public bucket.

### Sample Response Headers

```
HTTP/1.1 200 OK
Date: Thu, 05 Feb 2026 22:36:22 GMT
Content-Type: image/jpeg
Content-Length: 12830
Connection: keep-alive
Accept-Ranges: bytes
ETag: "bf415c676859ff4b9520ee8e6f3c0494"
Last-Modified: Sun, 11 Jan 2026 07:49:14 GMT
Server: cloudflare
CF-RAY: 9c95e2ddbfb1ba00-SEA
```

### Header Analysis

| Header | Present | Value | Notes |
|--------|---------|-------|-------|
| `Cache-Control` | **No** | - | Missing. Browser uses heuristic caching based on Last-Modified. |
| `ETag` | Yes | MD5 hash | Standard R2 behavior. Enables conditional requests (If-None-Match). |
| `Last-Modified` | Yes | Date | Enables conditional requests (If-Modified-Since). |
| `Content-Encoding` | **No** | - | No compression. Chunks served raw. |
| `Accept-Ranges` | Yes | bytes | Supports range requests (useful for partial chunk reads). |
| `Content-Type` | Yes | application/octet-stream | Generic binary for .dzi; image/jpeg for tiles. |
| `Vary` | **No** | - | No Vary header on R2. Good for caching consistency. |
| `Access-Control-*` | **No** | - | No CORS headers visible. May need configuration for Cache API. |

### Protocol

| Feature | Status | Details |
|---------|--------|---------|
| HTTP/2 | **No** | Response shows `HTTP/1.1`. Cloudflare R2 public buckets use HTTP/1.1 by default. |
| HTTP/3 | No | Not observed. Requires custom domain with Cloudflare proxy enabled. |
| TLS | Yes | HTTPS enforced via Cloudflare. |
| Compression | **None** | No gzip/brotli. Zarr chunks are already compressed (zlib/blosc). DZI tiles are JPEG (already compressed). |

### Typical Chunk/Tile Sizes

| Type | Size | Notes |
|------|------|-------|
| DZI tile (JPEG) | ~12 KB | SCH-55-22B_50xt_3D_test4_33x33x21 tiles at level 8 |
| DZI descriptor | ~207 B | XML descriptor file |
| Zarr chunk (IDR reference) | ~53 KB | 512x512 chunk at resolution 0 |
| Zarr .zattrs | ~1.5 KB | JSON metadata |

---

## IDR/MinIO Headers (reference comparison)

```
HTTP/1.1 200 OK
Server: nginx/1.28.1
Content-Type: application/octet-stream
Content-Length: 53534
ETag: "00000000000000000000000000000000-1"
Last-Modified: Fri, 06 Aug 2021 12:56:25 GMT
Vary: Origin
Accept-Ranges: bytes
Strict-Transport-Security: max-age=31536000
```

IDR also lacks `Cache-Control` headers but has `Vary: Origin` which can reduce cache efficiency when CORS varies.

---

## Findings

### 1. No Cache-Control Headers (Critical)

R2 public buckets do not set `Cache-Control` headers by default. This means:
- Browsers use **heuristic caching** (typically 10% of time since Last-Modified)
- No explicit `max-age` or `immutable` directive
- Conditional requests (ETags) still work, but add round-trip latency
- The Cache API (used by our module) works regardless of response headers

**Recommendation:** If possible, set `Cache-Control: public, max-age=31536000, immutable` on zarr chunks via R2 bucket rules. Chunks are immutable content - once written, they never change.

### 2. No HTTP/2 Multiplexing

R2 public bucket URLs (`pub-*.r2.dev`) use HTTP/1.1. This means:
- Browser limited to ~6 concurrent connections per origin
- No header compression (HPACK)
- No stream prioritization
- **Significant bottleneck** for zarr viewers loading many chunks simultaneously

**Recommendation:** Use a Cloudflare-proxied custom domain in front of R2. This enables HTTP/2 and HTTP/3 automatically, boosting concurrent chunk loading significantly.

### 3. No Server-Side Compression

Zarr chunks compressed with zlib/blosc are already compact; server-side gzip/brotli would not help (and could hurt). This is expected and acceptable.

DZI JPEG tiles are also pre-compressed. No action needed.

### 4. CORS Configuration

No `Access-Control-Allow-Origin` headers observed on R2 responses. The Cache API and `fetch()` may require CORS for cross-origin requests from the evostitch.net domain.

**Recommendation:** Verify CORS is configured on the R2 bucket. If using Cache API with opaque responses, cache storage size is inflated (browser pads opaque responses).

### 5. ETag Support (Good)

Both R2 and IDR provide ETags, enabling conditional requests for cache validation. This is useful for long-running sessions where cached data may expire.

---

## Recommendations Summary

| Priority | Action | Impact |
|----------|--------|--------|
| P0 | Add `Cache-Control: public, max-age=31536000, immutable` to R2 | Eliminates conditional request overhead for immutable chunks |
| P1 | Use Cloudflare-proxied custom domain for R2 | Enables HTTP/2 multiplexing (6x+ concurrent loads) |
| P1 | Configure CORS on R2 bucket | Required for Cache API with non-opaque responses |
| P2 | Client-side Cache API layer (this module) | Provides persistent caching independent of browser heuristics |
| P3 | Prefetch adjacent Z-plane chunks | Reduces perceived Z-switch latency |

---

## Client-Side Caching Strategy

Given the server-side limitations (no Cache-Control, no HTTP/2), the client-side cache module (`zarr-cache.js`) should:

1. **Use Cache API** for persistent storage - works regardless of response headers
2. **Implement LRU eviction** - zarr datasets can be very large (200+ GB)
3. **Priority queue** - viewport chunks > adjacent Z > prefetch
4. **Concurrency control** - compensate for HTTP/1.1's 6-connection limit
5. **Request deduplication** - prevent duplicate fetches for same chunk
6. **Abort lower-priority** - when viewport changes, cancel prefetch requests

This approach mitigates the lack of server-side cache headers by managing caching entirely on the client.
