'use strict';

// One-off: carry the hand-typed Monthly View into emh_bookings.
//   node scripts/import_emh_monthly_view.js --dry-run [--overrides path.json]
//   node scripts/import_emh_monthly_view.js [--overrides path.json]
// A real run refuses to start while any line is flagged, so nothing is guessed.
// Re-running is safe: a slot already stored for the same host and start is
// skipped. Keep the overrides file under docs/ (gitignored, the repo is public).

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', 'resources', '.env') });

const fs = require('node:fs');
const { URLSearchParams } = require('node:url');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { getSheetsClient } = require('../utils/sheets_cache');
const { SPREADSHEET_HOST_SESSIONS, GYM_CLASS_GUILD_ID } = require('../config/constants');
const { parseMonthlyView, usernameIdsFromRequirementCheck } = require('../utils/emh_monthly_view_parser');
const store = require('../utils/emh_schedule_queries');
const { closePool } = require('../db');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const overridesPath = args.includes('--overrides') ? args[args.indexOf('--overrides') + 1] : null;
const out = (line) => process.stdout.write(`${line}\n`);

const readTab = async (sheets, tab) => {
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_HOST_SESSIONS,
        range: `'${tab}'`,
        valueRenderOption: 'FORMULA',
    });
    return result.data.values || [];
};

// Exact username matches only; anything else stays flagged for Roy.
const lookupUsernames = async (usernames) => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const found = await Promise.all(usernames.map(async (username) => {
        const members = await rest.get(Routes.guildMembersSearch(GYM_CLASS_GUILD_ID), {
            query: new URLSearchParams({ query: username, limit: '5' }),
        });
        const exact = members.filter((m) => m.user.username.toLowerCase() === username);
        return exact.length === 1 ? [username, exact[0].user.id] : null;
    }));
    return Object.fromEntries(found.filter(Boolean));
};

const main = async () => {
    const overrides = overridesPath ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
    const sheets = await getSheetsClient();
    const [monthly, requirements] = await Promise.all([readTab(sheets, 'Monthly View'), readTab(sheets, 'Requirement Check')]);
    const fromSheet = usernameIdsFromRequirementCheck(requirements);
    const firstPass = parseMonthlyView(monthly, { usernameIds: fromSheet, overrides });
    const unknown = [...new Set(firstPass.flags.filter((f) => f.reason === 'unknown-user').map((f) => f.text.split('|')[2]))];
    const fromGuild = unknown.length ? await lookupUsernames(unknown) : {};
    const { entries, flags } = parseMonthlyView(monthly, { usernameIds: { ...fromSheet, ...fromGuild }, overrides });

    out(`Parsed ${entries.length} slot(s):`);
    entries.forEach((e) => out(`  ${e.date} ${e.rawTime.padEnd(7)} ${e.username.padEnd(18)} ${e.status.padEnd(9)} ${e.statusSource} ${(e.endsAt - e.startsAt) / 60000}min`));
    out(`\nFlagged ${flags.length} line(s) for Roy:`);
    flags.forEach((f) => out(`  [${f.reason}] ${f.date}: ${f.text}`));
    if (Object.keys(fromGuild).length) out(`\nResolved from the guild: ${JSON.stringify(fromGuild)}`);

    if (dryRun) return;
    if (flags.length) throw new Error('Resolve every flagged line in the overrides file before a real import.');

    const results = [];
    for (const entry of entries) {
        if (await store.bookingExists({ hostId: entry.hostId, startsAt: entry.startsAt })) {
            results.push('skipped');
            continue;
        }
        const result = await store.createBooking({
            hostId: entry.hostId,
            hostUsername: entry.username,
            startsAt: entry.startsAt,
            endsAt: entry.endsAt,
            createdBy: 'import',
            status: entry.status,
            statusSource: entry.statusSource,
        });
        if (result.conflict) out(`  CONFLICT ${entry.date} ${entry.rawTime} ${entry.username} vs ${result.conflict.hostUsername}`);
        results.push(result.conflict ? 'conflict' : 'created');
    }
    out(`\ncreated ${results.filter((r) => r === 'created').length}, skipped ${results.filter((r) => r === 'skipped').length}, conflicts ${results.filter((r) => r === 'conflict').length}`);
};

main()
    .catch((error) => {
        process.stderr.write(`Import failed: ${error.message}\n`);
        process.exitCode = 1;
    })
    .finally(() => closePool());
