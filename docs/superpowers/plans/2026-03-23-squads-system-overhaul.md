# Squads System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Discord bot's squad system with bug fixes (Top Comp Squad role, level role sync), new features (leaderboard revamp, ownership transfer, multi-squad, A/B teams, prune), and content squad deprecation.

**Architecture:** Google Sheets remains the primary data store. PostgreSQL gets two new tables (squad_state, transfer_requests). New scheduled jobs use node-cron. A shared squad query utility centralizes multi-squad-aware sheet lookups. All existing commands are updated to support multiple rows per user.

**Tech Stack:** Node.js, discord.js, googleapis (Google Sheets API), node-cron, canvas (image generation), PostgreSQL (pg)

**Spec:** `docs/superpowers/specs/2026-03-23-squads-system-overhaul-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `utils/squad_queries.js` | Shared multi-squad-aware sheet lookup helpers (composite lookups, disambiguation) |
| `utils/top_squad_sync.js` | Determine #1 comp squad, assign/remove role, post announcement |
| `utils/squad_level_sync.js` | Calculate squad levels, assign/remove level roles |
| `utils/squad_prune.js` | Check guild membership, remove departed members from sheets |
| `commands/squads/squad_leaderboard.js` | Leaderboard with 3-view select menu |
| `commands/squads/squad_transfer_ownership.js` | Transfer ownership slash command |
| `commands/squads/squad_promote.js` | Move member B team -> A team |
| `commands/squads/squad_demote.js` | Move member A team -> B team |
| `commands/squads/squad_cut.js` | Remove member from entire squad organization |
| `commands/squads/squad_prune.js` | Manual prune command |
| `handlers/transfer.js` | Accept/decline button handler for ownership transfer |

### Modified Files

| File | Changes |
|------|---------|
| `config/constants.js` | Add TOP_COMP_SQUAD_ROLE_ID, TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID. Remove CONTENT_SQUAD_OWNER_ROLE_ID, SPREADSHEET_CONTENT_POSTS. Update SQUAD_OWNER_ROLES. |
| `config/squads.js` | Remove contentSquadLevelRoles. Remove Content branch from getSquadTypeRoles. |
| `db.js` | Add squad_state + transfer_requests table operations |
| `events/ready.js` | Register 3 scheduled jobs, add expired transfer cleanup |
| `interactionHandler.js` | Add squad-leaderboard-select handler, transfer button routing |
| `handlers/invites.js` | Use squad_queries helpers. Assign top squad role + level role on accept. Update range A:F -> A:G. |
| `commands/squads/squad_register.js` | Multi-squad validation, remove Content type, update name uniqueness, A:F -> A:G |
| `commands/squads/squad_invite.js` | Squad disambiguation for multi-squad leaders, A:F -> A:G |
| `commands/squads/squad_join.js` | Assign top squad + level role on join, multi-squad All Data handling, A:F -> A:G |
| `commands/squads/squad_leave.js` | Composite lookup (userId+squadName) for All Data, strip level roles, A:F -> A:G |
| `commands/squads/squad_disband.js` | Filter by squadName not userId in Squad Leaders, role safety, A:F -> A:G, 7-col arrays |
| `commands/squads/squad_force_disband.js` | Same as disband: filter by squadName, role safety, A:F -> A:G, use TOP_COMP_SQUAD_ROLE_ID constant |
| `commands/squads/squad_remove_member.js` | Composite lookup, use TOP_COMP_SQUAD_ROLE_ID constant, disable for A/B owners |
| `commands/squads/squad_roster.js` | B team footer display, remove content logic, A:F -> A:G |
| `commands/squads/squad_change_name.js` | Multi-squad disambiguation, A:F -> A:G |
| `commands/squads/squad_practice.js` | Multi-squad disambiguation, A:F -> A:G |
| `commands/squads/squad_comp_leaderboard.js` | Deleted (replaced by squad_leaderboard.js) |

---

## Phase 1: Foundation (Config, DB, Shared Utilities)

### Task 1: Update Config - Content Deprecation & New Constants

**Files:**
- Modify: `config/constants.js`
- Modify: `config/squads.js`

- [ ] **Step 1: Update `config/constants.js`**

Add new constants. Do NOT remove content constants yet (consumers still import them; they'll be removed in Phase 6 alongside consumer updates):

```javascript
// Add after existing constants
const TOP_COMP_SQUAD_ROLE_ID = '1200889836844896316';
const TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID = '828618109794385970';
const SL_PARENT_SQUAD = 6;
```

Update module.exports to add the new constants (keep all existing exports).

- [ ] **Step 2: Update `config/squads.js`**

Update `getSquadTypeRoles` to stop returning content roles for new code paths (keep `contentSquadLevelRoles` export for now since existing commands still import it; will be removed in Phase 6):
```javascript
function getSquadTypeRoles(squadType) {
    if (squadType === 'Competitive') return compSquadLevelRoles;
    return [];
}
```

- [ ] **Step 3: Verify bot starts without errors**

Run: `node index.js` (Ctrl+C after startup confirmation)
Expected: Bot starts, no missing constant errors.

- [ ] **Step 4: Commit**

```bash
git add config/constants.js config/squads.js
git commit -m "refactor: deprecate content squad constants, add top squad and level sync constants"
```

---

### Task 2: Add DB Tables (squad_state, transfer_requests)

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Add squad_state table operations to `db.js`**

Add after the existing table ensure functions:

```javascript
async function ensureSquadStateTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS squad_state (
            key VARCHAR(255) PRIMARY KEY,
            value VARCHAR(1024),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `;
    return executeQuery(query);
}

async function getSquadState(key) {
    const query = 'SELECT value, updated_at FROM squad_state WHERE key = $1';
    const result = await executeQuery(query, [key]);
    return result.rows[0] || null;
}

async function setSquadState(key, value) {
    const query = `
        INSERT INTO squad_state (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `;
    return executeQuery(query, [key, value]);
}
```

- [ ] **Step 2: Add transfer_requests table operations to `db.js`**

```javascript
async function ensureTransferRequestsTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS transfer_requests (
            id SERIAL PRIMARY KEY,
            leader_id VARCHAR(255) NOT NULL,
            target_id VARCHAR(255) NOT NULL,
            squad_name VARCHAR(255) NOT NULL,
            squad_type VARCHAR(50) NOT NULL,
            message_id VARCHAR(255),
            status VARCHAR(50) DEFAULT 'Pending',
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `;
    return executeQuery(query);
}

async function insertTransferRequest({ leaderId, targetId, squadName, squadType, messageId, expiresAt }) {
    const query = `
        INSERT INTO transfer_requests (leader_id, target_id, squad_name, squad_type, message_id, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `;
    const result = await executeQuery(query, [leaderId, targetId, squadName, squadType, messageId, expiresAt]);
    return result.rows[0];
}

async function fetchTransferRequestByMessageId(messageId) {
    const query = 'SELECT * FROM transfer_requests WHERE message_id = $1';
    const result = await executeQuery(query, [messageId]);
    return result.rows[0] || null;
}

async function updateTransferRequestStatus(messageId, status) {
    const query = 'UPDATE transfer_requests SET status = $1 WHERE message_id = $2';
    return executeQuery(query, [status, messageId]);
}

async function fetchExpiredPendingTransfers() {
    const query = "SELECT * FROM transfer_requests WHERE status = 'Pending' AND expires_at < NOW()";
    const result = await executeQuery(query);
    return result.rows;
}
```

- [ ] **Step 3: Update module.exports in `db.js`**

Add all new functions to exports:
```javascript
ensureSquadStateTable, getSquadState, setSquadState,
ensureTransferRequestsTable, insertTransferRequest,
fetchTransferRequestByMessageId, updateTransferRequestStatus,
fetchExpiredPendingTransfers,
```

- [ ] **Step 4: Verify tables are created**

Run: `node -e "const db = require('./db'); db.ensureSquadStateTable().then(() => db.ensureTransferRequestsTable()).then(() => { console.log('OK'); process.exit(); })"`
Expected: "OK" printed.

- [ ] **Step 5: Commit**

```bash
git add db.js
git commit -m "feat: add squad_state and transfer_requests DB tables"
```

---

### Task 3: Create Shared Squad Query Utility

This is the foundation for multi-squad support. All commands will use these helpers instead of raw `.find()` calls.

**Files:**
- Create: `utils/squad_queries.js`

- [ ] **Step 1: Create `utils/squad_queries.js`**

```javascript
'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const {
    SPREADSHEET_SQUADS,
    SPREADSHEET_COMP_WINS,
    AD_ID,
    SL_PARENT_SQUAD,
} = require('../config/constants');

