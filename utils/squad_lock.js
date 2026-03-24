'use strict';

const { invalidateRanges } = require('./sheets_cache');
const { SPREADSHEET_SQUADS } = require('../config/constants');

const locks = new Map();

const SQUAD_WRITE_RANGES = [
    'Squad Leaders!A:G',
    'Squad Members!A:E',
    'All Data!A:H',
];

async function withSquadLock(squadName, fn) {
    while (locks.get(squadName)) {
        await locks.get(squadName);
    }
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    locks.set(squadName, promise);
    try {
        return await fn();
    } finally {
        locks.delete(squadName);
        resolve();
        // Invalidate cached squad sheet ranges after any locked mutation
        invalidateRanges(SPREADSHEET_SQUADS, SQUAD_WRITE_RANGES);
    }
}

module.exports = { withSquadLock };
