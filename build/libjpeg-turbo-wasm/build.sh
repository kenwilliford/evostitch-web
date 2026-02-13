#!/usr/bin/env bash
# Build libjpeg-turbo WASM decoder for evostitch zarr viewer.
# Produces: web/wasm/jpeg-decode.{js,wasm}, CHECKSUMS.sha256
#
# Prerequisites:
#   - Emscripten SDK 3.1.51: source ~/emsdk/emsdk_env.sh
#   - CMake 3.16+
#   - Git
#
# Usage: ./build.sh [--clean]

set -euo pipefail

# Pinned versions
LIBJPEG_TURBO_TAG="3.0.4"
EMSCRIPTEN_VERSION="3.1.51"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/_build"
LIBJPEG_SRC="${SCRIPT_DIR}/libjpeg-turbo"
OUTPUT_DIR="${SCRIPT_DIR}/../../wasm"
FIXTURES_DIR="${SCRIPT_DIR}/../../tests/fixtures"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

info() { echo -e "${GREEN}[build]${NC} $*"; }
err()  { echo -e "${RED}[build]${NC} $*" >&2; }

# Clean if requested
if [[ "${1:-}" == "--clean" ]]; then
    info "Cleaning build artifacts..."
    rm -rf "${BUILD_DIR}" "${LIBJPEG_SRC}"
    info "Clean complete."
    exit 0
fi

# Verify Emscripten
if ! command -v emcc &>/dev/null; then
    err "emcc not found. Run: source ~/emsdk/emsdk_env.sh"
    exit 1
fi

ACTUAL_EM_VERSION=$(emcc --version | head -1 | grep -oP '\d+\.\d+\.\d+')
if [[ "${ACTUAL_EM_VERSION}" != "${EMSCRIPTEN_VERSION}" ]]; then
    err "Emscripten version mismatch: expected ${EMSCRIPTEN_VERSION}, got ${ACTUAL_EM_VERSION}"
    err "Run: ~/emsdk/emsdk install ${EMSCRIPTEN_VERSION} && ~/emsdk/emsdk activate ${EMSCRIPTEN_VERSION}"
    exit 1
fi
info "Emscripten ${ACTUAL_EM_VERSION} OK"

# Clone libjpeg-turbo at pinned tag
if [[ ! -d "${LIBJPEG_SRC}" ]]; then
    info "Cloning libjpeg-turbo ${LIBJPEG_TURBO_TAG}..."
    git clone --depth 1 --branch "${LIBJPEG_TURBO_TAG}" \
        https://github.com/libjpeg-turbo/libjpeg-turbo.git "${LIBJPEG_SRC}"
else
    ACTUAL_TAG=$(git -C "${LIBJPEG_SRC}" describe --tags 2>/dev/null || echo "unknown")
    info "Using existing libjpeg-turbo source (${ACTUAL_TAG})"
fi

# Build libjpeg-turbo as static WASM library (direct cmake on its own CMakeLists.txt)
info "Building libjpeg-turbo for WASM..."
WASM_BUILD="${BUILD_DIR}/wasm"
mkdir -p "${WASM_BUILD}"
cd "${WASM_BUILD}"

emcmake cmake "${LIBJPEG_SRC}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-Oz -flto" \
    -DENABLE_SHARED=OFF \
    -DENABLE_STATIC=ON \
    -DWITH_TURBOJPEG=ON \
    -DWITH_JAVA=OFF \
    -DWITH_SIMD=OFF \
    -DWITH_ARITH_ENC=OFF \
    -DWITH_ARITH_DEC=OFF \
    -DWITH_12BIT=OFF \
    > cmake_output.log 2>&1

emmake make -j"$(nproc)" jpeg-static 2>&1 | tail -5
info "libjpeg-turbo static library built"

# Find the built static library (jpeg-static, not turbojpeg-static — smaller, decode-only)
JPEG_LIB=$(find "${WASM_BUILD}" -name "libjpeg.a" | head -1)
if [[ -z "${JPEG_LIB}" ]]; then
    err "libjpeg.a not found in build directory"
    exit 1