const AD_SQUAD_NAME = 2;
const AD_SQUAD_TYPE = 3;
const AD_IS_LEADER = 6;
const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SM_ID = 1;
const SM_SQUAD_NAME = 2;

/**
 * Fetch all sheet data needed for squad operations.
 * Returns: { allData, squadLeaders, squadMembers } (headerless arrays)
 */
async function fetchSquadSheets(sheets) {
    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['All Data!A:H', 'Squad Leaders!A:G', 'Squad Members!A:E'],
        ttlMs: 30000,
    });
    const allData = (results.get('All Data!A:H') || []).slice(1);
    const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
    const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
    return { allData, squadLeaders, squadMembers };
}

/**
 * Find all squads a user leads.
 * Returns array of leader rows (may be 0, 1, 2, or 3).
 */
function findUserSquads(squadLeaders, userId) {
    return squadLeaders.filter(
        row => row && row.length > SL_ID && row[SL_ID] === userId
    );
}

/**
 * Find a specific squad leader row by userId + squadName.
 */
function findLeaderRow(squadLeaders, userId, squadName) {
    return squadLeaders.find(
        row => row && row.length > SL_SQUAD_NAME
            && row[SL_ID] === userId
            && row[SL_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    ) || null;
}

/**
 * Find all All Data rows for a user.
 */
function findUserAllDataRows(allData, userId) {
    return allData.filter(
        row => row && row.length > AD_ID && row[AD_ID] === userId
    );
}

/**
 * Find a specific All Data row by userId + squadName (composite lookup).
 */
function findAllDataRow(allData, userId, squadName) {
    return allData.find(
        row => row && row.length > AD_SQUAD_NAME
            && row[AD_ID] === userId
            && row[AD_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    ) || null;
}

/**
 * Find index of a specific All Data row by userId + squadName.
 */
function findAllDataRowIndex(allData, userId, squadName) {
    return allData.findIndex(
        row => row && row.length > AD_SQUAD_NAME
            && row[AD_ID] === userId
            && row[AD_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    );
}

/**
 * Find all members of a squad.
 */
function findSquadMembers(squadMembers, squadName) {
    return squadMembers.filter(
        row => row && row.length > SM_SQUAD_NAME
            && row[SM_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    );
}

/**
 * Find a specific member row by userId + squadName.
 */
function findMemberRow(squadMembers, userId, squadName) {
    return squadMembers.find(
        row => row && row.length > SM_SQUAD_NAME
            && row[SM_ID] === userId
            && row[SM_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
    ) || null;
}

/**
 * Check if a squad name is taken by a DIFFERENT user.
 * Same user can register the same name for a different type.
 */
function isSquadNameTaken(squadLeaders, squadName, userId) {
    return squadLeaders.some(
        row => row && row.length > SL_SQUAD_NAME
            && row[SL_SQUAD_NAME]?.toUpperCase() === squadName?.toUpperCase()
            && row[SL_ID] !== userId
    );
}

/**
 * Find A/B team pair for a user.
 * Returns { aTeam: leaderRow|null, bTeam: leaderRow|null }
 */
function findABTeams(squadLeaders, userId) {
    const userSquads = findUserSquads(squadLeaders, userId);
    const bTeam = userSquads.find(
        row => row.length > SL_PARENT_SQUAD && row[SL_PARENT_SQUAD] && row[SL_PARENT_SQUAD] !== ''
    ) || null;
    const aTeamName = bTeam ? bTeam[SL_PARENT_SQUAD] : null;
    const aTeam = aTeamName
        ? userSquads.find(row => row[SL_SQUAD_NAME]?.toUpperCase() === aTeamName.toUpperCase()) || null
        : null;
    return { aTeam, bTeam };
}

/**
 * Disambiguate which squad a leader wants to operate on.
 * Returns { squad: leaderRow, error: string|null }
 */
function disambiguateSquad(squadLeaders, userId, specifiedSquadName) {
    const userSquads = findUserSquads(squadLeaders, userId);
    if (userSquads.length === 0) {
        return { squad: null, error: 'You do not own any squads.' };
    }
    if (userSquads.length === 1) {
        return { squad: userSquads[0], error: null };
    }
    if (!specifiedSquadName) {
        const squadList = userSquads.map(r => r[SL_SQUAD_NAME]).join(', ');
        return {
            squad: null,
            error: `You own multiple squads. Please specify which squad: ${squadList}`,
        };
    }
    const match = userSquads.find(
        row => row[SL_SQUAD_NAME]?.toUpperCase() === specifiedSquadName.toUpperCase()
    );
    if (!match) {
        return { squad: null, error: `You do not own a squad named "${specifiedSquadName}".` };
    }
    return { squad: match, error: null };
}

/**
 * Determine which roles to remove after a squad operation.
 * Only removes roles the user no longer needs.
 * NOTE: Squad type is NOT in Squad Leaders (col D = Event Squad).
 * Must cross-reference All Data (col D = Squad Type) for type info.
 */
function getRolesToRemove(allData, squadLeaders, userId, removedSquadType) {
    const { SQUAD_LEADER_ROLE_ID, COMPETITIVE_SQUAD_OWNER_ROLE_ID } = require('../config/constants');
    const remainingSquads = findUserSquads(squadLeaders, userId);
    const rolesToRemove = [];

    if (remainingSquads.length === 0) {
        rolesToRemove.push(SQUAD_LEADER_ROLE_ID);
    }

    // Cross-reference All Data to check squad types (All Data col index 3 = Squad Type)
    const remainingUserRows = findUserAllDataRows(allData, userId);
    const hasCompSquad = remainingUserRows.some(
        row => row.length > AD_SQUAD_TYPE && row[AD_SQUAD_TYPE] === 'Competitive'
    );
    if (!hasCompSquad && removedSquadType === 'Competitive') {
        rolesToRemove.push(COMPETITIVE_SQUAD_OWNER_ROLE_ID);
    }

    return rolesToRemove;
}

module.exports = {
    fetchSquadSheets,
    findUserSquads,
    findLeaderRow,
    findUserAllDataRows,
    findAllDataRow,
    findAllDataRowIndex,
    findSquadMembers,
    findMemberRow,
    isSquadNameTaken,
    findABTeams,
    disambiguateSquad,
    getRolesToRemove,
    AD_SQUAD_NAME,
    AD_SQUAD_TYPE,
    AD_IS_LEADER,
    SL_ID,
    SL_SQUAD_NAME,
    SM_ID,
    SM_SQUAD_NAME,
};
```

- [ ] **Step 2: Commit**

```bash
git add utils/squad_queries.js
git commit -m "feat: add shared squad query utility for multi-squad support"
```

---

## Phase 2: Bug Fixes

### Task 4: Top Comp Squad Role Sync

**Files:**
- Create: `utils/top_squad_sync.js`

- [ ] **Step 1: Create `utils/top_squad_sync.js`**

```javascript
'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const {
    SPREADSHEET_COMP_WINS,
    SPREADSHEET_SQUADS,
    TOP_COMP_SQUAD_ROLE_ID,
    TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID,
    BALLHEAD_GUILD_ID,
    BOT_BUGS_CHANNEL_ID,
} = require('../config/constants');
const { getSquadState, setSquadState } = require('../db');
const { findSquadMembers } = require('./squad_queries');
const logger = require('./logger');

let currentTopSquad = null;

async function loadTopSquadFromDB() {
    const state = await getSquadState('top_comp_squad');
    currentTopSquad = state ? state.value : null;
    return currentTopSquad;
}

function getCurrentTopSquad() {
    return currentTopSquad;
}

/**
 * Calculate total wins for each squad from the aggregate wins sheet.
 * Returns Map<squadName, { totalWins, squadType, squadMade }>
 */
async function calculateSquadWins(sheets) {
    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_COMP_WINS,
        ranges: ["'Squads + Aggregate Wins'!A:ZZ"],
        ttlMs: 60000,
    });
    const rows = results.get("'Squads + Aggregate Wins'!A:ZZ") || [];
    const headers = rows[0] || [];
    const data = rows.slice(1);

    const squadWins = new Map();
    for (const row of data) {
        if (!row || !row[0]) continue;
        const squadName = row[0];
        const squadType = row[1] || '';
        const squadMade = row[2] || '';
        let totalWins = 0;
        for (let i = 3; i < row.length; i++) {
            const val = parseInt(row[i], 10);
            if (!isNaN(val)) totalWins += val;
        }
        squadWins.set(squadName, { totalWins, squadType, squadMade });
    }
    return squadWins;
}

/**
 * Find the #1 competitive squad(s) by total wins.
 * Returns array of squad names (usually 1, multiple if tie).
 */
function findTopSquads(squadWins) {
    let maxWins = 0;
    const topSquads = [];

    for (const [name, data] of squadWins) {
        if (data.squadType !== 'Competitive') continue;
        if (data.totalWins > maxWins) {
            maxWins = data.totalWins;
            topSquads.length = 0;
            topSquads.push(name);
        } else if (data.totalWins === maxWins && maxWins > 0) {
            topSquads.push(name);
        }
    }

    return { topSquads, maxWins };
}

/**
 * Build the announcement canvas image.
 */
function buildAnnouncementImage(topSquads, maxWins, memberNames) {
    const canvas = createCanvas(1000, 600);
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#4B0082');
    gradient.addColorStop(1, '#8A2BE2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.shadowBlur = 5;
    ctx.textAlign = 'center';
    ctx.fillText('Top Comp Squad', 500, 70);

    ctx.font = 'bold 80px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(topSquads.join(' & '), 500, 180);

    ctx.font = 'bold 40px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`${maxWins} Total Wins`, 500, 250);

    ctx.font = 'bold 30px "Anton SC", "Bebas Neue", sans-serif';
    ctx.fillStyle = '#C0C0C0';
    ctx.fillText('Members:', 500, 320);

    const membersPerRow = 3;
    for (let i = 0; i < memberNames.length; i++) {
        const row = Math.floor(i / membersPerRow);
        const col = i % membersPerRow;
        const x = 200 + col * 250;
        const y = 370 + row * 50;
        ctx.font = 'bold 24px "Anton SC", "Bebas Neue", sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(memberNames[i], x, y);
    }

    return new AttachmentBuilder(canvas.toBuffer(), { name: 'top-squad.png' });
}

/**
 * Main sync: determine top squad, sync role, post announcement.
 */
async function syncTopSquad(client, announce = true) {
    const sheets = await getSheetsClient();
    const guild = await client.guilds.fetch(BALLHEAD_GUILD_ID);

    const squadWins = await calculateSquadWins(sheets);
    const { topSquads, maxWins } = findTopSquads(squadWins);

    if (topSquads.length === 0) {
        logger.info('[Top Squad Sync] No squads with wins found.');
        return;
    }

    // Fetch squad members from SQUADS spreadsheet
    const squadsResults = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['Squad Members!A:E', 'Squad Leaders!A:G'],
        ttlMs: 30000,
    });
    const squadMembersData = (squadsResults.get('Squad Members!A:E') || []).slice(1);
    const squadLeadersData = (squadsResults.get('Squad Leaders!A:G') || []).slice(1);

    // Collect all member IDs for top squads (members + leaders)
    const topMemberIds = new Set();
    const topMemberNames = [];

    for (const squadName of topSquads) {
        const members = findSquadMembers(squadMembersData, squadName);
        for (const row of members) {
            if (row[1]) topMemberIds.add(row[1]);
        }
        const leader = squadLeadersData.find(
            r => r && r.length > 2 && r[2]?.toUpperCase() === squadName.toUpperCase()
        );
        if (leader && leader[1]) topMemberIds.add(leader[1]);
    }

    // Sync role: assign to top squad members, remove from others
    const role = await guild.roles.fetch(TOP_COMP_SQUAD_ROLE_ID);
    if (!role) {
        logger.error('[Top Squad Sync] Top Comp Squad role not found.');
        return;
    }

    const allMembers = await guild.members.fetch();

    for (const [memberId, member] of allMembers) {
        const hasRole = member.roles.cache.has(TOP_COMP_SQUAD_ROLE_ID);
        const shouldHaveRole = topMemberIds.has(memberId);

        if (shouldHaveRole && !hasRole) {
            await member.roles.add(TOP_COMP_SQUAD_ROLE_ID).catch(e =>
                logger.error(`[Top Squad Sync] Failed to add role to ${memberId}:`, e.message)
            );
        } else if (!shouldHaveRole && hasRole) {
            await member.roles.remove(TOP_COMP_SQUAD_ROLE_ID).catch(e =>
                logger.error(`[Top Squad Sync] Failed to remove role from ${memberId}:`, e.message)
            );
        }

        if (shouldHaveRole && member.user) {
            topMemberNames.push(member.displayName);
        }
    }

    // Persist top squad
    const topSquadValue = topSquads.join(',');
    await setSquadState('top_comp_squad', topSquadValue);
    currentTopSquad = topSquadValue;

    // Post announcement
    if (announce) {
        const channel = await guild.channels.fetch(TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID);
        if (channel) {
            const attachment = buildAnnouncementImage(topSquads, maxWins, topMemberNames);
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Top Comp Squad of the Week')
            );
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL('attachment://top-squad.png')
                )
            );
            await channel.send({
                flags: MessageFlags.IsComponentsV2,
                components: [container],
                files: [attachment],
            });
        }
    }

    logger.info(`[Top Squad Sync] Top squad: ${topSquads.join(', ')} with ${maxWins} wins. Role synced for ${topMemberIds.size} members.`);
}

