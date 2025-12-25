const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

let sheetsClient = null;
let sheetsClientPromise = null;
const rangeCache = new Map();

// Cache statistics
const cacheStats = {
    hits: 0,
    misses: 0,
    apiCalls: 0,
    totalApiTime: 0,
    lastReset: Date.now()
};

// Periodic cache cleanup interval
let cleanupInterval = null;
let statsResetInterval = null;

function getCacheKey(spreadsheetId, range) {
    return `${spreadsheetId}::${range}`;
}

async function getSheetsClient() {
    if (sheetsClient) return sheetsClient;
    if (!sheetsClientPromise) {
        sheetsClientPromise = (async () => {
            const { client_email, private_key } = credentials;
            const auth = new google.auth.JWT({
                email: client_email,
                key: private_key,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            await auth.authorize();
            return google.sheets({ version: 'v4', auth });
        })().catch((error) => {
            sheetsClientPromise = null;
            throw error;
        });
    }
    sheetsClient = await sheetsClientPromise;
    return sheetsClient;
}

async function getCachedValues({ sheets, spreadsheetId, ranges, ttlMs = 120000 }) {
    const startTime = Date.now();
    const now = Date.now();
    const results = new Map();
    const missing = [];

    // Check cache for each range
    for (const range of ranges) {
        if (results.has(range)) continue;
        const key = getCacheKey(spreadsheetId, range);
        const cached = rangeCache.get(key);
        if (cached && cached.expiresAt > now) {
            results.set(range, cached.values);
            cacheStats.hits++;
            continue;
        }
        rangeCache.delete(key);
        missing.push(range);
        cacheStats.misses++;
    }

    // Fetch missing ranges from API
    if (missing.length > 0) {
        const apiStartTime = Date.now();
        const response = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges: missing
        });
        const apiEndTime = Date.now();
        const apiDuration = apiEndTime - apiStartTime;

        cacheStats.apiCalls++;
        cacheStats.totalApiTime += apiDuration;

        const valueRanges = response.data.valueRanges || [];

        // Calculate total rows fetched
        let totalRows = 0;
        for (const vr of valueRanges) {
            totalRows += (vr.values || []).length;
        }

        console.log(`[Sheets API] Fetched ${missing.length} ranges (${totalRows} total rows) in ${apiDuration}ms`);

        for (let i = 0; i < missing.length; i += 1) {
            const range = missing[i];
            const values = valueRanges[i]?.values || [];
            const key = getCacheKey(spreadsheetId, range);
            rangeCache.set(key, { values, expiresAt: now + ttlMs });
            results.set(range, values);
        }
    }

    const totalTime = Date.now() - startTime;
    console.log(`[Cache] Total: ${totalTime}ms | Hits: ${cacheStats.hits - missing.length} | Misses: ${missing.length} | Cache size: ${rangeCache.size}`);

    return results;
}

// Warm cache with common ranges
async function warmCache({ spreadsheetId, ranges, ttlMs = 1800000 }) {
    try {
        const sheets = await getSheetsClient();
        console.log(`[Cache Warmer] Warming cache for ${ranges.length} ranges...`);
        const startTime = Date.now();
        await getCachedValues({ sheets, spreadsheetId, ranges, ttlMs });
        const duration = Date.now() - startTime;
        console.log(`[Cache Warmer] Cache warmed in ${duration}ms`);
    } catch (error) {
        console.error('[Cache Warmer] Error warming cache:', error.message);
    }
}

// Get cache statistics
function getCacheStats() {
    const uptime = Date.now() - cacheStats.lastReset;
    const hitRate = cacheStats.hits + cacheStats.misses > 0
        ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(2)
        : '0.00';
    const avgApiTime = cacheStats.apiCalls > 0
        ? (cacheStats.totalApiTime / cacheStats.apiCalls).toFixed(2)
        : '0.00';

    return {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hitRate: `${hitRate}%`,
        apiCalls: cacheStats.apiCalls,
        avgApiTime: `${avgApiTime}ms`,
        cacheSize: rangeCache.size,
        uptime: `${(uptime / 1000 / 60).toFixed(2)}min`
    };
}

// Clear cache (useful for manual refresh)
function clearCache() {
    rangeCache.clear();
    console.log('[Cache] Cache cleared');
}

// Clean up expired cache entries
function cleanupExpiredEntries() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, cached] of rangeCache.entries()) {
        if (cached.expiresAt <= now) {
            rangeCache.delete(key);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`[Cache Cleanup] Removed ${cleaned} expired entries. Cache size: ${rangeCache.size}`);
    }
}

// Reset cache statistics (prevents unbounded counter growth)
function resetCacheStats() {
    const oldStats = { ...cacheStats };
    cacheStats.hits = 0;
    cacheStats.misses = 0;
    cacheStats.apiCalls = 0;
    cacheStats.totalApiTime = 0;
    cacheStats.lastReset = Date.now();

    console.log('[Cache Stats] Reset statistics. Previous session:', {
        hits: oldStats.hits,
        misses: oldStats.misses,
        hitRate: oldStats.hits + oldStats.misses > 0
            ? ((oldStats.hits / (oldStats.hits + oldStats.misses)) * 100).toFixed(2) + '%'
            : '0%',
        apiCalls: oldStats.apiCalls,
        avgApiTime: oldStats.apiCalls > 0
            ? (oldStats.totalApiTime / oldStats.apiCalls).toFixed(2) + 'ms'
            : '0ms'
    });
}

// Start periodic maintenance tasks
function startCacheMaintenance() {
    if (cleanupInterval || statsResetInterval) {
        return; // Already started
    }

    // Clean up expired entries every 10 minutes
    cleanupInterval = setInterval(() => {
        cleanupExpiredEntries();
    }, 600000); // 10 minutes

    // Reset statistics every 24 hours to prevent unbounded counter growth
    statsResetInterval = setInterval(() => {
        resetCacheStats();
    }, 86400000); // 24 hours

    console.log('[Cache Maintenance] Started periodic cleanup (every 10 minutes) and stats reset (every 24 hours)');
}

// Stop periodic maintenance tasks
function stopCacheMaintenance() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log('[Cache Maintenance] Stopped');
    }
    if (statsResetInterval) {
        clearInterval(statsResetInterval);
        statsResetInterval = null;
        console.log('[Cache Maintenance] Stats reset stopped');
    }
}

module.exports = {
    getSheetsClient,
    getCachedValues,
    warmCache,
    getCacheStats,
    clearCache,
    startCacheMaintenance,
    stopCacheMaintenance,
    cleanupExpiredEntries
};
