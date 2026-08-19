# The Gunflint Notebook — hosting pointer and review

**Status:** transferred and reviewed; not yet deployed. Hosting is operator-gated (see
§6). This document is a *pointer and runbook only* — none of the payload is in
this repository, and none of it may be committed here.

**Author of the payload:** Jesús Pérez Rodríguez (BMSIS internship final project).
**Scientific supervision:** Dr. Kenneth Williford.
**Deadline driving this work:** the author's presentation, Friday 2026-08-21 17:15.

> **Licence: undecided.** The payload's own README states that nothing in it is
> licensed for redistribution while that conversation is open, and that the
> `SCH-55-22B` scan, the Act II animation and the Barghoorn & Tyler
> photomicrograph are not covered by any licence granted. Treat the material as
> shared for review and hosting, not for reuse. This is a further reason the
> deployment is password-gated rather than public.

---

## 1. Provenance

| | |
|---|---|
| Source | `evom1ni:~/Downloads/gunflint-notebook.zip` (delivered by the author) |
| Size | 58,653,045,129 bytes (54.6 GiB) |
| SHA-256 | `27e60bb7740f83699c860675e438cd5efe0089eacd6e98c1a0093a477edbedb6` |
| Immutable original | `/data/evostitch/incoming/gunflint-notebook.zip` (pop-os) |
| Extracted tree | `/data/evostitch/gunflint-notebook/` (pop-os) |
| Staged three.js vendor tree | `/data/evostitch/staged/js/vendor/three/` (pop-os, see §6) |
| Entries in archive | 1,628,553 files |

The sha-256 above was computed on the source host (`shasum -a 256` on evom1ni) and
re-verified against the transferred copy on pop-os; the transfer used
`rsync -aP --append-verify`.

## 2. What it is

A single-page, narrated microscopy experience built on a terapixel scan of
`SCH-55-22B`, a thin section of the 1.88 Ga Gunflint Iron Formation. Vanilla JS,
no build step, no bundler. deck.gl + Viv render the mosaic (prebuilt in `dist/`),
three.js r160 renders eight `.glb` specimen models. Roughly 24 minutes of
narration across five blocks; subtitles are the source of truth, so the
experience runs end to end with no audio at all.

## 3. Size breakdown — the single most important hosting fact

| Directory | Size | Files |
|---|---:|---:|
| `sample-data/` | 54.6 GiB | 1,628,331 |
| `assets/` (video + 143 VO takes) | 41.1 MiB | 148 |
| `models/` (8 × `.glb`) | 15.3 MiB | 8 |
| `dist/` (deck.gl + Viv bundle) | 3.6 MiB | 1 |
| `js/` | 0.6 MiB | 30 |
| `img/` | 0.6 MiB | 11 |
| `wasm/` (libjpeg-turbo decoder) | 0.3 MiB | 4 |
| `css/` | 0.07 MiB | 4 |
| root (`index.html`, `sw.js`, `favicon.ico`, `README.md`, …) | 0.06 MiB | 15 |
| `data/evidence-tiers.json` | 0.02 MiB | 1 |
| **site without the image store** | **≈ 61 MiB** | **222** |

`sample-data/` is **99.99% of the file count and 99.9% of the bytes**. It is a
single OME-Zarr store, `mosaic_3d_full/0/`, a nine-level multiscale pyramid of an
86,016 × 58,880 px × 21 z-plane RGB volume with JPEG-compressed chunks:

| Pyramid level | Size | Chunks |
|---|---:|---:|
| `0/0` (0.0899 µm/px, full res) | 37.2 GiB | 1,217,163 |
| `0/1` | 11.4 GiB | 306,939 |
| `0/2` | 4.0 GiB | 76,737 |
| `0/3` | 1.3 GiB | 19,848 |
| `0/4` | 476 MiB | 5,547 |
| `0/5` | 145 MiB | 1,515 |
| `0/6` | 42 MiB | 381 |
| `0/7` | 12 MiB | 129 |
| `0/8` (23 µm/px) | 3.3 MiB | 66 |

**The pyramid cannot be trimmed.** Level 0 alone is 75% of the object count, so
dropping it is the obvious cost lever — but the payload's README rules it out on
scientific grounds: the narration has the visitor *measure* features 2–13 µm
across, and one level coarser a *Gunflintia* filament is under three pixels wide.
The 21 z-planes are likewise named three times in the script and cannot be
dropped. There is no reduced version of this experience. Plan for the full
1.63 M objects.

