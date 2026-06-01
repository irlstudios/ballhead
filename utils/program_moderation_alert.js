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

// Given a member's role ids and the per-program lead mapping, return one entry
// per program the member belongs to: { leadId, roleIds } where roleIds are the
// program's roles the member actually holds (in program order). Programs are
// returned in mapping order; a member in several programs yields several
// entries (so every relevant lead is pinged).
const resolveProgramMatches = (memberRoleIds, programLeads) => {
    const held = new Set(Array.isArray(memberRoleIds) ? memberRoleIds : []);
    return programLeads.reduce((acc, program) => {
        const roleIds = program.roleIds.filter((roleId) => held.has(roleId));
        if (roleIds.length === 0) {
            return acc;
        }
        return [...acc, { leadId: program.leadId, roleIds }];
    }, []);
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
    resolveProgramMatches,
    buildAlertText,
};