module.exports = {
    syncTopSquad,
    loadTopSquadFromDB,
    getCurrentTopSquad,
    calculateSquadWins,
    findTopSquads,
};
```

- [ ] **Step 2: Commit**

```bash
git add utils/top_squad_sync.js
git commit -m "feat: add top comp squad sync utility with weekly announcement"
```

---

### Task 5: Squad Level Role Sync

**Files:**
- Create: `utils/squad_level_sync.js`

- [ ] **Step 1: Create `utils/squad_level_sync.js`**

```javascript
'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const {
    SPREADSHEET_SQUADS,
    BALLHEAD_GUILD_ID,
} = require('../config/constants');
const { compSquadLevelRoles } = require('../config/squads');
const { calculateSquadWins } = require('./top_squad_sync');
const { findSquadMembers } = require('./squad_queries');
const logger = require('./logger');

/**
 * Calculate squad level from total wins.
 */
function getSquadLevel(totalWins) {
    return Math.floor(totalWins / 50) + 1;
}

/**
 * Get the appropriate level role for a given level.
 * Levels 1-3 map to indices 0-2, level 4+ maps to index 3.
 */
function getLevelRole(level) {
    const index = Math.min(level - 1, compSquadLevelRoles.length - 1);
    return compSquadLevelRoles[index] || null;
}