fi
JPEG_LIB_DIR=$(dirname "${JPEG_LIB}")

# Include dirs: source for jpeglib.h, build dir for jconfig.h
JPEG_INC="${LIBJPEG_SRC}"
info "Using jpeglib.h from ${JPEG_INC}"

# Compile C wrapper to WASM
info "Compiling WASM wrapper..."
mkdir -p "${OUTPUT_DIR}"

emcc "${SCRIPT_DIR}/jpeg-decode-wrapper.c" -o "${OUTPUT_DIR}/jpeg-decode.js" \
    -I "${JPEG_INC}" \
    -I "${WASM_BUILD}" \
    -L "${JPEG_LIB_DIR}" -ljpeg \
    -Oz -flto \
    -sWASM=1 \
    -sMODULARIZE=1 \
    -sEXPORT_NAME='JpegDecodeModule' \
    -sEXPORTED_FUNCTIONS='["_jpeg_decode_init","_jpeg_decode_gray","_jpeg_decode_destroy","_jpeg_decode_version","_malloc","_free"]' \
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
    -sALLOW_MEMORY_GROWTH=1 \
    -sENVIRONMENT='web,worker' \
    -sINITIAL_MEMORY=4194304 \
    -sFILESYSTEM=0 \
    -sMALLOC=emmalloc \
    --no-entry

info "WASM compilation complete"

# Post-process with wasm-opt for further size reduction
WASM_OPT="${EMSDK}/upstream/bin/wasm-opt"
if [[ -x "${WASM_OPT}" ]]; then
    info "Running wasm-opt -Oz..."
    "${WASM_OPT}" -Oz "${OUTPUT_DIR}/jpeg-decode.wasm" -o "${OUTPUT_DIR}/jpeg-decode.wasm"
    info "wasm-opt complete"
fi

# Check output sizes
WASM_SIZE=$(stat --printf="%s" "${OUTPUT_DIR}/jpeg-decode.wasm")
JS_SIZE=$(stat --printf="%s" "${OUTPUT_DIR}/jpeg-decode.js")
WASM_KB=$((WASM_SIZE / 1024))
JS_KB=$((JS_SIZE / 1024))

info "jpeg-decode.wasm: ${WASM_KB} KB (${WASM_SIZE} bytes)"
info "jpeg-decode.js:   ${JS_KB} KB (${JS_SIZE} bytes)"

if [[ ${WASM_SIZE} -gt 204800 ]]; then
    err "WARNING: jpeg-decode.wasm exceeds 200 KB limit (${WASM_KB} KB)"
fi

# Generate golden test fixtures using native djpeg from the build
info "Generating golden test fixtures..."
mkdir -p "${FIXTURES_DIR}"

# Build native libjpeg-turbo tools for fixture generation
NATIVE_BUILD="${BUILD_DIR}/native"
mkdir -p "${NATIVE_BUILD}"
cd "${NATIVE_BUILD}"
cmake "${LIBJPEG_SRC}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_SHARED=OFF \
    -DWITH_TURBOJPEG=ON \
    -DWITH_ARITH_DEC=OFF \
    -DWITH_ARITH_ENC=OFF \
    > cmake_native_output.log 2>&1
make -j"$(nproc)" cjpeg-static djpeg-static 2>&1 | tail -3
CJPEG="${NATIVE_BUILD}/cjpeg-static"
DJPEG="${NATIVE_BUILD}/djpeg-static"
info "Native cjpeg/djpeg built"

