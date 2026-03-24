# Squads System Overhaul - Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Scope:** 2 bug fixes, 4 features, 1 deprecation

---

## 0. Cross-Cutting: Multi-Squad Data Model Changes

Multi-squad support (Sections 5, 6) fundamentally changes the single-row-per-user assumption used throughout the codebase. This section defines the data model changes that underpin multiple sections.

### "All Data" Sheet Migration

Currently: one row per user. With multi-squad: **one row per squad membership**.

A user who owns a Competitive squad "M3" and a Casual squad "M3" will have **two rows** in "All Data":
- Row 1: `username | userId | M3 | Competitive | ... | Yes | ...`
- Row 2: `username | userId | M3 | Casual | ... | Yes | ...`

**Impact:** Every command that queries All Data by userId via `.find(row => row[AD_ID] === userId)` must be audited. Commands that need a specific squad must use a composite lookup: `rows.filter(row => row[AD_ID] === userId)` then disambiguate by squad name or type.

### "Squad Leaders" Sheet Migration

Currently: one row per leader, columns A:F. With multi-squad: **one row per owned squad**, columns A:G.

New column layout (A:G):
- A: Discord Username
- B: Discord ID
- C: Squad Name
- D: Event Squad
- E: Open Squad
- F: Squad Made
- G: Parent Squad (blank = standalone/A-team, A-team squad name = B-team)

**Impact:** All queries to Squad Leaders must update from `A:F` to `A:G`. All clear/rewrite operations must preserve column G data by writing 7-column arrays. Every `.find(row => row[1] === userId)` must become `.filter(row => row[1] === userId)` with disambiguation.

**Files that query `Squad Leaders!A:F` and must update to `A:G`:**
- `commands/squads/squad_register.js` (line 66)
- `commands/squads/squad_disband.js` (line 26) - also clear/rewrite range at line 167
- `commands/squads/squad_force_disband.js` (line 44) - also clear/rewrite range at lines 218-229
- `commands/squads/squad_invite.js` (line 63)
- `commands/squads/squad_join.js` (line 53)
- `commands/squads/squad_leave.js` (line 38)
- `commands/squads/squad_remove_member.js` (line 67)
- `commands/squads/squad_roster.js` (line 324)
- `handlers/invites.js` (line 157)

### "All Data" Composite Lookup Rule

When updating or removing a specific squad membership from "All Data", always filter by **both `userId` AND `squadName`**, not just `userId`, to avoid modifying the wrong row. This applies to all leave, remove, disband, prune, promote, demote, and cut operations.

### Concurrency

All commands that write to "Squad Members", "Squad Leaders", or "All Data" sheets must wrap their write operations in `withSquadLock(squadName, fn)`. This includes: promote, demote, cut, prune (manual), transfer accept, invite accept, disband, register, remove-from-squad, leave-squad, and join. The automated prune cron should also acquire locks per-squad as it processes each squad's members.

### Command Disambiguation

For multi-squad leaders, commands that operate on "the leader's squad" need to know WHICH squad. Strategy:
- Commands add an optional `squad` string parameter (squad name)
- If user owns only 1 squad: parameter is optional (defaults to their only squad)
- If user owns 2+ squads: parameter is required; if omitted, reply with "You own multiple squads. Please specify which squad: [list]"
- Affected commands: `/invite-to-squad`, `/disband-squad`, `/squad-roster`, `/squad-practice`, `/change-squad-name`, `/squad-prune`

### Squad Name Uniqueness

Current check in `squad_register.js`: blocks if squad name already exists in Squad Leaders. Updated rule: **block if squad name is taken by a DIFFERENT user**. Same user can register the same name for a different squad type.

### Role Safety on Disband/Leave/Transfer

Currently `squad_disband.js` removes all `SQUAD_OWNER_ROLES` from the leader. With multi-squad, disbanding one squad must only strip roles that are no longer applicable:
- Before removing a role, check if the user still owns another squad that requires it
- `SQUAD_LEADER_ROLE_ID`: only remove if user owns zero squads after the operation
- `COMPETITIVE_SQUAD_OWNER_ROLE_ID`: only remove if user owns zero competitive squads after the operation
- Update `SQUAD_OWNER_ROLES` array in `constants.js` to remove `CONTENT_SQUAD_OWNER_ROLE_ID`

---

## 1. Content Squad Deprecation

### Goal
Remove content squads as a squad type. No new content squads can be created. Existing ones age out naturally.

### Changes