/**
 * Sync level roles for all competitive squad members.
 */
async function syncLevelRoles(client) {
    const sheets = await getSheetsClient();
    const guild = await client.guilds.fetch(BALLHEAD_GUILD_ID);

    // Get squad wins for level calculation
    const squadWins = await calculateSquadWins(sheets);

    // Get all squad members
    const squadsResults = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['Squad Members!A:E', 'Squad Leaders!A:G'],
        ttlMs: 30000,
    });
    const squadMembersData = (squadsResults.get('Squad Members!A:E') || []).slice(1);
    const squadLeadersData = (squadsResults.get('Squad Leaders!A:G') || []).slice(1);

    const allGuildMembers = await guild.members.fetch();
    let updated = 0;

    // Build map: squadName -> level role
    const squadLevelMap = new Map();
    for (const [squadName, data] of squadWins) {
        if (data.squadType !== 'Competitive') continue;
        const level = getSquadLevel(data.totalWins);
        const roleId = getLevelRole(level);
        if (roleId) {
            squadLevelMap.set(squadName.toUpperCase(), roleId);
        }
    }

    // For each competitive squad member, assign correct level role
    for (const memberRow of squadMembersData) {
        if (!memberRow || !memberRow[1] || !memberRow[2]) continue;
        const userId = memberRow[1];
        const squadName = memberRow[2].toUpperCase();
        const correctRoleId = squadLevelMap.get(squadName);
        if (!correctRoleId) continue;

        const member = allGuildMembers.get(userId);
        if (!member) continue;

        // Assign correct role, remove outdated ones
        for (const roleId of compSquadLevelRoles) {
            const hasRole = member.roles.cache.has(roleId);
            if (roleId === correctRoleId && !hasRole) {
                await member.roles.add(roleId).catch(e =>
                    logger.error(`[Level Sync] Failed to add role to ${userId}:`, e.message)
                );
                updated++;
            } else if (roleId !== correctRoleId && hasRole) {
                await member.roles.remove(roleId).catch(e =>
                    logger.error(`[Level Sync] Failed to remove role from ${userId}:`, e.message)
                );
            }
        }
    }

    // Also sync leaders (they're squad members too)
    for (const leaderRow of squadLeadersData) {
        if (!leaderRow || !leaderRow[1] || !leaderRow[2]) continue;
        const userId = leaderRow[1];
        const squadName = leaderRow[2].toUpperCase();
        const correctRoleId = squadLevelMap.get(squadName);
        if (!correctRoleId) continue;

        const member = allGuildMembers.get(userId);
        if (!member) continue;

        for (const roleId of compSquadLevelRoles) {
            const hasRole = member.roles.cache.has(roleId);
            if (roleId === correctRoleId && !hasRole) {
                await member.roles.add(roleId).catch(e =>
                    logger.error(`[Level Sync] Failed to add leader role to ${userId}:`, e.message)
                );
                updated++;
            } else if (roleId !== correctRoleId && hasRole) {
                await member.roles.remove(roleId).catch(e =>
                    logger.error(`[Level Sync] Failed to remove leader role from ${userId}:`, e.message)
                );
            }
        }
    }

    logger.info(`[Level Sync] Updated ${updated} role assignments.`);
}

/**
 * Assign the correct level role to a single user when they join a squad.
 */
async function assignLevelRoleOnJoin(guild, userId, squadName) {
    const sheets = await getSheetsClient();
    const squadWins = await calculateSquadWins(sheets);
    const data = squadWins.get(squadName);
    if (!data || data.squadType !== 'Competitive') return;

    const level = getSquadLevel(data.totalWins);
    const roleId = getLevelRole(level);
    if (!roleId) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    await member.roles.add(roleId).catch(e =>
        logger.error(`[Level Sync] Failed to add join role to ${userId}:`, e.message)
    );
}

/**
 * Strip all level roles from a user.
 */
async function stripLevelRoles(guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    for (const roleId of compSquadLevelRoles) {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId).catch(e =>
                logger.error(`[Level Sync] Failed to strip role from ${userId}:`, e.message)
            );
        }
    }
}

module.exports = {
    syncLevelRoles,
    assignLevelRoleOnJoin,
    stripLevelRoles,
    getSquadLevel,
    getLevelRole,
};
```

- [ ] **Step 2: Commit**

```bash
git add utils/squad_level_sync.js
git commit -m "feat: add squad level role sync utility"
```

---

### Task 6: Register Scheduled Jobs

**Files:**
- Modify: `events/ready.js`

- [ ] **Step 1: Add cron job imports and registration to `events/ready.js`**

NOTE: Only register Top Squad and Level Sync crons here. Prune cron will be added in Task 8 after `utils/squad_prune.js` exists.

Add at top of file:
```javascript
const cron = require('node-cron');
const { syncTopSquad, loadTopSquadFromDB } = require('../utils/top_squad_sync');
const { syncLevelRoles } = require('../utils/squad_level_sync');
const { ensureSquadStateTable, ensureTransferRequestsTable, fetchExpiredPendingTransfers, updateTransferRequestStatus } = require('../db');
const logger = require('../utils/logger');
```

Add inside `execute(client)` function, after existing startup logic:

```javascript
// Ensure new DB tables
await ensureSquadStateTable();
await ensureTransferRequestsTable();

// Load top squad state from DB
await loadTopSquadFromDB();

