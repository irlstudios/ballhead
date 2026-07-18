'use strict';

// Pure formatting for the public league directory (grouped Sponsored -> Active
// -> Base). No Discord/DB work so the grouping and wording are unit-testable.

const TIER_ORDER = Object.freeze(['Sponsored', 'Active', 'Base']);

function leagueLine(league) {
    const name = league.league_invite
        ? `[${league.league_name}](${league.league_invite})`
        : `**${league.league_name}**`;
    const parts = [`- ${name}`];
    if (league.member_count) {
        parts.push(`(${league.member_count} members)`);
    }
    // Only surface a non-healthy status; "Healthy" is the silent default.
    if (league.health_status && league.health_status !== 'Healthy') {
        parts.push(`— ${league.health_status}`);
    }
    return parts.join(' ');
}

function buildDirectoryLines(leagues) {
    if (!leagues || leagues.length === 0) {
        return ['No leagues are currently listed.'];
    }
    const lines = [];
    for (const tier of TIER_ORDER) {
        const group = leagues.filter((l) => l.league_type === tier);
        if (group.length === 0) {
            continue;
        }
        lines.push(`**${tier} Leagues**`);
        for (const league of group) {
            lines.push(leagueLine(league));
        }
        lines.push('');
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

module.exports = { TIER_ORDER, buildDirectoryLines };
