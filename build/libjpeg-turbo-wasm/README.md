# WASM JPEG Decoder Build

Builds libjpeg-turbo as a WASM module for decoding grayscale JPEG zarr chunks in the browser.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Emscripten SDK | 3.1.51 (exact) | `~/emsdk/emsdk install 3.1.51 && ~/emsdk/emsdk activate 3.1.51` |
| CMake | 3.16+ | System package manager |
| Python | 3.8+ | System package manager |
| Git | any | System package manager |

## Build

```bash
source ~/emsdk/emsdk_env.sh
./build.sh
```

### Outputs

| File | Location | Description |
|------|----------|-------------|
| `jpeg-decode.wasm` | `web/wasm/` | WASM binary (~247 KB) |
| `jpeg-decode.js` | `web/wasm/` | Emscripten JS glue |
| `CHECKSUMS.sha256` | `web/wasm/` | SHA-256 hashes of artifacts |
| `LICENSE.libjpeg-turbo` | `web/wasm/` | libjpeg-turbo BSD/IJG license |
| `test-*.{jpg,gray}` | `web/tests/fixtures/` | Golden test fixtures |

### Clean

```bash
./build.sh --clean
```

## Pinned Versions

- **libjpeg-turbo:** 3.0.4
- **Emscripten:** 3.1.51

The build script enforces exact Emscripten version match and clones libjpeg-turbo at the pinned tag.

## Checked-in Artifacts

The WASM build outputs (`web/wasm/jpeg-decode.{js,wasm}`) are checked into git. The build script is provided for reproducibility. `CHECKSUMS.sha256` can verify artifact integrity.

## Architecture

The C wrapper (`jpeg-decode-wrapper.c`) exposes 4 functions:

| Function | Purpose |
|----------|---------|
| `jpeg_decode_init()` | Initialize TurboJPEG decompressor (once) |
| `jpeg_decode_gray(src, srcSize, dst, dstSize, &w, &h)` | Decode JPEG → grayscale pixels |
| `jpeg_decode_destroy()` | Free decompressor handle |
| `jpeg_decode_version()` | Return version constant (1) |

Uses `TJPF_GRAY` for direct 1-byte-per-pixel grayscale output. No RGBA conversion needed.