// Process expired transfer requests
const expiredTransfers = await fetchExpiredPendingTransfers();
for (const transfer of expiredTransfers) {
    await updateTransferRequestStatus(transfer.message_id, 'Expired');
}
logger.info(`[Startup] Processed ${expiredTransfers.length} expired transfer requests.`);

// Weekly: Top Comp Squad Announcement - Friday 4:00 PM Chicago
cron.schedule('0 16 * * 5', async () => {
    try {
        await syncTopSquad(client, true);
    } catch (error) {
        logger.error('[Cron] Top Squad Sync failed:', error);
    }
}, { timezone: 'America/Chicago' });

// Daily: Level Role Sync - 11:45 PM Chicago
cron.schedule('45 23 * * *', async () => {
    try {
        await syncLevelRoles(client);
    } catch (error) {
        logger.error('[Cron] Level Role Sync failed:', error);
    }
}, { timezone: 'America/Chicago' });

// NOTE: Prune cron (11:59 PM Chicago) added in Task 8 after squad_prune.js is created

logger.info('[Startup] Scheduled jobs registered: Top Squad (Fri 4PM CT), Level Sync (11:45PM CT)');
```

- [ ] **Step 2: Verify node-cron is installed**

Run: `node -e "require('node-cron'); console.log('OK')"`
If fails: `npm install node-cron`

- [ ] **Step 3: Commit**

```bash
git add events/ready.js
git commit -m "feat: register scheduled jobs for top squad sync, level roles, and prune"
```

---

## Phase 3: Leaderboard Revamp

### Task 7: New Leaderboard Command

**Files:**
- Create: `commands/squads/squad_leaderboard.js`
- Delete: `commands/squads/squad_comp_leaderboard.js`
- Modify: `interactionHandler.js`

- [ ] **Step 1: Create `commands/squads/squad_leaderboard.js`**

Follow the `friendly_fire_leaderboard.js` pattern exactly. File includes:
- `LEADERBOARD_VIEWS` array with 3 options (All-Time Wins, Weekly Wins, Top Contributors)
- `buildLeaderboardSelectRow(selectedView)` function
- `buildSquadLeaderboardPayload(view)` async function that:
  - Fetches from SPREADSHEET_COMP_WINS
  - Computes data based on selected view
  - Generates canvas image (1000x1400, purple gradient, gold/silver/bronze ranks)
  - Returns `{ components, files }` or `{ errorContainer }`
- `execute(interaction)` slash command handler
- Exports: `data`, `execute`, `buildSquadLeaderboardPayload`, `LEADERBOARD_VIEWS`

Command name: `squad-leaderboard`
Select menu custom ID: `squad-leaderboard-select`

For "Top Contributors" view: fetch "Squad Members" sheet from COMP_WINS, for each squad find the member with highest all-time wins, resolve Discord username via `guild.members.fetch(userId)`.

- [ ] **Step 2: Add select menu handler to `interactionHandler.js`**

In `handleSelectMenu` function (around line 144), add:
```javascript
if (interaction.customId === 'squad-leaderboard-select') {
    return handleSquadLeaderboardSelect(interaction);
}
```

Add handler function (similar to `handleFFLeaderboardSelect`):
```javascript
const { buildSquadLeaderboardPayload } = require('./commands/squads/squad_leaderboard');

async function handleSquadLeaderboardSelect(interaction) {
    await interaction.deferUpdate();
    const selectedView = interaction.values[0];
    const result = await buildSquadLeaderboardPayload(selectedView, interaction.client);
    if (result.errorContainer) {
        return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [result.errorContainer] });
    }
    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: result.components,
        files: result.files,
    });
}
```

- [ ] **Step 3: Delete old leaderboard file**

```bash
rm commands/squads/squad_comp_leaderboard.js
```

- [ ] **Step 4: Commit**

```bash
git add commands/squads/squad_leaderboard.js interactionHandler.js
git rm commands/squads/squad_comp_leaderboard.js
git commit -m "feat: revamp squad leaderboard with 3-view select menu"
```

---

## Phase 4: Prune System

### Task 8: Prune Utility & Command

**Files:**
- Create: `utils/squad_prune.js`
- Create: `commands/squads/squad_prune.js`

- [ ] **Step 1: Create `utils/squad_prune.js`**

```javascript
'use strict';

const { getSheetsClient, getCachedValues } = require('./sheets_cache');
const {
    SPREADSHEET_SQUADS,
    BALLHEAD_GUILD_ID,
} = require('../config/constants');
const { withSquadLock } = require('./squad_lock');
const { findSquadMembers } = require('./squad_queries');
const logger = require('./logger');

/**
 * Prune members who left the server from a specific squad.
 * Returns array of pruned member IDs.
 */
async function pruneSquad(sheets, guild, guildMemberIds, squadName, squadMembersData, allData) {
    const members = findSquadMembers(squadMembersData, squadName);
    const pruned = [];

    for (const row of members) {
        const userId = row[1];
        if (!userId) continue;
        if (!guildMemberIds.has(userId)) {
            pruned.push({ userId, username: row[0] || userId });
        }
    }

    if (pruned.length === 0) return pruned;

    return withSquadLock(squadName, async () => {
        // Re-fetch to avoid stale data
        const freshResults = await getCachedValues({
            sheets,
            spreadsheetId: SPREADSHEET_SQUADS,
            ranges: ['Squad Members!A:E', 'All Data!A:H'],
            ttlMs: 5000,
        });
        const freshMembers = (freshResults.get('Squad Members!A:E') || []);
        const freshAllData = (freshResults.get('All Data!A:H') || []);

        // Filter out pruned members from Squad Members
        const prunedIds = new Set(pruned.map(p => p.userId));
        const updatedMembers = freshMembers.filter((row, index) => {
            if (index === 0) return true; // Keep header
            return !(row && row[1] && prunedIds.has(row[1]) && row[2]?.toUpperCase() === squadName.toUpperCase());
        });

        // Filter out pruned members' rows for this squad from All Data
        const updatedAllData = freshAllData.filter((row, index) => {
            if (index === 0) return true;
            return !(row && row[1] && prunedIds.has(row[1]) && row[2]?.toUpperCase() === squadName.toUpperCase());
        });

        // Write back
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_SQUADS,
            range: 'Squad Members!A2:E',
        });
        if (updatedMembers.length > 1) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'Squad Members!A2',
                valueInputOption: 'RAW',
                resource: { values: updatedMembers.slice(1) },
            });
        }

        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_SQUADS,
            range: 'All Data!A2:H',
        });
        if (updatedAllData.length > 1) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'All Data!A2',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData.slice(1) },
            });
        }

        return pruned;
    });
}

/**
 * Prune all squads. Used by daily cron.
 */