**Config:**
- `config/squads.js`: Remove `contentSquadLevelRoles` array and `getSquadTypeRoles` Content branch. Explicitly: `getSquadTypeRoles('Casual')` returns `[]` (casual squads have no level roles).
- `config/constants.js`: Remove `CONTENT_SQUAD_OWNER_ROLE_ID`, `SPREADSHEET_CONTENT_POSTS`. Update `SQUAD_OWNER_ROLES` array to exclude content role.

**Commands:**
- `squad_register.js`: Remove "Content" from squad type choices (only Competitive and Casual)
- `squad_roster.js`: Remove content post tracking/display logic
- `squad_disband.js` / `squad_force_disband.js`: Remove content-specific role cleanup
- `squad_remove_member.js`: Remove content role references

**No migration:** Existing content squad rows in sheets remain as historical data.

---

## 2. Top Comp Squad Role (Bug Fix)

### Goal
Automatically assign role `1200889836844896316` to all members of the #1 ranked competitive squad. Announce weekly.

### Constants
Extract hardcoded role ID to `config/constants.js`:
```
TOP_COMP_SQUAD_ROLE_ID = '1200889836844896316'
TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID = '828618109794385970'
```
Update `squad_remove_member.js` and `squad_force_disband.js` to use the constant instead of hardcoded value.

### Behavior

**Weekly announcement:** Every Friday at 4:00 PM `America/Chicago`
1. Fetch "Squads + Aggregate Wins" sheet from `SPREADSHEET_COMP_WINS`
2. Sum all weekly win columns per squad to determine total wins
3. Identify the #1 squad (if tie, both squads get the role)
4. Post announcement to `TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID` (canvas image matching existing leaderboard style: purple gradient background, gold/silver/bronze accent colors, squad name, total wins, member list)
5. Sync role: assign to all members of #1 squad, remove from anyone else who has it

**On member join:** When a user joins the current #1 squad (via invite or random join), assign the role immediately.

**Tracking:** Persist current top squad to DB table `squad_state`:

| Column | Type | Description |
|--------|------|-------------|
| key | varchar PK | State key (e.g., `top_comp_squad`) |
| value | varchar | State value (squad name) |
| updated_at | timestamp | Last updated |

On bot startup, load `top_comp_squad` from this table into memory. The join handler checks this in-memory value to determine if the role should be assigned.

### Error Handling
Scheduled job wraps in try/catch. On failure, log error to `BOT_BUGS_CHANNEL_ID` and do not crash the bot.

### New Files
- `utils/top_squad_sync.js` - Sync logic: determine top squad, assign/remove roles, post announcement
- Scheduled job registration in `events/ready.js`

### Data Flow
```
SPREADSHEET_COMP_WINS ("Squads + Aggregate Wins")
  -> Sum weekly columns per squad
  -> Rank by total wins
  -> #1 squad identified
  -> Fetch members from SPREADSHEET_SQUADS ("Squad Members" + "Squad Leaders")
  -> Assign/remove Discord role TOP_COMP_SQUAD_ROLE_ID
  -> Post announcement to TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID
  -> Persist top squad name to squad_state table
```

---

## 3. Squad Level Role Sync (Bug Fix)

### Goal
Automatically assign competitive squad level roles to all members based on their squad's level. Currently these roles exist in config but are never assigned.

### Behavior

**Daily sync:** Every day at 11:45 PM `America/Chicago` (staggered 14 minutes before prune to avoid API rate limits)
1. Fetch "Squads + Aggregate Wins" from `SPREADSHEET_COMP_WINS`
2. Calculate each competitive squad's level: `Math.floor(totalWins / 50) + 1`
3. Map level to role from `compSquadLevelRoles` array:
   - Level 1: `1288918067178508423`
   - Level 2: `1288918165417365576`
   - Level 3: `1288918209294237707`
   - Level 4+: `1288918281343733842`
4. For each competitive squad member:
   - Assign the correct level role
   - Remove any outdated level roles (e.g., if squad was level 2 and is now level 3, remove level 2 role)

**On member join:** When a user joins a competitive squad, immediately assign the squad's current level role.

**On member leave/removal:** Strip all level roles.

**Casual squads:** No level roles. `getSquadTypeRoles('Casual')` returns `[]`.

### Error Handling
Same pattern as Section 2: try/catch, log to bug channel, never crash.

### New Files
- `utils/squad_level_sync.js` - Level calculation and role sync logic
- Scheduled job registration in `events/ready.js`

---

