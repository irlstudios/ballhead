'use strict';

// Pure helpers for the Dyno program-moderation alert: role matching and the
// human-readable alert body. Kept free of Discord/database side effects so the
// logic can be unit tested in isolation.

// Intersection of a member's role ids with the tracked program roles, returned
// in program-role order (stable, deterministic output for the alert).
const matchProgramRoles = (memberRoleIds, programRoleIds) => {
    const held = new Set(Array.isArray(memberRoleIds) ? memberRoleIds : []);
    return programRoleIds.filter((roleId) => held.has(roleId));
};

// Compose the alert body. `matchedRoleLabels` are display strings (role names
// or ids) already resolved by the caller so this stays side-effect free.
const buildAlertText = (params) => {
    const {
        action,
        userId,
        targetName,
        moderator,
        length,
        reason,
        matchedRoleLabels,
        messageUrl,
        rolesHistorical,
    } = params;

    const userReference = userId ? `<@${userId}> (\`${userId}\`)` : `**${targetName}**`;
    const roleSummary = rolesHistorical
        ? `Program role(s) they previously had: ${matchedRoleLabels.join(', ')}`
        : `Program role(s): ${matchedRoleLabels.join(', ')}`;

    const lines = [
        '## Program member moderated',
        `A program member just received a **${action}** moderation action.`,
        '',
        `**User:** ${userReference}`,
        `**Action:** ${action}`,
        `**Moderator:** ${moderator || 'Unknown'}`,
    ];

    if (length) {
        lines.push(`**Length:** ${length}`);
    }

    lines.push(`**Reason:** ${reason || 'No reason provided'}`);
    lines.push(roleSummary);
    lines.push(`[Jump to Dyno log](${messageUrl})`);

    return lines.join('\n');
};

module.exports = {
    matchProgramRoles,
    buildAlertText,
};
