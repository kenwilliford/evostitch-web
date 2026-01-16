// evostitch Tile Decoder Worker
// Off-thread tile decoding using fetch → blob → createImageBitmap
// Transfers ImageBitmap to main thread with zero-copy

'use strict';

self.onmessage = async function(e) {
    const { id, url } = e.data;

    try {
        // Fetch the tile
        const response = await fetch(url, {
            credentials: 'omit',  // Tiles are public, no cookies needed
            cache: 'default'      // Use browser cache
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Get blob for off-thread decoding
        const blob = await response.blob();

        // Decode off-thread - this is the key performance win
        // createImageBitmap with Blob input decodes in a separate thread
        const bitmap = await createImageBitmap(blob);

        // Transfer bitmap to main thread (zero-copy via transferable)
        self.postMessage({ id, bitmap, success: true }, [bitmap]);

    } catch (error) {
        // Send error back to main thread
        self.postMessage({
            id,
            success: false,
            error: error.message || 'Unknown error'
        });
    }
};