`data/` and `sample-data/` are **both** needed at runtime and are unrelated:
`data/evidence-tiers.json` (19 KB) is the evidence-level table read by the
viewer, the highlighting and the field notebook; `sample-data/` is the image
store. Neither is optional despite the "sample" name.

## 4. Self-containment review (read-only)

**Relative paths — verified clean.** A grep for leading-slash URLs in
`src`/`href`/`import`/`fetch` across `index.html`, `js/`, `css/` and `sw.js`
returns nothing. The folder runs unchanged at any path depth. `defaultZarrUrl` is
`'sample-data/mosaic_3d_full/0/'`, relative to `index.html`.

**Must be served over HTTP.** `file://` does not work — the viewer fetches zarr
chunks with `fetch()` and the module system needs a real origin.

**Three external runtime dependencies** (everything else is in-folder; no
analytics, no tracking, no third-party scripts):

| What | Origin | Note |
|---|---|---|
| three.js r160 (`three.module.js` + `examples/jsm/`) | `unpkg.com`, via an `<script type="importmap">` in `index.html` | Two importmap entries. README documents self-hosting into `js/vendor/`; **keep r160**, the models were checked against it |
| IBM Plex Mono | `fonts.googleapis.com` + `fonts.gstatic.com` | The entire interface is this one family |
| "← Back" link | hardcoded `https://evostitch.net/index.html` | One `href`; harmless, points at the existing site |

The remaining external URLs are citation links in the evidence panels (DOIs,
JSTOR, USGS, ScienceDirect) and `www.w3.org/2000/svg` namespace declarations —
all inert.

**Recommendation:** self-host three.js before deploy. It is the only external
dependency the experience *cannot* degrade past — if unpkg is slow or blocked
during the presentation, nothing renders. Google Fonts degrades gracefully to a
fallback family. This is a ~1 MB addition to a 61 MiB site and removes the single
largest live-demo risk.

**No COOP/COEP required.** Greps for `SharedArrayBuffer`, `crossOriginIsolated`,
`Atomics.`, `pthread` and related markers across `js/`, `wasm/`, `sw.js` and
`index.html` return nothing. The libjpeg-turbo decoder in `wasm/` is
single-threaded. This matters: `Cross-Origin-Embedder-Policy: require-corp` would
have broken the unpkg and Google Fonts loads, and it is not needed. Do **not**
set it.

**Service worker.** `sw.js` (v1.4.1) is registered from `index.html`; its scope is
its own directory. Three caches — tiles, zarr chunks, static — cache-first for
tiles and zarr, network-first for static. It is an optimisation, not a
requirement. Two consequences for the Worker (§5): the login redirect must never
be cacheable, and `SW_VERSION` must be bumped on any content update or returning
visitors keep the old cache.

**Secrets: none found.** A scan for API keys, tokens, bearer strings, AWS key
IDs, PEM private-key headers and provider-specific prefixes across the whole
source tree returned exactly one hit — the Spanish word *"secreta"* in a prose
code comment in `js/experience/experience.js`. There are no credentials in the
payload. (`js/zarr-prefetch.js:34` contains the string `https://...r2.dev/...`
but it is an elided placeholder inside a documentation comment, not a real
bucket URL.)

**Case sensitivity.** The narration engine derives VO filenames directly from the
scripts (`assets/vo/<id>.mp3`, lowercase). R2 keys are case-sensitive and a
missing take is silent rather than an error, so a case mismatch introduced during
upload would quietly remove narration without any visible failure. Verify the VO
take count (143) after upload.

## 5. Dedup check against `data.evostitch.net` — the store is already hosted

`data.evostitch.net/mosaic_3d_zarr_v3/` already serves an OME-Zarr store of the
same sample, and `evostitch-web`'s own `js/zarr-viewer.js` consumes it
(`evositchBaseUrl: 'https://data.evostitch.net/'`). Jesús's viewer is a fork of
that file — same code, same typo in the constant name — with the store bundled
locally instead. So the question is whether his bundled store can be replaced by
the hosted one.

**Verdict: COMPATIBLE-BUT-DIFFERENT, and the difference is in our favour.**

