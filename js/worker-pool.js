// evostitch Worker Pool - Manages Web Workers for parallel tile decoding
// Pool sized to navigator.hardwareConcurrency with round-robin distribution

(function() {
    'use strict';

    // Configuration
    const DEFAULT_POOL_SIZE = 4;
    const MAX_POOL_SIZE = 12;

    // State
    let workers = [];
    let pendingJobs = new Map();  // id -> { resolve, reject }
    let nextJobId = 0;
    let nextWorkerIndex = 0;
    let initialized = false;
    let debug = false;

    // Initialize the worker pool
    function init(options) {
        if (initialized) {
            log('Worker pool already initialized');
            return;
        }

        options = options || {};
        const poolSize = Math.min(
            options.poolSize || navigator.hardwareConcurrency || DEFAULT_POOL_SIZE,
            MAX_POOL_SIZE
        );

        log(`Initializing worker pool with ${poolSize} workers`);

        for (let i = 0; i < poolSize; i++) {
            const worker = new Worker('js/tile-decoder-worker.js');
            worker.onmessage = handleWorkerMessage;
            worker.onerror = handleWorkerError;
            workers.push(worker);
        }

        initialized = true;
        console.log(`[evostitch] Worker pool initialized: ${poolSize} workers`);
    }

    // Handle messages from workers
    function handleWorkerMessage(e) {
        const { id, bitmap, success, error } = e.data;
        const job = pendingJobs.get(id);

        if (!job) {
            log(`Warning: Received response for unknown job ${id}`);
            return;
        }

        pendingJobs.delete(id);

        if (success) {
            job.resolve(bitmap);
        } else {
            job.reject(new Error(error || 'Worker decode failed'));
        }
    }

    // Handle worker errors
    function handleWorkerError(e) {
        console.error('[evostitch] Worker error:', e.message);
        // Workers continue to function after errors
    }

    // Decode a tile using the worker pool
    // Returns a Promise that resolves to an ImageBitmap
    function decode(url) {
        if (!initialized) {
            init();
        }

        return new Promise(function(resolve, reject) {
            const id = nextJobId++;

            // Store the job
            pendingJobs.set(id, { resolve, reject, url });

            // Round-robin worker selection
            const worker = workers[nextWorkerIndex];
            nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;

            // Send to worker
            worker.postMessage({ id, url });

            log(`Job ${id} sent to worker ${nextWorkerIndex}: ${url.substring(url.lastIndexOf('/') + 1)}`);
        });
    }

    // Get pool statistics
    function getState() {
        return {
            initialized: initialized,
            workerCount: workers.length,
            pendingJobs: pendingJobs.size,
            nextJobId: nextJobId
        };
    }

    // Enable/disable debug logging
    function setDebug(enabled) {
        debug = enabled;
    }

    // Internal logging
    function log(message) {
        if (debug) {
            console.log('[evostitch:worker-pool] ' + message);
        }
    }

    // Terminate all workers (cleanup)
    function terminate() {
        workers.forEach(function(worker) {
            worker.terminate();
        });
        workers = [];
        pendingJobs.clear();
        initialized = false;
        log('Worker pool terminated');
    }

    // Expose API
    window.evostitch = window.evostitch || {};
    window.evostitch.workerPool = {
        init: init,
        decode: decode,
        getState: getState,
        setDebug: setDebug,
        terminate: terminate
    };

})();
