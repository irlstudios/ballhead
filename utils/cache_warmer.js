const { warmCache, getCacheStats } = require('./sheets_cache');

const SPREADSHEET_ID = '1ZFLMKI7kytkUXU0lDKXDGSuNFn4OqZYnpyLIe6urVLI';
const CACHE_TTL_MS = 1800000; // 30 minutes
const WARM_INTERVAL_MS = 900000; // Warm every 15 minutes (before 30min TTL expires)

// All ranges used by content creator commands
const COMMON_RANGES = [
    // cc_check_account ranges
    'CC Applications!A:G',
    'TikTok Data!A:O',
    'YouTube Data!A:P',
    'Reels Data!A:O',
    'Active Creators!A:K',
    'Paid Creators!A:F',

    // cc_get_quality_score ranges
    'Base Creators!A:Z',

    // Season start date
    'Paid Creators!G2'
];

let warmerInterval = null;

async function startCacheWarmer() {
    console.log('[Cache Warmer] Starting cache warming system...');

    // Warm cache immediately on startup
    await warmCache({
        spreadsheetId: SPREADSHEET_ID,
        ranges: COMMON_RANGES,
        ttlMs: CACHE_TTL_MS
    });

    // Set up periodic warming
    warmerInterval = setInterval(async () => {
        console.log('[Cache Warmer] Periodic cache refresh triggered');
        await warmCache({
            spreadsheetId: SPREADSHEET_ID,
            ranges: COMMON_RANGES,
            ttlMs: CACHE_TTL_MS
        });

        // Log cache stats
        const stats = getCacheStats();
        console.log('[Cache Stats]', JSON.stringify(stats, null, 2));
    }, WARM_INTERVAL_MS);

    console.log(`[Cache Warmer] Cache will refresh every ${WARM_INTERVAL_MS / 1000 / 60} minutes`);
}

function stopCacheWarmer() {
    if (warmerInterval) {
        clearInterval(warmerInterval);
        warmerInterval = null;
        console.log('[Cache Warmer] Stopped');
    }
}

module.exports = {
    startCacheWarmer,
    stopCacheWarmer
};
