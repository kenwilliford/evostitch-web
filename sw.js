// evostitch Service Worker - Tile caching for improved 3D performance
// W1: Service Worker Caching

const SW_VERSION = '1.2.0';
const TILE_CACHE_NAME = `evostitch-tiles-v${SW_VERSION}`;
const STATIC_CACHE_NAME = `evostitch-static-v${SW_VERSION}`;

// Cache size limits
const MAX_TILE_CACHE_ENTRIES = 5000;
const CACHE_TRIM_BATCH_SIZE = 500; // Number of entries to evict when trimming

// Pattern to identify tile requests (DZI format: {name}_files/{level}/{x}_{y}.{ext})
// Tiles come from R2 CDN and have _files/ in their path
const TILE_URL_PATTERN = /_files\/\d+\/\d+_\d+\.(jpg|jpeg|png|webp)$/i;

// Pattern to identify DZI descriptor files
const DZI_URL_PATTERN = /\.dzi$/i;

// Determine if a URL is a tile request
function isTileRequest(url) {
    return TILE_URL_PATTERN.test(url);
}

// Determine if a URL is a DZI descriptor
function isDziRequest(url) {
    return DZI_URL_PATTERN.test(url);
}

// Determine if a URL is a static asset (HTML, JS, CSS)
function isStaticAsset(url) {
    var pathname = new URL(url).pathname;
    return pathname.endsWith('.html') ||
           pathname.endsWith('.js') ||
           pathname.endsWith('.css') ||
           pathname === '/' ||
           pathname === '';
}

// Install event - cache nothing initially, just activate immediately
self.addEventListener('install', function(event) {
    console.log(`[evostitch SW] Installing v${SW_VERSION}`);
    // Skip waiting to activate immediately
    event.waitUntil(self.skipWaiting());
});

// Activate event - claim all clients and clean up old caches
self.addEventListener('activate', function(event) {
    console.log(`[evostitch SW] Activating v${SW_VERSION}`);
    event.waitUntil(
        Promise.all([
            // Claim all open clients immediately
            self.clients.claim(),
            // Delete old caches from previous versions
            caches.keys().then(function(cacheNames) {
                return Promise.all(
                    cacheNames
                        .filter(function(name) {
                            // Delete any evostitch cache that doesn't match current version
                            var isOurCache = name.startsWith('evostitch-tiles-') ||
                                           name.startsWith('evostitch-static-');
                            var isCurrentVersion = name === TILE_CACHE_NAME ||
                                                  name === STATIC_CACHE_NAME;
                            return isOurCache && !isCurrentVersion;
                        })
                        .map(function(name) {
                            console.log(`[evostitch SW] Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
        ])
    );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // Only handle GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Strategy 1: Cache-first for tile images
    // Tiles are immutable content - once created, they never change
    if (isTileRequest(url)) {
        event.respondWith(cacheFirstStrategy(event.request, TILE_CACHE_NAME));
        return;
    }

    // Strategy 2: Cache-first for DZI descriptors (also immutable)
    if (isDziRequest(url)) {
        event.respondWith(cacheFirstStrategy(event.request, TILE_CACHE_NAME));
        return;
    }

    // Strategy 3: Network-first for static assets (HTML, JS, CSS)
    // Always try to get fresh code, fall back to cache if offline
    if (isStaticAsset(url)) {
        event.respondWith(networkFirstStrategy(event.request, STATIC_CACHE_NAME));
        return;
    }

    // All other requests: pass through to network (don't cache)
});

// Cache-first strategy: check cache, fall back to network
// Used for immutable content like tiles
// Implements LRU by moving accessed entries to end of cache
function cacheFirstStrategy(request, cacheName) {
    return caches.open(cacheName).then(function(cache) {
        return cache.match(request).then(function(cachedResponse) {
            if (cachedResponse) {
                // Cache hit - move to end of cache for LRU tracking
                // (delete and re-add moves entry to end)
                cache.delete(request).then(function() {
                    cache.put(request, cachedResponse.clone());
                }).catch(function(e) {
                    console.warn('[evostitch SW] LRU cache update failed:', e);
                });
                return cachedResponse;
            }

            // Cache miss - fetch from network and cache the response
            return fetch(request).then(function(networkResponse) {
                // Only cache successful responses
                if (networkResponse.ok) {
                    // Clone the response since we need to use it twice
                    // (once to cache, once to return)
                    cache.put(request, networkResponse.clone());
                    // Trigger async cache trimming (don't wait for it)
                    trimCacheIfNeeded(cacheName, MAX_TILE_CACHE_ENTRIES).catch(function(e) {
                        console.warn('[evostitch SW] Cache trim failed:', e);
                    });
                }
                return networkResponse;
            });
        });
    });
}

// Network-first strategy: try network, fall back to cache
// Used for static assets that may be updated
function networkFirstStrategy(request, cacheName) {
    return fetch(request).then(function(networkResponse) {
        // Got network response - cache it and return
        if (networkResponse.ok) {
            var responseToCache = networkResponse.clone();
            caches.open(cacheName).then(function(cache) {
                cache.put(request, responseToCache);
            });
        }
        return networkResponse;
    }).catch(function() {
        // Network failed - try cache
        return caches.open(cacheName).then(function(cache) {
            return cache.match(request).then(function(cachedResponse) {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // No cache fallback available
                return new Response('Network unavailable and no cached version', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            });
        });
    });
}

// Trim cache to enforce size limit using LRU eviction
// Cache keys are ordered by insertion time, so first entries are oldest
function trimCacheIfNeeded(cacheName, maxEntries) {
    return caches.open(cacheName).then(function(cache) {
        return cache.keys().then(function(keys) {
            if (keys.length <= maxEntries) {
                return; // Within limit, no trimming needed
            }

            // Calculate how many to remove (batch eviction for efficiency)
            var toRemove = Math.min(
                keys.length - maxEntries + CACHE_TRIM_BATCH_SIZE,
                keys.length - maxEntries
            );
            toRemove = Math.max(toRemove, keys.length - maxEntries);

            console.log(`[evostitch SW] Trimming cache: ${keys.length} entries, removing ${toRemove} oldest`);

            // Remove oldest entries (at the beginning of keys array)
            var deletePromises = keys.slice(0, toRemove).map(function(key) {
                return cache.delete(key);
            });

            return Promise.all(deletePromises).then(function() {
                console.log(`[evostitch SW] Cache trimmed to ${keys.length - toRemove} entries`);
            });
        });
    });
}

