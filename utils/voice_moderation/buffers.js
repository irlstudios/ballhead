'use strict';

// Per-user ring buffers of encoded opus packets for one voice channel. Packets
// stay opus until someone clips or monitors, so a full room costs well under a
// megabyte per speaker for the whole window. Arrival timestamps are supplied by
// the caller, which keeps this module clock-free and the tests deterministic.
//
// Contained mutation: the store is module-internal state owned by one capture
// session, the same pattern as host_session_manager's Maps.

// ponytail: shift()-based eviction and per-user-only expiry; a departed
// speaker's audio lingers until session end (bounded ~750KB per 5 talked
// minutes). Move to a head-index ring plus periodic sweep if memory matters.
const createStore = ({ windowMs }) => ({ windowMs, users: new Map() });

const recordPacket = (store, userId, packet, atMs) => {
    let entries = store.users.get(userId);
    if (!entries) {
        entries = [];
        store.users.set(userId, entries);
    }
    entries.push({ at: atMs, packet });
    const cutoff = atMs - store.windowMs;
    while (entries.length > 0 && entries[0].at < cutoff) {
        entries.shift();
    }
};

const packetsBetween = (store, startMs, endMs) => {
    const result = new Map();
    for (const [userId, entries] of store.users) {
        const inRange = entries.filter((entry) => entry.at >= startMs && entry.at <= endMs);
        if (inRange.length > 0) result.set(userId, inRange);
    }
    return result;
};

const dropUser = (store, userId) => {
    store.users.delete(userId);
};

module.exports = { createStore, recordPacket, packetsBetween, dropUser };
