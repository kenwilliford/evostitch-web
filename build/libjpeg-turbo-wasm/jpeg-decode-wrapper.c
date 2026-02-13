#include <stdio.h>
#include <stdlib.h>
#include <jpeglib.h>
#include <setjmp.h>
#include <stddef.h>
#include <string.h>

// Single source of truth for max chunk dimension.
// Must match MAX_CHUNK_DIM in jpeg-zarr-codec.js.
#define MAX_CHUNK_DIM 4096

// Version constant for JS/WASM lockstep verification.
#define JPEG_DECODE_VERSION 1

// Error handler that longjmps instead of calling exit()
struct jpeg_error_ctx {
    struct jpeg_error_mgr pub;
    jmp_buf jmpbuf;
};

static void error_exit_handler(j_common_ptr cinfo) {
    struct jpeg_error_ctx* ctx = (struct jpeg_error_ctx*)cinfo->err;
    longjmp(ctx->jmpbuf, 1);
}

// Persistent decompressor state
static struct jpeg_decompress_struct g_cinfo;
static struct jpeg_error_ctx g_jerr;
static int g_initialized = 0;

// Return version constant for JS/WASM coherency check.
int jpeg_decode_version(void) {
    return JPEG_DECODE_VERSION;
}

// Initialize decompressor. Returns 0 on success.
int jpeg_decode_init(void) {
    if (g_initialized) return 0;

    g_cinfo.err = jpeg_std_error(&g_jerr.pub);
    g_jerr.pub.error_exit = error_exit_handler;

    if (setjmp(g_jerr.jmpbuf)) {
        return -1;
    }

    jpeg_create_decompress(&g_cinfo);
    g_initialized = 1;
    return 0;
}

// Decode JPEG to grayscale. Returns 0 on success.
// Caller must allocate dst buffer of width*height bytes.
// Writes width/height to provided pointers.
int jpeg_decode_gray(
    const unsigned char* src, unsigned int srcSize,
    unsigned char* dst, unsigned int dstSize,
    int* outWidth, int* outHeight
) {
    if (!g_initialized) return -1;

    if (setjmp(g_jerr.jmpbuf)) {
        jpeg_abort_decompress(&g_cinfo);
        return -4;
    }

    // Feed JPEG data from memory
    jpeg_mem_src(&g_cinfo, src, srcSize);

    if (jpeg_read_header(&g_cinfo, TRUE) != JPEG_HEADER_OK) {
        return -2;
    }

    int width = (int)g_cinfo.image_width;
    int height = (int)g_cinfo.image_height;

    // Bounds validation: positive dimensions within limits
    if (width <= 0 || height <= 0) return -2;
    if (width > MAX_CHUNK_DIM || height > MAX_CHUNK_DIM) return -2;

    // Overflow-safe size computation (size_t)
    size_t required = (size_t)width * (size_t)height;
    if (required > dstSize) return -3;

    // Request grayscale output
    g_cinfo.out_color_space = JCS_GRAYSCALE;

    jpeg_start_decompress(&g_cinfo);

    // Read scanlines directly into output buffer
    unsigned char* row_ptr = dst;
    while (g_cinfo.output_scanline < g_cinfo.output_height) {
        JSAMPROW row = row_ptr;
        jpeg_read_scanlines(&g_cinfo, &row, 1);
        row_ptr += g_cinfo.output_width;
    }

    jpeg_finish_decompress(&g_cinfo);

    *outWidth = width;
    *outHeight = height;
    return 0;
}

// Free decompressor. Returns 0 on success.
int jpeg_decode_destroy(void) {
    if (g_initialized) {
        jpeg_destroy_decompress(&g_cinfo);
        g_initialized = 0;
    }
    return 0;
}
