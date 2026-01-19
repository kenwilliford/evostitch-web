// Bundle entry point for zarr-viewer
// Exports Viv loaders/layers and deck.gl components needed for OME-Zarr visualization
// Note: Using @vivjs packages directly to avoid React dependency in @vivjs/viewers

// Viv loaders (for loading OME-Zarr data)
export { loadOmeZarr } from '@vivjs/loaders';

// Viv layers (for rendering)
export { MultiscaleImageLayer, ImageLayer } from '@vivjs/layers';

// deck.gl exports
export { Deck, OrthographicView } from '@deck.gl/core';
