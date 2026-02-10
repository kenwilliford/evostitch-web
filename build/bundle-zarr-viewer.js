#!/usr/bin/env node
// Build script for zarr-viewer bundle
// Bundles Viv (loaders + layers) and deck.gl into a single ESM file
// Usage: npm run build:zarr

const esbuild = require('esbuild');
const path = require('path');

const entryPoint = path.resolve(__dirname, '../src/zarr-viewer-bundle.js');
const outfile = path.resolve(__dirname, '../dist/zarr-viewer-bundle.js');

esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    outfile,
    sourcemap: true,
    minify: false,
    target: ['es2020'],
    // Suppress warnings about circular deps in deck.gl internals
    logLevel: 'info',
}).then(result => {
    console.log(`Bundle written to ${path.relative(process.cwd(), outfile)}`);
    if (result.warnings.length > 0) {
        console.warn(`${result.warnings.length} warning(s)`);
    }
}).catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
