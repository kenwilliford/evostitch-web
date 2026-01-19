// evostitch catalog page

(function() {
    'use strict';

    // Catalog configuration - list of available mosaics
    // This will be updated as mosaics are added
    const CATALOG_URL = 'mosaics/catalog.json';

    async function init() {
        const grid = document.getElementById('mosaic-grid');

        try {
            const response = await fetch(CATALOG_URL);
            if (!response.ok) {
                throw new Error(`Failed to load catalog: ${response.status}`);
            }

            const catalog = await response.json();

            if (!catalog.mosaics || catalog.mosaics.length === 0) {
                grid.innerHTML = '<p class="loading">No mosaics available yet.</p>';
                return;
            }

            grid.innerHTML = '';

            for (const mosaic of catalog.mosaics) {
                const card = createMosaicCard(mosaic);
                grid.appendChild(card);
            }

        } catch (error) {
            console.error('Failed to load catalog:', error);
            grid.innerHTML = '<p class="loading">No mosaics available yet. Check back soon!</p>';
        }
    }

    function createMosaicCard(mosaic) {
        const card = document.createElement('a');
        card.className = 'mosaic-card';

        // Use zarr-viewer for OME-Zarr format mosaics
        if (mosaic.format === 'zarr') {
            // If mosaic has a zarrUrl, pass it; otherwise use default demo
            if (mosaic.zarrUrl) {
                card.href = `zarr-viewer.html?zarr=${encodeURIComponent(mosaic.zarrUrl)}`;
            } else {
                card.href = 'zarr-viewer.html';
            }
        } else {
            card.href = `viewer.html?mosaic=${encodeURIComponent(mosaic.id)}`;
        }

        // Format dimensions
        let dimensions = '';
        if (mosaic.width && mosaic.height) {
            const gpx = (mosaic.width * mosaic.height) / 1e9;
            if (gpx >= 1) {
                dimensions = `${gpx.toFixed(1)} Gpx`;
            } else {
                const mpx = (mosaic.width * mosaic.height) / 1e6;
                dimensions = `${mpx.toFixed(0)} Mpx`;
            }
            dimensions += ` (${formatNumber(mosaic.width)} × ${formatNumber(mosaic.height)})`;
        }

        // Physical size if available
        let physicalSize = '';
        if (mosaic.physicalWidth && mosaic.physicalHeight) {
            const wMm = mosaic.physicalWidth / 1000;
            const hMm = mosaic.physicalHeight / 1000;
            physicalSize = `${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm`;
        }

        card.innerHTML = `
            <div class="thumbnail">
                ${mosaic.thumbnail
                    ? `<img src="mosaics/${mosaic.id}/${mosaic.thumbnail}" alt="${mosaic.title}">`
                    : `<span>No preview</span>`
                }
            </div>
            <div class="info">
                <div class="title">${mosaic.title || mosaic.id}</div>
                ${mosaic.description ? `<div class="description">${mosaic.description}</div>` : ''}
                <div class="dimensions">${dimensions}</div>
                ${physicalSize ? `<div class="dimensions">${physicalSize}</div>` : ''}
            </div>
        `;

        return card;
    }

    function formatNumber(n) {
        if (n >= 1000) {
            return (n / 1000).toFixed(1) + 'k';
        }
        return n.toString();
    }

    // Start initialization
    init();
})();
