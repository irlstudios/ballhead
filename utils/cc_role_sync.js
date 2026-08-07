'use strict';

// Discord roles granted to content creators, synced from the CC Master
// sheet's Creators tab by /cc-sync-roles.
const CC_ROLE_IDS = {
    CONTENT_CREATORS: '879910773831372811',
    CONTENT_CREATORS_REELS: '1130621784677421096',
    ACTIVE_REELS: '1202469981724483584',
};

// Content Creators is the umbrella role shared by every platform; holders of
// these per-platform roles are entitled to it even though they are not in the
// (Reels-only) Creators tab.
const PLATFORM_CC_ROLE_IDS = [
    '952651266658553946',  // TikTok
    '1202470065535062036', // YouTube
];

// Statuses beyond Base that earn the Active Reels role. Anything
// unrecognized is treated as Base so a typo in the sheet can only
// under-grant, never hand out Active Reels by accident.
const ACTIVE_TIER_STATUSES = new Set(['active', 'sponsored', 'sponsored alumni', 'alumni']);

const SNOWFLAKE_RE = /^\d{17,20}$/;

function desiredRoleIdsFor(status) {
    const roles = new Set([CC_ROLE_IDS.CONTENT_CREATORS, CC_ROLE_IDS.CONTENT_CREATORS_REELS]);
    if (ACTIVE_TIER_STATUSES.has(String(status || '').trim().toLowerCase())) {
        roles.add(CC_ROLE_IDS.ACTIVE_REELS);
    }
    return roles;
}

// rows: raw values from Creators!A:E (header row included).
// Columns: A Platform, B Status, C Username, D DD ID, E P ID.
function parseCreatorRows(rows) {
    return (rows || [])
        .map(row => ({
            status: String(row?.[1] || '').trim(),
            username: String(row?.[2] || '').trim(),
            ddId: String(row?.[3] || '').trim(),
        }))
        .filter(creator => SNOWFLAKE_RE.test(creator.ddId))
        .map(({ ddId, status, username }) => ({ ddId, status, username }));
}

// currentMembersByRole: { [roleId]: iterable of member ids holding it now }.
// platformMemberIds: ids holding a per-platform CC role (tiktok/youtube); they
// must hold the umbrella Content Creators role regardless of the sheet.
// Returns { add, remove }: per role, the member ids to change so that role
// membership exactly matches the sheet.
function buildSyncPlan(creators, currentMembersByRole, platformMemberIds = []) {
    const desiredByRole = {
        [CC_ROLE_IDS.CONTENT_CREATORS]: new Set(),
        [CC_ROLE_IDS.CONTENT_CREATORS_REELS]: new Set(),
        [CC_ROLE_IDS.ACTIVE_REELS]: new Set(),
    };
    for (const creator of creators) {
        for (const roleId of desiredRoleIdsFor(creator.status)) {
            desiredByRole[roleId].add(creator.ddId);
        }
    }
    for (const memberId of platformMemberIds) {
        desiredByRole[CC_ROLE_IDS.CONTENT_CREATORS].add(memberId);
    }

    const add = {};
    const remove = {};
    for (const [roleId, desired] of Object.entries(desiredByRole)) {
        const current = new Set(currentMembersByRole[roleId] || []);
        add[roleId] = [...desired].filter(id => !current.has(id));
        remove[roleId] = [...current].filter(id => !desired.has(id));
    }
    return { add, remove };
}

module.exports = {
    CC_ROLE_IDS,
    PLATFORM_CC_ROLE_IDS,
    parseCreatorRows,
    desiredRoleIdsFor,
    buildSyncPlan,
};
