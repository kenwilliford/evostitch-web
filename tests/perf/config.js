// Performance test harness configuration

const CONFIG = {
    // Test mosaic - use small 3D mosaic for faster tests
    TEST_MOSAIC: '3x3x3-test',

    // Viewer URL (use local server or production)
    // Use environment variable or default to production
    VIEWER_BASE_URL: process.env.PERF_VIEWER_URL || 'https://evostitch.net/viewer.html',

    // Network throttling profiles (CDP Network.emulateNetworkConditions)
    NETWORK_PROFILES: {
        'unthrottled': null,  // No throttling
        'fast-3g': {
            downloadThroughput: 1.6 * 1024 * 1024 / 8,  // 1.6 Mbps
            uploadThroughput: 750 * 1024 / 8,           // 750 Kbps
            latency: 150                                 // 150ms RTT
        },
        'slow-3g': {
            downloadThroughput: 400 * 1024 / 8,         // 400 Kbps
            uploadThroughput: 400 * 1024 / 8,
            latency: 400                                 // 400ms RTT
        }
    },

    // Viewport sizes
    VIEWPORTS: {
        'desktop': { width: 1920, height: 1080 },
        'mobile': { width: 375, height: 812 }
    },

    // Cache states
    CACHE_STATES: ['cold', 'warm'],

    // Timing thresholds
    VIEWPORT_COMPLETE_TIMEOUT_MS: 60000,  // Max wait for viewport complete
    SETTLE_DELAY_MS: 2000,                // Wait after load for late tiles

    // Output paths
    OUTPUT_DIR: 'web/docs',
    BASELINE_JSON: 'performance-baseline.json',
    BASELINE_MD: 'performance-baseline.md'
};

module.exports = CONFIG;