async function pruneInactiveMembers(client) {
    const sheets = await getSheetsClient();
    const guild = await client.guilds.fetch(BALLHEAD_GUILD_ID);

    // Bulk fetch all guild members
    const allGuildMembers = await guild.members.fetch();
    const guildMemberIds = new Set(allGuildMembers.keys());

    const results = await getCachedValues({
        sheets,
        spreadsheetId: SPREADSHEET_SQUADS,
        ranges: ['Squad Members!A:E', 'Squad Leaders!A:G', 'All Data!A:H'],
        ttlMs: 30000,
    });
    const squadMembersData = (results.get('Squad Members!A:E') || []).slice(1);
    const squadLeadersData = (results.get('Squad Leaders!A:G') || []).slice(1);
    const allData = (results.get('All Data!A:H') || []).slice(1);

    // Get unique squad names
    const squadNames = [...new Set(squadMembersData
        .filter(row => row && row[2])
        .map(row => row[2])
    )];

    const prunedBySquad = new Map();

    for (const squadName of squadNames) {
        const pruned = await pruneSquad(sheets, guild, guildMemberIds, squadName, squadMembersData, allData);
        if (pruned.length > 0) {
            prunedBySquad.set(squadName, pruned);
        }
    }

    // DM squad leaders about pruned members
    for (const [squadName, pruned] of prunedBySquad) {
        const leader = squadLeadersData.find(
            r => r && r.length > 2 && r[2]?.toUpperCase() === squadName.toUpperCase()
        );
        if (!leader || !leader[1]) continue;

        const leaderMember = allGuildMembers.get(leader[1]);
        if (!leaderMember) continue;

        const names = pruned.map(p => p.username).join(', ');
        await leaderMember.send(
            `The following members were removed from **${squadName}** because they left the server: ${names}`
        ).catch(e => logger.error(`[Prune] Failed to DM leader ${leader[1]}:`, e.message));
    }

    const totalPruned = [...prunedBySquad.values()].reduce((sum, arr) => sum + arr.length, 0);
    logger.info(`[Prune] Removed ${totalPruned} inactive members from ${prunedBySquad.size} squads.`);
}

module.exports = {
    pruneSquad,
    pruneInactiveMembers,
};
```

- [ ] **Step 2: Create `commands/squads/squad_prune.js`**

```javascript
'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID } = require('../../config/constants');
const { disambiguateSquad } = require('../../utils/squad_queries');
const { pruneSquad } = require('../../utils/squad_prune');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-prune')
        .setDescription('Remove squad members who have left the server')
        .addStringOption(opt =>
            opt.setName('squad')
                .setDescription('Squad name (required if you own multiple)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const userId = interaction.user.id;
            const specifiedSquad = interaction.options.getString('squad');
            const sheets = await getSheetsClient();
            const guild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);

            const results = await getCachedValues({
                sheets,
                spreadsheetId: SPREADSHEET_SQUADS,
                ranges: ['Squad Leaders!A:G', 'Squad Members!A:E', 'All Data!A:H'],
                ttlMs: 30000,
            });
            const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
            const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
            const allData = (results.get('All Data!A:H') || []).slice(1);

            const { squad, error } = disambiguateSquad(squadLeaders, userId, specifiedSquad);
            if (error) {
                return interaction.editReply({ content: error });
            }

            const squadName = squad[2];
            const allGuildMembers = await guild.members.fetch();
            const guildMemberIds = new Set(allGuildMembers.keys());

            const pruned = await pruneSquad(sheets, guild, guildMemberIds, squadName, squadMembers, allData);

            if (pruned.length === 0) {
                return interaction.editReply({ content: 'All members are still in the server.' });
            }

            const names = pruned.map(p => p.username).join(', ');
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## Squad Prune Results\nRemoved ${pruned.length} members who left the server: ${names}`
                )
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });

        } catch (error) {
            logger.error('[Squad Prune Command] Error:', error);
            await interaction.editReply({ content: 'An error occurred while pruning the squad.' });
        }
    },
};
```

- [ ] **Step 3: Register prune cron in `events/ready.js`**

Add import at top:
```javascript
const { pruneInactiveMembers } = require('../utils/squad_prune');
```

Add after the level sync cron registration:
```javascript
// Daily: Prune Inactive Members - 11:59 PM Chicago
cron.schedule('59 23 * * *', async () => {
    try {
        await pruneInactiveMembers(client);
    } catch (error) {
        logger.error('[Cron] Prune Inactive Members failed:', error);
    }
}, { timezone: 'America/Chicago' });
```

Update the log line to include Prune.

- [ ] **Step 4: Commit**

```bash
git add utils/squad_prune.js commands/squads/squad_prune.js events/ready.js
git commit -m "feat: add squad prune system (daily auto + manual command)"
```

---

## Phase 5: Ownership Transfer

### Task 9: Transfer Command & Handler

**Files:**
- Create: `commands/squads/squad_transfer_ownership.js`
- Create: `handlers/transfer.js`
- Modify: `interactionHandler.js`

- [ ] **Step 1: Create `commands/squads/squad_transfer_ownership.js`**

Slash command `/squad-transfer-ownership` with:
- `@user` option (required) - target member
- `squad` string option (optional) - for multi-squad disambiguation
- Validates: target is in leader's squad, target passes multi-squad rules
- Sends embed with Accept/Decline buttons (customId: `transfer-accept-{messageId}`, `transfer-decline-{messageId}`)
- Inserts into `transfer_requests` table with 48hr expiry
- Uses `disambiguateSquad` from `squad_queries.js`

- [ ] **Step 2: Create `handlers/transfer.js`**

Button handler for transfer accept/decline:
- On accept: uses `withSquadLock`, re-validates, updates all 3 sheets (Squad Leaders, Squad Members, All Data), swaps roles using `getRolesToRemove`, DMs both parties
- On decline: updates DB status, notifies leader
- Preserves all 7 columns when updating Squad Leaders

- [ ] **Step 3: Add transfer button routing to `interactionHandler.js`**

In `handleButton` function, add:
```javascript
if (interaction.customId.startsWith('transfer-')) {
    const { handleTransferButton } = require('./handlers/transfer');
    return handleTransferButton(interaction, interaction.customId.startsWith('transfer-accept') ? 'accept' : 'decline');
}
```

- [ ] **Step 4: Commit**

```bash
git add commands/squads/squad_transfer_ownership.js handlers/transfer.js interactionHandler.js
git commit -m "feat: add squad ownership transfer with accept/decline flow"
```

---

## Phase 6: Multi-Squad Migration (Existing Commands)

This is the largest phase. Every existing command that queries sheets by userId needs to be updated for multi-squad awareness.

### Task 10: Update `squad_register.js` for Multi-Squad

**Files:**
- Modify: `commands/squads/squad_register.js`

- [ ] **Step 1: Update sheet ranges from A:F to A:G**

Line 66: Change `'Squad Leaders!A:F'` to `'Squad Leaders!A:G'`

- [ ] **Step 2: Remove Content from squad type choices**

In the command builder options (around line 30), remove the Content choice so only Competitive and Casual remain:
```javascript
.addStringOption(option =>
    option.setName('squadtype')
        .setDescription('The type of squad')
        .setRequired(true)
        .addChoices(
            { name: 'Competitive', value: 'Competitive' },
            { name: 'Casual', value: 'Casual' },
        )
)
```

Also remove the content squad owner role import and assignment logic (lines 104-105, the `contentRole` check and assignment).

- [ ] **Step 3: Remove content constants and exports from config files**

Now that we're updating the consumer, safely remove from `config/constants.js`:
- `CONTENT_SQUAD_OWNER_ROLE_ID` constant and export
- `SPREADSHEET_CONTENT_POSTS` constant and export
- Update `SQUAD_OWNER_ROLES` to `[SQUAD_LEADER_ROLE_ID, COMPETITIVE_SQUAD_OWNER_ROLE_ID]`

Remove from `config/squads.js`:
- `contentSquadLevelRoles` array and export

- [ ] **Step 4: Replace single-squad validation with multi-squad logic**

Replace lines 74-84 (the "already own a squad" check) with full multi-squad validation:
```javascript
const { findUserSquads, findUserAllDataRows, isSquadNameTaken, AD_SQUAD_TYPE, AD_SQUAD_NAME, SL_SQUAD_NAME } = require('../../utils/squad_queries');
const { calculateSquadWins } = require('../../utils/top_squad_sync');
const { getSquadLevel } = require('../../utils/squad_level_sync');