### What is identical

**Level 0 chunks are byte-identical.** Two chunks fetched from
`data.evostitch.net` and extracted from Jesús's archive at the same coordinates:

| Chunk (t.c.z.y.x) | Bytes | SHA-256 (first 16) | |
|---|---:|---|---|
| `0.0.10.50.80` | 27,324 | `69f985195d45854c` | identical in both |
| `0.1.10.50.80` | 27,091 | `17a6bc3558178fe7` | identical in both |

The chunk *count* corroborates this: his level 0 holds 1,217,163 files;
115 × 168 chunks × 21 z × 3 channels + 3 metadata files = 1,217,163 exactly.

Also identical: `dtype` `|u1`, chunk shape `[1,1,1,512,512]`, compressor
`imagecodecs_jpeg` level 95, axes `t,c,z,y,x`, multiscales version 0.4, `omero`
channel definitions, `bioformats2raw.layout: 3`, 21 z-planes, 3 channels, and —
critically — the **level-0 pixel scale, `0.089843` × `0.089884` µm/px in both**.
That is the number the README flags as the one that must not be wrong, and it is
the number every measurement in the narration rests on. Same origin, same scale,
same level-0 grid ⇒ **the specimen coordinates and the ruler are unaffected.**

### What differs

| | Jesús's `mosaic_3d_full` | Hosted `mosaic_3d_zarr_v3` |
|---|---|---|
| Chunk key separator | `.` (e.g. `0.0.10.50.80`) | `/` (e.g. `0/0/10/50/80`) |
| Level-0 shape | `[1,3,21,58880,86016]` (padded to the 512 grid) | `[1,3,21,58754,85719]` (true extent) |
| Pyramid levels | 9 (0–8) | 10 (0–9) |
| Coarse-level chunk shapes | uniform 512 × 512 | variable (L7 459×512, L8 229×334, L9 114×167) |
| Levels ≥ 1 chunk bytes | **differ** — independently regenerated | — |
| `multiscales.name` | `/` | `SCH-55-22B_50xt_3D_test4` (Bio-Formats 8.3.0) |

Levels ≥ 1 differ in bytes because each store downsampled from its own level 0
with different tooling — his from the padded 86016-wide base, the hosted one from
the true 85719-wide base. Both halve at each step from a common origin, so a
given pixel maps to the same physical location in both; the imagery is
equivalent, the encodings are not. The declared slide extent shrinks by 0.35%
(7.73 → 7.70 mm wide), which is worth mentioning to the author since the
narration quotes `7.73 × 5.29 mm`, but it is far below anything visible.

### Why the differences do not block the swap

- **The separator is read at runtime.** `js/zarr-prefetch.js:191` parses
  `dimension_separator` out of the level-0 `.zarray` and stores it; line 277
  builds chunk keys with it. Both `.` and `/` are handled.
- **The service worker already allowlists the hosted domain.** `sw.js` gates all
  zarr caching on `R2_DOMAINS = ['pub-db7…r2.dev', 'data.evostitch.net']`, and
  its own comments give `/mosaic_3d_zarr_v3/0/3/…` as the worked example. Its
  chunk matcher explicitly handles both dot- and slash-separated keys.
- **CORS is already correct** on `data.evostitch.net`
  (`access-control-allow-origin: *`), and the prefetcher already issues
  `fetch(url, { mode: 'cors', credentials: 'omit' })`.
- **No file edit is needed to test it.** `js/zarr-viewer.js` accepts a full URL
  via a `?zarr=` query parameter, so
  `…/index.html?zarr=https://data.evostitch.net/mosaic_3d_zarr_v3/0/` exercises
  the whole path with his tree untouched.

### The finding that reverses the cost comparison

Uploading the store is **not** the zero-code-change option. `sw.js` allowlists
zarr caching by hostname, and `gunflint.evostitch.net` is not on that list — so
serving the store same-origin from the new bucket would leave
`isZarrChunkRequest()` returning `false` and **the zarr cache dead**, refetching
every chunk on every pan for the whole presentation. Option B therefore needs a
`sw.js` edit *and* a 54.6 GiB upload; option A needs one line and gets the
caching the code was actually designed for.

