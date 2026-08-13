'use strict';

// One-time import of the squads Google Sheet into Postgres (2026-08 squads
// migration). Operator-run from a machine with resources/.env; idempotent
// (ON CONFLICT DO NOTHING), so it is safe to re-run. --dry-run prints the
// plan without writing.

require('dotenv').config({ path: './resources/.env' });
const { getSheetsClient } = require('../utils/sheets_cache');
const { SPREADSHEET_SQUADS } = require('../config/constants');
const { planImport } = require('../utils/squad_import_logic');
const { executeQuery, closePool, ensureSquadsSchema } = require('../db');
const { setInvitesOptIn } = require('../utils/squad_db');

const dryRun = process.argv.includes('--dry-run');

(async () => {
    const sheets = await getSheetsClient();
    const get = async (range) => ((await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_SQUADS, range,
    })).data.values || []).slice(1);

    const plan = planImport({
        allData: await get('All Data!A:H'),
        squadLeaders: await get('Squad Leaders!A:G'),
        squadMembers: await get('Squad Members!A:E'),
    });

    console.log(`squads: ${plan.squads.length}, members: ${plan.members.length}, opt-outs: ${plan.optOuts.length}`);
    for (const anomaly of plan.anomalies) {
        console.log('ANOMALY:', anomaly);
    }
    if (dryRun) {
        await closePool();
        return;
    }

    await ensureSquadsSchema();

    let squadsInserted = 0;
    for (const s of plan.squads) {
        const r = await executeQuery(
            `INSERT INTO squads (name, squad_type, owner_id, owner_username, event_squad, open_squad, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
             ON CONFLICT (name, squad_type) DO NOTHING RETURNING id`,
            [s.name, s.squadType, s.ownerId, s.ownerUsername, s.eventSquad, s.openSquad, s.createdAt]
        );
        if (r.rows[0]) {
            squadsInserted += 1;
        }
    }

    // Second pass: B-team parent links (the owner's other Competitive squad).
    for (const s of plan.squads.filter((x) => x.parentName)) {
        await executeQuery(
            `UPDATE squads SET parent_squad_id = p.id FROM squads p
             WHERE squads.name = $1 AND squads.squad_type = $2
               AND p.name = $3 AND p.owner_id = squads.owner_id AND p.squad_type = 'Competitive'
               AND p.id <> squads.id`,
            [s.name, s.squadType, s.parentName]
        );
    }

    let membersInserted = 0;
    for (const m of plan.members) {
        // A name can exist as Casual + Competitive; sheet membership was
        // per-name, so attach to the Competitive squad when both exist.
        const r = await executeQuery(
            `INSERT INTO squad_members (squad_id, user_id, username, joined_at)
             SELECT id, $2, $3, COALESCE($4, NOW()) FROM squads WHERE name = $1
             ORDER BY (squad_type = 'Competitive') DESC LIMIT 1
             ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
            [m.squadName, m.userId, m.username, m.joinedAt]
        );
        if (r.rows[0]) {
            membersInserted += 1;
        }
    }

    for (const userId of plan.optOuts) {
        await setInvitesOptIn(userId, false);
    }

    console.log(`import complete: ${squadsInserted} squads, ${membersInserted} members, ${plan.optOuts.length} opt-outs written`);
    await closePool();
})().catch((e) => {
    console.error('IMPORT FAILED:', e);
    process.exit(1);
});
