'use strict';

// The rule that makes public rooms a monitored privilege: a room may be
// public only while the PC transcriber is healthy and a capture worker is
// free. Pure decision; callers supply current facts.

const canGoPublic = ({ healthy, freeWorkers }) => {
    if (!healthy) return { ok: false, reason: 'unhealthy' };
    if (freeWorkers < 1) return { ok: false, reason: 'no-workers' };
    return { ok: true, reason: null };
};

module.exports = { canGoPublic };
