'use strict';

// Central configuration for the re-engagement engine. Values that gate real
// sends come from the environment so the system can be run safely (allowlisted
// to a single user) before any wide rollout.

const FF_SHEET_ID = '1yxGmKTN27i9XtOefErIXKgcbfi1EXJHYWH7wZn_Cnok';

const parseIdList = (raw) =>
    String(raw || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

// When non-empty, the sender refuses to DM anyone whose ID is not on this list.
const getAllowlist = () => parseIdList(process.env.REENGAGE_ALLOWLIST);

// Users force-injected as synthetic targets (for testing against active players).
const getForceUserIds = () => parseIdList(process.env.REENGAGE_FORCE_USER_IDS);

// Master kill switch for the scheduled cron sweep.
const isEnabled = () => process.env.REENGAGE_ENABLED === 'true';

const config = Object.freeze({
    FF_SHEET_ID,
    // Per-run safety caps.
    MAX_PER_RUN: Number(process.env.REENGAGE_MAX_PER_RUN || 25),
    THROTTLE_MS: Number(process.env.REENGAGE_THROTTLE_MS || 2000),
    // Simulated lapse season used only for force-injected test targets.
    FORCE_SIMULATED_LAST_SEASON: Number(process.env.REENGAGE_FORCE_LAST_SEASON || 41),
    // Accent colour shared with /ff-stats.
    FF_ACCENT_COLOR: 0xff6b00,
});

module.exports = {
    config,
    getAllowlist,
    getForceUserIds,
    isEnabled,
    parseIdList,
};
