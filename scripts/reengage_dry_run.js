'use strict';

// Read-only dry run of the re-engagement sweep. Runs real FF churn detection
// against the live sheet, renders the exact DM each lapsed player would receive,
// and writes everything to a CSV for program-lead review. Sends nothing and
// writes nothing to the database.
//
// Usage:
//   node scripts/reengage_dry_run.js [outputPath.csv]

require('dotenv').config({ path: './resources/.env' });

const fs = require('fs');
const path = require('path');
const ffAdapter = require('../programs/reengagement/adapters/ff_adapter');
const { buildHypeCopy } = require('../programs/reengagement/message_builder');

const OUT_PATH = process.argv[2]
    || path.join(process.cwd(), `reengage_dry_run_${new Date().toISOString().slice(0, 10)}.csv`);

// RFC-4180 CSV escaping: wrap in quotes and double any embedded quotes. Keeps
// newlines inside a field intact (valid when quoted) so the full message reads
// as one cell in Excel / Google Sheets.
const csvCell = (value) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

const renderMessage = (copy) =>
    [copy.headline.replace(/^##\s*/, ''), copy.standing, copy.sinceYouLeft, copy.challenge].join('\n\n');

const HEADERS = [
    'discord_id', 'in_game_name', 'last_active_season', 'seasons_lapsed',
    'points', 'wins', 'mmr', 'whats_new', 'dm_message',
];

(async () => {
    console.log('[DryRun] Detecting lapsed Friendly Fire players (read-only)...');
    const members = await ffAdapter.getLapsedMembers();

    // The changelog only depends on the season a player last played, so cache it
    // per season instead of hitting the sheet once per member.
    const changelogCache = new Map();
    const changelogFor = async (season) => {
        if (!changelogCache.has(season)) {
            changelogCache.set(season, await ffAdapter.getChangelogSince(season));
        }
        return changelogCache.get(season);
    };

    const lines = [csvRow(HEADERS)];
    const bySeason = new Map();

    for (const member of members) {
        const changelog = await changelogFor(member.lastActiveSeason);
        const copy = buildHypeCopy({ member, changelog });
        const stats = member.achievements || {};

        lines.push(csvRow([
            member.userId,
            member.inGameName,
            member.lastActiveSeason,
            member.lapsedSeasons,
            stats.points || '0',
            stats.wins || '0',
            stats.mmr || '0',
            changelog.join(' | '),
            renderMessage(copy),
        ]));

        bySeason.set(member.lastActiveSeason, (bySeason.get(member.lastActiveSeason) || 0) + 1);
    }

    fs.writeFileSync(OUT_PATH, `${lines.join('\n')}\n`, 'utf8');

    console.log(`\n[DryRun] ${members.length} lapsed players would be contacted in a no-limit prod run.`);
    console.log('[DryRun] Breakdown by last season played:');
    for (const season of [...bySeason.keys()].sort((a, b) => b - a)) {
        console.log(`  Season ${season}: ${bySeason.get(season)} players`);
    }
    console.log(`\n[DryRun] CSV written to: ${OUT_PATH}`);
    console.log('[DryRun] Note: at real send time, opted-out and already-contacted');
    console.log('[DryRun] players are skipped, and unreachable IDs are already excluded here.');
})().catch((error) => {
    console.error('[DryRun] Failed:', error.message);
    process.exit(1);
});