// ... inside execute():
const userSquads = findUserSquads(squadLeadersHeaderless, userId);
const userAllDataRows = findUserAllDataRows(allDataHeaderless, userId);

// Determine types of existing squads via All Data (Squad Leaders doesn't store type)
const ownedTypes = userAllDataRows
    .filter(row => row[6] === 'Yes') // Is Squad Leader = Yes
    .map(row => ({ name: row[AD_SQUAD_NAME], type: row[AD_SQUAD_TYPE] }));

const ownsCasual = ownedTypes.find(s => s.type === 'Casual');
const ownsComp = ownedTypes.find(s => s.type === 'Competitive');
const ownsBTeam = userSquads.find(r => r.length > 6 && r[6] && r[6] !== '');

if (squadType === 'Casual') {
    if (ownsCasual) {
        return interaction.editReply({ content: 'You already own a Casual squad.' });
    }
    if (ownsComp && ownsComp.name?.toUpperCase() !== squadName) {
        return interaction.editReply({
            content: `Your Casual squad must share the same name as your Competitive squad (${ownsComp.name}).`,
        });
    }
} else if (squadType === 'Competitive') {
    if (ownsComp && !ownsBTeam) {
        // They want a second comp squad (B team). Check level 50 requirement.
        const sheets = await getSheetsClient();
        const squadWins = await calculateSquadWins(sheets);
        const compData = squadWins.get(ownsComp.name);
        const level = compData ? getSquadLevel(compData.totalWins) : 0;
        if (level < 50) {
            return interaction.editReply({
                content: `Your Competitive squad must be level 50+ to create a B team. Current level: ${level}.`,
            });
        }
        // B team: set parentSquad to A team name
        isBTeam = true;
        aTeamSquadName = ownsComp.name;
    } else if (ownsComp && ownsBTeam) {
        return interaction.editReply({ content: 'You already own an A team and B team.' });
    } else if (ownsCasual && ownsCasual.name?.toUpperCase() !== squadName) {
        return interaction.editReply({
            content: `Your Competitive squad must share the same name as your Casual squad (${ownsCasual.name}).`,
        });
    }
}