# Helper: create test JPEG from raw PGM and decode to .gray
gen_fixture() {
    local name=$1 width=$2 height=$3 generator=$4
    local pgm="${FIXTURES_DIR}/${name}.pgm"
    local jpg="${FIXTURES_DIR}/${name}.jpg"
    local gray="${FIXTURES_DIR}/${name}.gray"

    # Generate PGM source image
    eval "${generator}" > "${pgm}"

    # Encode to JPEG Q=95 grayscale
    "${CJPEG}" -quality 95 -grayscale -outfile "${jpg}" "${pgm}"

    # Decode back to raw grayscale (ground truth for WASM output comparison)
    "${DJPEG}" -grayscale -pnm "${jpg}" | tail -c +$((width * height > 0 ? $(head -3 "${pgm}" | wc -c) + 1 : 1)) > /dev/null
    # Actually: djpeg -grayscale outputs PGM. Extract raw pixels (skip PGM header).
    "${DJPEG}" -grayscale -pnm "${jpg}" > "${FIXTURES_DIR}/${name}_decoded.pgm"
    # Strip PGM header (3 lines: P5, width height, maxval)
    tail -c +$(( $(head -3 "${FIXTURES_DIR}/${name}_decoded.pgm" | wc -c) + 1 )) \
        "${FIXTURES_DIR}/${name}_decoded.pgm" > "${gray}"
    rm -f "${FIXTURES_DIR}/${name}_decoded.pgm"
    rm -f "${pgm}"

    local jpg_size=$(stat --printf="%s" "${jpg}")
    local gray_size=$(stat --printf="%s" "${gray}")
    info "  ${name}: jpg=${jpg_size}B gray=${gray_size}B (expected ${width}x${height}=$((width*height)))"
}

# Generate PGM with gradient pattern (portable, no external tools needed)
gen_gradient_pgm() {
    local w=$1 h=$2
    printf "P5\n%d %d\n255\n" "$w" "$h"
    python3 -c "
import sys
w, h = $w, $h
for y in range(h):
    for x in range(w):
        sys.stdout.buffer.write(bytes([(x * 251 + y * 173 + x*y) % 256]))
"
}

# 1. 512x512 gradient (production-representative)
gen_fixture "test-512x512-q95" 512 512 "gen_gradient_pgm 512 512"

# 2. 1x1 minimum dimension
gen_fixture "test-1x1-q95" 1 1 "printf 'P5\n1 1\n255\n'; printf '\\x80'"

# 3. 256x128 non-square
gen_fixture "test-256x128-q95" 256 128 "gen_gradient_pgm 256 128"

# 4. 512x512 solid white
gen_fixture "test-512x512-solid-white" 512 512 \
    "printf 'P5\n512 512\n255\n'; python3 -c 'import sys; sys.stdout.buffer.write(b\"\\xff\" * 512 * 512)'"

# 5. 512x512 solid black
gen_fixture "test-512x512-solid-black" 512 512 \
    "printf 'P5\n512 512\n255\n'; python3 -c 'import sys; sys.stdout.buffer.write(b\"\\x00\" * 512 * 512)'"

info "Golden fixtures generated"

# Verify fixture sizes
for gray_file in "${FIXTURES_DIR}"/test-*.gray; do
    fname=$(basename "${gray_file}")
    fsize=$(stat --printf="%s" "${gray_file}")
    info "  ${fname}: ${fsize} bytes"
done

# Generate checksums
info "Generating checksums..."
cd "${OUTPUT_DIR}"
sha256sum jpeg-decode.js jpeg-decode.wasm > CHECKSUMS.sha256
info "Checksums written to CHECKSUMS.sha256"

# Copy libjpeg-turbo license
cp "${LIBJPEG_SRC}/LICENSE.md" "${OUTPUT_DIR}/LICENSE.libjpeg-turbo"
info "License copied"

# Summary
echo ""
info "=== Build Complete ==="
info "  WASM:      ${OUTPUT_DIR}/jpeg-decode.wasm (${WASM_KB} KB)"
info "  JS glue:   ${OUTPUT_DIR}/jpeg-decode.js (${JS_KB} KB)"
info "  Checksums: ${OUTPUT_DIR}/CHECKSUMS.sha256"
info "  License:   ${OUTPUT_DIR}/LICENSE.libjpeg-turbo"
info "  Fixtures:  ${FIXTURES_DIR}/test-*.{jpg,gray}"
info "  libjpeg-turbo: ${LIBJPEG_TURBO_TAG}"
info "  Emscripten:    ${EMSCRIPTEN_VERSION}"