## 4. Leaderboard Revamp

### Goal
Replace the current `squad_comp_leaderboard.js` with a single `/squad-leaderboard` command featuring a select menu dropdown with three views.

### Views

**All-Time Wins:**
- Sum all weekly columns per squad from "Squads + Aggregate Wins"
- Display top 10 squads ranked by total wins
- Show: rank, squad name, total wins, level

**Weekly Wins:**
- Use only the latest (rightmost) date column from "Squads + Aggregate Wins"
- Display top 10 squads ranked by wins that week
- Show: rank, squad name, weekly wins, all-time wins

**Top Contributors:**
- For each squad, find the member with the highest all-time wins from "Squad Members" sheet in `SPREADSHEET_COMP_WINS`
- Resolve Discord username from user ID via `guild.members.fetch()`
- Display one entry per squad: squad name, top contributor Discord username, their total wins
- Top 10 squads by their top contributor's wins

### UI Pattern
- Follows the `friendly_fire_leaderboard.js` pattern exactly
- Canvas image with gradient background (purple gradient, gold/silver/bronze ranks, same dimensions and fonts)
- `StringSelectMenuBuilder` with custom ID `squad-leaderboard-select`
- Command file exports `buildSquadLeaderboardPayload(view)` function
- Select menu handler in `interactionHandler.js` calls `buildSquadLeaderboardPayload(selectedView)`

### Files Changed
- `commands/squads/squad_comp_leaderboard.js` - Rewritten (renamed to `squad_leaderboard.js`)
- `interactionHandler.js` - Add handler for `squad-leaderboard-select` menu interaction

---

## 5. Ownership Transfer

### Goal
Allow a squad leader to transfer ownership to a current squad member.

### Command
`/squad-transfer-ownership @user [squad]`

The `squad` parameter is optional if the leader owns 1 squad, required if they own multiple (see Section 0 disambiguation rules).

