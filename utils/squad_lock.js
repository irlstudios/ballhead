'use strict';

const locks = new Map();

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
    }
}

module.exports = { withSquadLock };