// Check if user is a member of another squad (owners cannot join others)
const isMemberOfOther = userAllDataRows.some(
    row => row[6] !== 'Yes' && row[AD_SQUAD_NAME] && row[AD_SQUAD_NAME] !== 'N/A'
);
if (isMemberOfOther) {
    return interaction.editReply({ content: 'You must leave your current squad before creating one.' });
}
```

Declare `let isBTeam = false; let aTeamSquadName = '';` before the validation block.

- [ ] **Step 3: Update name uniqueness check**

Replace line 76 (`squadLeaders.find(...)`) with:
```javascript
if (isSquadNameTaken(squadLeadersHeaderless, squadName, userId)) {
    return interaction.editReply({ content: 'That squad name is already taken.' });
}
```

- [ ] **Step 4: Update sheet append to include Parent Squad column**

When appending to Squad Leaders, add 7th column (empty string for non-B-teams, A-team name for B-teams):
```javascript
const parentSquad = isBTeam ? aTeamSquadName : '';
// ... append row with 7 values including parentSquad
```

- [ ] **Step 5: Commit**

```bash
git add commands/squads/squad_register.js
git commit -m "feat: update squad register for multi-squad support"
```

---

### Task 11: Update `squad_disband.js` for Multi-Squad

**Files:**
- Modify: `commands/squads/squad_disband.js`

- [ ] **Step 1: Update ranges from A:F to A:G**

Line 26: `'Squad Leaders!A:F'` -> `'Squad Leaders!A:G'`

- [ ] **Step 2: Add disambiguation and withSquadLock**

Import `disambiguateSquad` from squad_queries. Add optional `squad` parameter to command. Use disambiguation at start of execute. Wrap all sheet write operations in `withSquadLock(squadName, fn)`.

- [ ] **Step 3: Filter Squad Leaders by squadName, not userId**

Replace line 144 filter (`row[1] !== userId`) with:
```javascript
const updatedSquadLeaders = squadLeaders.filter(
    row => !(row && row.length > 2 && row[2]?.toUpperCase() === squadName.toUpperCase())
);
```

- [ ] **Step 4: Apply role safety**

Import `getRolesToRemove` from squad_queries. After removing the squad's leader row from the sheet array, calculate remaining squads and only remove roles the user no longer needs.

- [ ] **Step 5: Update clear/rewrite to use A:G range with 7-column arrays**

Line 167: `'Squad Leaders!A2:F'` -> `'Squad Leaders!A2:G'`

- [ ] **Step 6: Commit**

```bash
git add commands/squads/squad_disband.js
git commit -m "refactor: update squad disband for multi-squad safety"
```

---

### Task 12: Update `squad_force_disband.js` for Multi-Squad

**Files:**
- Modify: `commands/squads/squad_force_disband.js`

Same pattern as Task 11:
- [ ] **Step 1:** Update ranges A:F -> A:G
- [ ] **Step 2:** Filter Squad Leaders by squadName, not leader ID (line 173)
- [ ] **Step 3:** Apply role safety using `getRolesToRemove(allData, squadLeaders, userId, squadType)` (check remaining squads before removing roles)
- [ ] **Step 4:** Update clear/rewrite to A:G with 7-column arrays (lines 218-229)
- [ ] **Step 5:** Replace hardcoded `'1200889836844896316'` with `TOP_COMP_SQUAD_ROLE_ID` constant
- [ ] **Step 6:** Also remove content-related imports (`contentSquadLevelRoles`) that are no longer needed
- [ ] **Step 7: Commit**

```bash
git add commands/squads/squad_force_disband.js
git commit -m "refactor: update force disband for multi-squad safety"
```

---

### Task 13: Update `squad_invite.js` for Multi-Squad

**Files:**
- Modify: `commands/squads/squad_invite.js`

- [ ] **Step 1:** Update range A:F -> A:G (line 63)
- [ ] **Step 2:** Add optional `squad` parameter to command builder
- [ ] **Step 3:** Replace `.find(row => row[1] === commandUserID)` (line 73) with `disambiguateSquad`
- [ ] **Step 4:** Update target checks to use composite lookups
- [ ] **Step 5: Commit**

```bash
git add commands/squads/squad_invite.js
git commit -m "refactor: update squad invite for multi-squad disambiguation"
```

---

### Task 14: Update `squad_join.js` for Multi-Squad

**Files:**
- Modify: `commands/squads/squad_join.js`

- [ ] **Step 1:** Update range A:F -> A:G (line 53)
- [ ] **Step 2:** Use `findUserSquads` instead of `.find` for leader check (line 63)
- [ ] **Step 3:** Assign top squad role + level role on join (import `getCurrentTopSquad` from top_squad_sync, `assignLevelRoleOnJoin` from squad_level_sync)
- [ ] **Step 4:** Handle multi-row All Data (use `findAllDataRow` for the target user's existing row or append new)
- [ ] **Step 5:** Wrap sheet writes in `withSquadLock(squadName, fn)`
- [ ] **Step 6: Commit**

```bash
git add commands/squads/squad_join.js
git commit -m "refactor: update squad join for multi-squad + role assignment on join"
```

---

### Task 15: Update `squad_leave.js` for Multi-Squad

**Files:**
- Modify: `commands/squads/squad_leave.js`

- [ ] **Step 1:** Update range A:F -> A:G (line 38)
- [ ] **Step 2:** Replace All Data `.findIndex` (line 107) with composite lookup using `findAllDataRowIndex(allData, userId, squadName)`
- [ ] **Step 3:** Strip level roles on leave using `stripLevelRoles` from squad_level_sync
- [ ] **Step 4:** Strip top squad role if applicable using `TOP_COMP_SQUAD_ROLE_ID`
- [ ] **Step 5:** Wrap sheet writes in `withSquadLock(squadName, fn)`
- [ ] **Step 6: Commit**

```bash
git add commands/squads/squad_leave.js
git commit -m "refactor: update squad leave for multi-squad + strip level roles"
```

---

### Task 16: Update `squad_remove_member.js` for Multi-Squad

**Files:**
- Modify: `commands/squads/squad_remove_member.js`

- [ ] **Step 1:** Update range A:F -> A:G (line 67)
- [ ] **Step 2:** Replace leader `.find` (line 79) with `findUserSquads` + disambiguation
- [ ] **Step 3:** Replace target All Data `.find` (line 146) with composite lookup (userId + squadName)
- [ ] **Step 4:** Replace hardcoded `'1200889836844896316'` with `TOP_COMP_SQUAD_ROLE_ID`
- [ ] **Step 5:** Add A/B team owner guard: if leader has B team, reject and redirect to `/squad-cut`
- [ ] **Step 6: Commit**

```bash
git add commands/squads/squad_remove_member.js
git commit -m "refactor: update remove member for multi-squad + A/B team guard"
```

---

### Task 17: Update `handlers/invites.js` for Multi-Squad

**Files:**
- Modify: `handlers/invites.js`

- [ ] **Step 1:** Update range A:F -> A:G (line 157)
- [ ] **Step 2:** Replace All Data `.findIndex` (line 210) with composite lookup
- [ ] **Step 3:** Add level role assignment on invite accept using `assignLevelRoleOnJoin`
- [ ] **Step 4:** Add top squad role assignment on invite accept (check `getCurrentTopSquad()`, if matching assign `TOP_COMP_SQUAD_ROLE_ID`)
- [ ] **Step 5:** Existing `withSquadLock` usage is already correct - just verify it wraps all new write operations too
- [ ] **Step 6: Commit**

```bash
git add handlers/invites.js
git commit -m "refactor: update invite handler for multi-squad + role assignment"
```

---

### Task 18: Update Remaining Commands

**Files:**
- Modify: `commands/squads/squad_roster.js`
- Modify: `commands/squads/squad_change_name.js`
- Modify: `commands/squads/squad_practice.js`
- Modify: `commands/squads/squad_opt_in.js`
- Modify: `commands/squads/squad_opt_out.js`

- [ ] **Step 1: Update `squad_roster.js`**
  - Update range A:F -> A:G (line 324)
  - Remove content roster logic (`fetchContentRoster` function, lines 118-250)
  - Remove `SPREADSHEET_CONTENT_POSTS` import (no longer exists)
  - Remove `contentSquadLevelRoles` import if present
  - Add B team footer display: if squad has Parent Squad (col G), show "B Team of [A-team]"
  - Remove content squad type branch in execute function

- [ ] **Step 2: Update `squad_change_name.js`**
  - Update range A:F -> A:G (line 36)
  - Add disambiguation for multi-squad leaders
  - Update name uniqueness to use `isSquadNameTaken` (allows same user, different type)

- [ ] **Step 3: Update `squad_practice.js`**
  - Update range (implicit through Squad Leaders fetch)
  - Add disambiguation for multi-squad leaders

- [ ] **Step 4: Update `squad_opt_in.js` and `squad_opt_out.js`**
  - These use All Data for preference, which now has multiple rows per user
  - Update ALL matching rows for the user (not just first found)

- [ ] **Step 5: Commit**

```bash
git add commands/squads/squad_roster.js commands/squads/squad_change_name.js commands/squads/squad_practice.js commands/squads/squad_opt_in.js commands/squads/squad_opt_out.js
git commit -m "refactor: update remaining squad commands for multi-squad support"
```

---

## Phase 7: A/B Team System

### Task 19: Promote, Demote, Cut Commands

**Files:**
- Create: `commands/squads/squad_promote.js`
- Create: `commands/squads/squad_demote.js`
- Create: `commands/squads/squad_cut.js`

- [ ] **Step 1: Create `commands/squads/squad_promote.js`**

Slash command `/squad-promote @user`:
- Uses `findABTeams` to auto-identify A and B team
- Validates: user is on B team, A team has capacity
- Uses `withSquadLock` for both squad names
- Updates SQUADS Squad Members (change squad name column)
- Updates SQUADS All Data (change squad name column, composite lookup)
- Updates COMP_WINS Squad Members (change squad name column, preserve win data)

- [ ] **Step 2: Create `commands/squads/squad_demote.js`**

Same structure as promote but reversed (A team -> B team).

- [ ] **Step 3: Create `commands/squads/squad_cut.js`**

Slash command `/squad-cut @user`:
- Finds which team the user is on (A or B)
- Removes from Squad Members, All Data sheets
- Strips all roles (level, mascot, top squad)
- Does NOT remove from COMP_WINS (historical data preserved)

- [ ] **Step 4: Commit**

```bash
git add commands/squads/squad_promote.js commands/squads/squad_demote.js commands/squads/squad_cut.js
git commit -m "feat: add A/B team management commands (promote, demote, cut)"
```

---

## Phase 8: Final Integration & Testing

### Task 20: End-to-End Verification

- [ ] **Step 1: Bot startup test**

Run: `node index.js`
Verify: No errors, all scheduled jobs registered, all commands loaded.

- [ ] **Step 2: Command registration**

Verify all new commands appear in Discord command list:
`/squad-leaderboard`, `/squad-transfer-ownership`, `/squad-promote`, `/squad-demote`, `/squad-cut`, `/squad-prune`

- [ ] **Step 3: Manual test matrix**

Test each critical flow:
1. Register a new Competitive squad
2. Register a Casual squad with the same name
3. Invite a member (disambiguation prompt if multi-squad)
4. View leaderboard (all 3 views)
5. Prune command (with no inactive members = "all good")
6. Transfer ownership (accept flow)
7. Disband one of multiple squads (role safety check)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: squads system overhaul - complete integration"
```