| | A · point at `data.evostitch.net` | B · upload to the new bucket |
|---|---|---|
| Upload | 61 MiB, 222 files, ~1 min | 54.6 GiB, 1,628,553 objects, hours |
| One-time R2 write cost | negligible | ~$7 |
| Monthly storage | negligible | ~$0.88 |
| Code change | 1 line (`defaultZarrUrl`) | 1 line + `sw.js` `R2_DOMAINS` + `SW_VERSION` |
| SW zarr caching | works as designed | broken until `sw.js` is edited |
| Level-0 imagery | byte-identical | byte-identical |
| Risk | depends on a second origin staying up | fully self-contained |

**Recommended diff (option A), one line in `js/zarr-viewer.js`:**

```diff
-    defaultZarrUrl: 'sample-data/mosaic_3d_full/0/',
+    defaultZarrUrl: 'https://data.evostitch.net/mosaic_3d_zarr_v3/0/',
```

Nothing else changes. **Not applied** — this is the diff to hand to the author.

Two things for the operator to weigh, neither of which is mine to decide:

1. **Option A makes the presentation depend on a second origin.** If
   `data.evostitch.net` has trouble on Friday, the notebook shows the red banner.
   Option B is self-contained. A middle path exists: point at the hosted store
   *and* upload the store to the new bucket as a fallback, changing one line if
   needed — but that costs the full upload anyway.
2. **The scan is already public.** `data.evostitch.net` serves it unauthenticated
   with `access-control-allow-origin: *`. Given the README states the
   `SCH-55-22B` scan is not covered by any licence granted, that is worth a
   deliberate decision rather than an inherited default. It is not a *new*
   exposure created by option A — the data is already out there — but the
   password gate on `gunflint.evostitch.net` would be protecting the narration
   and the reconstructions, not the imagery.

## 6. Vendoring three.js r160 (prepared, not applied)

Removes the only external dependency the experience cannot degrade past.

**Provenance.** `npm view three@0.160.0` reports maintainers `mrdoob` and
`mugen87` — the genuine three.js maintainers. The tarball was pinned and
verified end to end:

| | |
|---|---|
| Tarball | `https://registry.npmjs.org/three/-/three-0.160.0.tgz` |
| SHA-1 | `cd1e4dbd01aee0719280a9086d75545db52b7a8f` — matches npm `dist.shasum` |
| SHA-512 | `DLU8lc0zNIPkM7rH5/e1Ks1Z8tWCGRq6g8mPowdDJpw1CFBJMU7UoJjC6PefXW7z//SSl0b2+GCw14LB+uDhng==` — matches npm `dist.integrity` |

Each vendored file was additionally compared against what `unpkg.com` serves
today for the same version: **all three byte-identical**. The swap is a pure
origin change with no behavioural difference.

**Scope.** The tree imports only `three` and
`three/addons/loaders/GLTFLoader.js`; `GLTFLoader.js` pulls in only
`../utils/BufferGeometryUtils.js`, which imports only `three`.
`three.module.js` has no imports at all. Three files close the graph — no Draco
or KTX2 loader is referenced, so none is needed. 1.4 MiB total.

| Staged file | Bytes | SHA-256 |
|---|---:|---|
| `js/vendor/three/build/three.module.js` | 1,272,972 | `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495` |
| `js/vendor/three/examples/jsm/loaders/GLTFLoader.js` | 108,522 | `d073b438e6a07e1359741dd5d6c76c953420cc0d4fd84eb1bdde94315540e6a3` |
| `js/vendor/three/examples/jsm/utils/BufferGeometryUtils.js` | 31,906 | `9be041e96308775d00e2695cc607645b9a9b64fd7c0e759dd8f7c00a8d92becb` |
| `js/vendor/three/LICENSE` (MIT) | 1,081 | `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d` |

**The diff**, two lines in `index.html`. Keeping the `three/addons/` prefix
mapping is what lets `GLTFLoader.js` resolve its own `../utils/…` import:

```diff
     {
         "imports": {
             "zarr-viewer-bundle": "./dist/zarr-viewer-bundle.js",
-            "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
-            "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
+            "three": "./js/vendor/three/build/three.module.js",
+            "three/addons/": "./js/vendor/three/examples/jsm/"
         }
     }
```

**Not applied** to the author's tree. Google Fonts is deliberately left alone —
it degrades gracefully to a fallback family, so it does not carry the same risk.