### Flow
1. Leader runs command, selects a member of their squad
2. Validation (must not violate multi-squad rules from Section 6):
   - Target must be a member of the leader's specified squad
   - If target owns 0 squads: always allowed
   - If target owns 1 Casual and transfer is Competitive: target's Casual squad name must match the transferred squad name
   - If target owns 1 Competitive and transfer is Casual: target's Competitive squad name must match the transferred squad name
   - If target owns 1 Competitive and transfer is Competitive: block (would have 2 Competitive without A/B team qualification)
   - If target already owns Casual + Competitive: only allow if transfer qualifies as a valid B team (target's A team is level 50+)
   - If target already has A + B teams: block
3. Bot sends confirmation message with Accept/Decline buttons
4. **On accept (uses `withSquadLock` for concurrency safety):**
   - Re-validate: leader still owns the squad, target still a member
   - "Squad Leaders" sheet: Update row with new leader's username, ID (preserve all 7 columns including Parent Squad)
   - "All Data" sheet: Old leader's row for this squad `Is Squad Leader` -> `No`, new leader's row -> `Yes`
   - "Squad Members" sheet: Remove new leader's member row, add old leader as member
   - Discord roles: Apply role safety rules from Section 0 (only strip roles no longer needed)
   - DM both parties
5. **On decline:** Notify leader
6. **Expiry:** 48 hours. Expired transfers cleaned up on bot restart (added to `processExpiredInvites` pattern in `events/ready.js`).

### New Files
- `commands/squads/squad_transfer_ownership.js` - Slash command
- `handlers/transfer.js` - Button interaction handler

### DB
New table `transfer_requests`:

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| leader_id | varchar | Current leader Discord ID |
| target_id | varchar | Proposed new leader Discord ID |
| squad_name | varchar | Squad being transferred |
| squad_type | varchar | Competitive/Casual |
| message_id | varchar | Discord message with buttons |
| status | varchar | Pending/Accepted/Declined/Expired |
| expires_at | timestamp | 48hr expiry |
| created_at | timestamp | Creation time |

---

## 6. Multi-Squad System

### Goal
Allow users to own multiple squads under specific rules.

### Rules

**Tier 1 - Casual + Competitive:**
- Any user can own one Casual squad and one Competitive squad
- Both must share the same squad name
- No level requirement
- Users who own squads cannot be a member of another user's squad

**Tier 2 - A/B Team (Competitive only):**
- When a competitive squad reaches level 50 (requires 2450+ total wins, per formula `Math.floor(totalWins / 50) + 1 >= 50`), the owner can create a B team
- B team is a second competitive squad under the same owner
- B team can have any name
- Max: 1 A team + 1 B team per owner (2 competitive squads total)
- 10 members per team, 20 competitive members total under one owner

### A/B Team Management Commands

**`/squad-promote @user`** - Move member from B team to A team
- The A team and B team are identified automatically via the Parent Squad column in Squad Leaders. No `squad` parameter needed since a user can only have one A/B team pair.
- Validates: user is on B team, A team has capacity (<10)
- Uses `withSquadLock` for both squad names
- Updates SQUADS "Squad Members" sheet: changes squad name from B team to A team
- Updates SQUADS "All Data" sheet accordingly (find row by userId + B team squadName, update to A team squadName)
- Updates COMP_WINS "Squad Members" sheet: moves member's row to A team squad name. Historical wins stay with the member (column data preserved, only squad name column changes).

**`/squad-demote @user`** - Move member from A team to B team
- Same auto-identification via Parent Squad column, no `squad` parameter needed
- Same validation, locking, and cross-sheet update strategy as promote but reversed direction

**`/squad-cut @user`** - Remove from entire squad organization (both teams)
- Removes from whichever team they're on
- Strips all roles (level roles, mascot roles, top squad role if applicable)
- Updates all sheets (SQUADS + COMP_WINS)
- **Replaces `/remove-from-squad` for A/B team owners.** `/remove-from-squad` continues to work for single-squad leaders (removes from their one squad). For A/B team owners, `/remove-from-squad` is disabled with a message: "Use `/squad-cut`, `/squad-promote`, or `/squad-demote` to manage A/B team members."

### Display
- Roster footer for B teams shows: "ES, B Team of M3"
- Leaderboard shows A and B teams as separate entries with B team relationship indicated

### Data Model Changes
See Section 0 for "All Data", "Squad Leaders", and disambiguation changes.

**`squad_register.js` validation logic:**
- Count user's existing squads via `squadLeaders.filter(row => row[1] === userId)`
- If 0: allow Competitive or Casual
- If 1 Competitive: allow Casual with same name, OR B team if level 50+
- If 1 Casual: allow Competitive with same name
- If 1 Competitive + 1 Casual: allow B team if comp level 50+
- If already has A + B teams: block further competitive squad creation
- Max 3 total: 1 Casual + 1 Competitive (A) + 1 Competitive (B)

**Nickname format:**
- Single squad: `[SQUAD] username`
- Casual + Competitive (same name): `[SQUAD] username` (no change since same name)
- A/B teams: `[A_TEAM] username` (primary/A team name used)

### Commands Updated
- `squad_register.js` - Multi-squad validation logic
- `squad_disband.js` - Handle disbanding one of multiple squads (with role safety from Section 0)
- `squad_roster.js` - Show B team relationship in footer
- `squad_remove_member.js` - Disabled for A/B team owners (redirect to cut/promote/demote)
- `squad_leave.js` - N/A (owners cannot leave, only disband or transfer)

### New Files
- `commands/squads/squad_promote.js`
- `commands/squads/squad_demote.js`
- `commands/squads/squad_cut.js`

---

## 7. Prune Inactive Members

### Goal
Automatically and manually remove squad members who have left the Discord server.

### Automated Daily Scan
Runs at 11:59 PM `America/Chicago` (14 minutes after level role sync to avoid API rate limits):
1. Fetch all members from "Squad Members" sheet in `SPREADSHEET_SQUADS`
2. Fetch ALL guild members once via `guild.members.fetch()` (bulk fetch, not per-member) and build a Set of member IDs
3. For each squad member, check if their ID is in the guild member Set
4. If not in server:
   - Remove from "Squad Members" sheet
   - Update "All Data" sheet (remove the row for this squad membership)
   - Add to pruned list for that squad
5. After processing all members, DM each affected squad leader:
   - "The following members were removed from [SQUAD] because they left the server: [list]"

### Manual Command
`/squad-prune [squad]` - Squad leader runs on demand
- `squad` parameter follows Section 0 disambiguation rules
- Same logic as automated scan but scoped to the leader's specified squad
- Responds with: "Removed X members who left the server: [list]"
- If no inactive members: "All members are still in the server"

### COMP_WINS Sheet Scope
Prune does NOT remove rows from `SPREADSHEET_COMP_WINS` sheets. Historical win data is preserved for reporting accuracy. Only `SPREADSHEET_SQUADS` sheets ("Squad Members" and "All Data") are modified.

### Error Handling
Same pattern as Section 2: try/catch, log to bug channel, never crash.

### New Files
- `utils/squad_prune.js` - Shared prune logic (used by both cron and command)
- `commands/squads/squad_prune.js` - Slash command

---

## Scheduled Jobs Summary

| Job | Schedule | Timezone | Purpose |
|-----|----------|----------|---------|
| Top Comp Squad Announcement | Friday 4:00 PM | America/Chicago | Announce #1 squad, sync role |
| Level Role Sync | Daily 11:45 PM | America/Chicago | Assign level roles |
| Prune Inactive Members | Daily 11:59 PM | America/Chicago | Remove members who left server |

### Scheduling Implementation
Use `node-cron` (already a project dependency) with timezone support. Register all jobs in `events/ready.js`. Each job wraps in try/catch and logs errors to `BOT_BUGS_CHANNEL_ID`.

---

## New Commands Summary

| Command | Description |
|---------|-------------|
| `/squad-leaderboard` | Leaderboard with 3 views via select menu |
| `/squad-transfer-ownership @user [squad]` | Transfer squad ownership |
| `/squad-promote @user` | Move member from B team to A team |
| `/squad-demote @user` | Move member from A team to B team |
| `/squad-cut @user` | Remove member from entire squad organization |
| `/squad-prune [squad]` | Manually remove members who left the server |

---

## New DB Tables

### squad_state
| Column | Type | Description |
|--------|------|-------------|
| key | varchar PK | State key (e.g., `top_comp_squad`) |
| value | varchar | State value |
| updated_at | timestamp | Last updated |

### transfer_requests
| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| leader_id | varchar | Current leader Discord ID |
| target_id | varchar | Proposed new leader Discord ID |
| squad_name | varchar | Squad being transferred |
| squad_type | varchar | Competitive/Casual |
| message_id | varchar | Discord message with buttons |
| status | varchar | Pending/Accepted/Declined/Expired |
| expires_at | timestamp | 48hr expiry |
| created_at | timestamp | Creation time |

---

## Files Impact Summary

### New Files
- `utils/top_squad_sync.js`
- `utils/squad_level_sync.js`
- `utils/squad_prune.js`
- `commands/squads/squad_transfer_ownership.js`
- `commands/squads/squad_promote.js`
- `commands/squads/squad_demote.js`
- `commands/squads/squad_cut.js`
- `commands/squads/squad_prune.js`
- `handlers/transfer.js`

### Modified Files
- `config/squads.js` - Remove content roles, clarify casual returns empty
- `config/constants.js` - Remove content constants, add `TOP_COMP_SQUAD_ROLE_ID`, `TOP_SQUAD_ANNOUNCEMENT_CHANNEL_ID`, update `SQUAD_OWNER_ROLES`
- `commands/squads/squad_register.js` - Multi-squad logic, remove Content type, update name uniqueness check
- `commands/squads/squad_comp_leaderboard.js` - Rewrite as `squad_leaderboard.js`
- `commands/squads/squad_roster.js` - B team footer, remove content logic
- `commands/squads/squad_disband.js` - Multi-squad handling, role safety, remove content logic, update to A:G range
- `commands/squads/squad_force_disband.js` - Remove content logic, use `TOP_COMP_SQUAD_ROLE_ID` constant, update clear/rewrite ranges from A:F to A:G, filter Squad Leaders by squad name (not leader ID) to preserve other squad registrations, apply role safety rules from Section 0
- `commands/squads/squad_remove_member.js` - Remove content references, use `TOP_COMP_SQUAD_ROLE_ID` constant, disable for A/B team owners, use composite lookup (userId + squadName) for All Data
- `commands/squads/squad_join.js` - Assign top squad role + level role on join
- `commands/squads/squad_invite.js` - Add squad disambiguation for multi-squad leaders
- `commands/squads/squad_leave.js` - Strip level roles on leave, use composite lookup (userId + squadName) for All Data
- `handlers/invites.js` - Assign top squad role + level role on invite accept
- `interactionHandler.js` - Add leaderboard select menu handler, transfer button handler
- `events/ready.js` - Register scheduled jobs, add expired transfer cleanup
- `db.js` - Add `squad_state` and `transfer_requests` table operations

### Sheet Changes
- "Squad Leaders" sheet: Add `Parent Squad` column (G) for A/B team linkage. All queries update from A:F to A:G.
- "All Data" sheet: Now supports multiple rows per user (one per squad membership)
- "Squad Members" sheet: No schema change, but promote/demote updates squad name column
