'use strict';

// Decides who gets a mod-ping DM for one message. Pure so it can be unit
// tested without Discord or the database.
//
// A subscriber is skipped per role when they hold that pinged role (Discord
// already notified them natively) and always skipped when they authored the
// message. Users missing from heldRoleIdsByUserId are treated as holding
// nothing; the listener drops them later if the member fetch failed.
const resolveModPingDmTargets = ({ pingedRoleIds, subscriptions, authorId, heldRoleIdsByUserId }) => {
    const pinged = new Set(pingedRoleIds);
    const targets = new Map();
    for (const { user_id: userId, role_id: roleId } of subscriptions) {
        if (userId === authorId || !pinged.has(roleId)) {
            continue;
        }
        if (heldRoleIdsByUserId.get(userId)?.has(roleId)) {
            continue;
        }
        targets.set(userId, [...(targets.get(userId) ?? []), roleId]);
    }
    return targets;
};

module.exports = { resolveModPingDmTargets };