## 7. Hosting plan (outline)

evostitch.net is today GitHub Pages served from this public repo via `CNAME`. It
can host neither 54.6 GiB nor a password, so the notebook goes to a **separate
subdomain**: `gunflint.evostitch.net`, a Cloudflare Worker in front of a
dedicated R2 bucket, modelled on `infra-spec/skills/lab-deploy/SKILL.md`.
**evostitch.net itself is not touched.**

- **Bucket:** new, dedicated, public access OFF. The Worker's R2 binding is the
  only read path, so the password cannot be bypassed via an `r2.dev` URL.
- **Auth:** shared password held as a Worker secret, set by the operator with
  `wrangler secret put`. Constant-time comparison; on success an `HttpOnly`,
  `Secure`, `SameSite=Lax` cookie carrying an expiry and an HMAC over it; every
  other request verifies the HMAC before touching R2. Login POSTs rate-limited.
  Login responses `Cache-Control: no-store` so the service worker never caches a
  redirect-to-login in place of real content.
- **Not Cloudflare Access.** The shared CF Access app covering
  lab/astrograin/tiepoint must never be touched, and a presentation audience
  cannot be enrolled in Zero Trust. This is a standalone password Worker with no
  relationship to that app.
- **MIME types:** the `lab-worker` table plus `wasm` → `application/wasm` (wrong
  MIME breaks streaming instantiation), `glb`/`gltf`, `mp4`/`webm`, `mp3`, and a
  default of `application/octet-stream` for the extensionless zarr chunks. Range
  requests must pass through for the models and video.
- **Upload:** scope depends on the §5 decision. Under option A it is 222 files
  and 61 MiB — seconds, and the image store stays where it already is. Under
  option B it is `rclone copy` of the full tree using the existing account-level
  R2 remote, with high `--transfers`/`--checkers` (1.63 M small objects is
  request-bound, not bandwidth-bound) and `--fast-list`; expect hours, and start
  it a full day ahead of the presentation.

## 8. Operator-gated steps

None of the following is done autonomously.

1. Confirm the Cloudflare account holding the evostitch.net zone. **Registry
   gap:** `infra-spec/registry/environment.yaml` has no evostitch.net entry at
   all. Observed (not authoritative): NS = `arch.ns.cloudflare.com` /
   `michelle.ns.cloudflare.com`, the same pair as kenwilliford.net; apex A records
   are the four GitHub Pages IPs. Per ARC-IFA-069 this must be confirmed with the
   operator before anything is created, and the registry updated.
2. **Token gap:** `LAB_KENWILLIFORD_CF_DEPLOY_TOKEN` is zone-scoped to
   kenwilliford.net (+trydialog.ai) and cannot deploy a route or DNS record on
   evostitch.net. A new or extended token is required.
3. **Decide §5: point at `data.evostitch.net` or upload the store.** This sets
   the upload scope (61 MiB vs 54.6 GiB) and is the single biggest schedule
   lever. Approve the bucket name, then the upload runs.
4. Codex review on the Worker PR (auth surface, per `CROSS_MODEL_REVIEW.md`) and
   operator approval. No auto-merge: auth plus a user-facing deploy surface is a
   hold-for-operator diff under the merge policy.
5. Operator sets the password and cookie-signing secrets via `wrangler secret
   put`. The password is never chosen, generated, echoed, logged or committed by
   an agent.
6. Operator creates the DNS record; Worker deploys; operator runs the first login
   test from a device that has never held the cookie.

## 9. Local review

Served read-only from the extracted tree on pop-os for operator review before any
deploy:

```
http://pop-os.tail8455a8.ts.net:8010/
```

(`python3 -m http.server 8010 --directory /data/evostitch/gunflint-notebook`,
Tailscale-only, no auth, temporary.)

The payload's own README, final section, gives the deployment check sequence — entry screen,
sample visible with no red banner, first narration line audible, skip-to-end
lands in free exploration with the ruler and three points of light, specimen card
model tinting on hover, quiet console. Run it against the deployed URL, not only
locally.

## 10. Data retention

The payload lives on pop-os at `/data/evostitch/` and in the R2 bucket once
uploaded. It is **not** in git, here or anywhere else: `evostitch-ysp` is
archived, and this repository is public. Only this document tracks it.
