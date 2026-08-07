const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const cron = require('node-cron');
const logger = require('../utils/logger');
const { executeQuery, fetchExpiredPendingInvites, deleteInvite, ensureInvitesSchema,
    ensureSquadStateTable, ensureTransferRequestsTable,
    fetchExpiredPendingTransfers, updateTransferRequestStatus,
    ensureFfOfficialApplicationsTable, ensureGameIdeasTables, ensureReengagementTables,
    ensurePollTables, getPollPostCount } = require('../db');
const { backfillAllForums } = require('../utils/poll_backfill');
const { syncTopSquad, loadTopSquadFromDB } = require('../utils/top_squad_sync');
const { syncLevelRoles } = require('../utils/squad_level_sync');
const { pruneInactiveMembers } = require('../utils/squad_prune');
require('dotenv').config({ path: './resources/.env' });
const { ensureLeagueActivitySchema, ensureLeagueOfficialsSchema, ensureLeagueContentSchema, ensureLeagueEnforcementSchema, ensureLeagueRewardsSchema } = require('../db');
const { runLeagueHealthCheck } = require('../jobs/league-health-check');
const { runLeagueTierSync } = require('../jobs/league-tier-sync');
const { sendCheckinReminder, sendCheckinWarning, processCheckinDeadline } = require('../jobs/league-checkin-cycle');
const { cleanReactedMessages } = require('../jobs/chat-reaction-cleanup');
const { syncRankRoles } = require('../jobs/rank-role-sync');
const { runWeeklyCommunityMetrics } = require('../jobs/community-metrics');
const { runReengagementSweep } = require('../jobs/reengagement');
const { runPollNudge } = require('../jobs/poll-nudge');
const { runTournySync } = require('../jobs/tourny-sync');
const { runLeaguesSheetSync } = require('../jobs/leagues-sheet-sync');
const { ensureHostSessionSchema } = require('../utils/host_session_queries');
const { resumeSessions } = require('../utils/host_session_manager');
const { ensureModPingSubscriptionsTable } = require('../utils/mod_ping_queries');

const ensureRoleTimeoutsTable = async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS role_timeouts (
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, role_id)
        )
    `);
};

const processExpiredRoleTimeouts = async (client) => {
    try {
        await ensureRoleTimeoutsTable();
        const result = await executeQuery(
            'SELECT user_id, role_id, guild_id FROM role_timeouts WHERE expires_at <= NOW()'
        ).catch(() => null);
        if (!result || result.rows.length === 0) return;

        for (const row of result.rows) {
            try {
                const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
                if (!guild) continue;
                const member = await guild.members.fetch(row.user_id).catch(() => null);
                if (member) {
                    await member.roles.remove(row.role_id).catch(() => null);
                    logger.info(`[Startup] Removed expired role ${row.role_id} from ${member.user.tag}`);
                }
                await executeQuery(
                    'DELETE FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                    [row.user_id, row.role_id]
                );
            } catch (err) {
                logger.error(`[Startup] Failed to process expired role timeout for ${row.user_id}:`, err);
            }
        }
    } catch (error) {
        logger.error('[Startup] Error processing expired role timeouts:', error);
    }
};

const scheduleFutureRoleTimeouts = async (client) => {
    try {
        const result = await executeQuery(
            'SELECT user_id, role_id, guild_id, expires_at FROM role_timeouts WHERE expires_at > NOW()'
        ).catch(() => null);
        if (!result || result.rows.length === 0) return;

        for (const row of result.rows) {
            const delay = new Date(row.expires_at).getTime() - Date.now();
            if (delay <= 0) continue;
            setTimeout(async () => {
                try {
                    // Re-check DB in case expiry was extended
                    const checkResult = await executeQuery(
                        'SELECT expires_at FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                        [row.user_id, row.role_id]
                    );
                    const current = checkResult.rows[0];
                    if (current && new Date(current.expires_at) > new Date()) {
                        return; // Was extended, skip
                    }
                    const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
                    if (!guild) return;
                    const member = await guild.members.fetch(row.user_id).catch(() => null);
                    if (member) {
                        await member.roles.remove(row.role_id).catch(() => null);
                        logger.info(`[Scheduled] Removed expired role ${row.role_id} from ${member.user.tag}`);
                    }
                    await executeQuery(
                        'DELETE FROM role_timeouts WHERE user_id = $1 AND role_id = $2',
                        [row.user_id, row.role_id]
                    );
                } catch (err) {
                    logger.error(`[Scheduled] Failed to process role timeout for ${row.user_id}:`, err);
                }
            }, delay);
        }
        logger.info(`[Startup] Scheduled ${result.rows.length} future role timeout(s)`);
    } catch (error) {
        logger.error('[Startup] Error scheduling future role timeouts:', error);
    }
};

const processExpiredInvites = async (_client) => {
    try {
        await ensureInvitesSchema();
        const expired = await fetchExpiredPendingInvites();
        for (const invite of expired) {
            try {
                await deleteInvite(invite.message_id);
                logger.info(`[Startup] Cleaned expired invite ${invite.message_id}`);
            } catch (err) {
                logger.error(`[Startup] Failed to clean expired invite ${invite.message_id}:`, err);
            }
        }
        if (expired.length > 0) {
            logger.info(`[Startup] Cleaned ${expired.length} expired invite(s)`);
        }
    } catch (error) {
        logger.error('[Startup] Error processing expired invites:', error);
    }
};

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        logger.info(`Logged in as ${client.user.tag}!`);

        const commands = client.commands.map(cmd => cmd.data.toJSON());
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        try {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            logger.info('Successfully registered application commands and refreshed!');
        } catch (error) {
            logger.error('Failed to register commands:', error);
        }

        await processExpiredRoleTimeouts(client);
        await scheduleFutureRoleTimeouts(client);
        await processExpiredInvites(client);

        // Ensure new DB tables. Each runs independently so a failure in one
        // does not prevent the others from being created.
        const migrations = [
            ['squad_state', ensureSquadStateTable],
            ['transfer_requests', ensureTransferRequestsTable],
            ['league_activity', ensureLeagueActivitySchema],
            ['league_officials', ensureLeagueOfficialsSchema],
            ['league_content', ensureLeagueContentSchema],
            ['league_enforcement', ensureLeagueEnforcementSchema],
            ['league_rewards', ensureLeagueRewardsSchema],
            ['ff_official_applications', ensureFfOfficialApplicationsTable],
            ['game_ideas', ensureGameIdeasTables],
            ['reengagement', ensureReengagementTables],
            ['poll', ensurePollTables],
            ['host_sessions', ensureHostSessionSchema],
            ['mod_ping_subscriptions', ensureModPingSubscriptionsTable],
        ];
        for (const [name, ensure] of migrations) {
            try {
                await ensure();
            } catch (error) {
                logger.error(`[DB] Failed to ensure ${name} schema:`, error);
            }
        }

        // Pick host event sessions back up after a restart, or close out the ones
        // whose host is no longer in the room so the sheet still gets its row.
        try {
            await resumeSessions(client);
        } catch (error) {
            logger.error('[Host Session] Failed to resume sessions:', error);
        }

        // One-time poll catalog catch-up: if poll_posts is empty (e.g. first run
        // after deploy), index existing forum posts in the background so autocomplete
        // and the context menu work without a manual script run. The forum listeners
        // keep the catalog fresh afterwards.
        try {
            if ((await getPollPostCount()) === 0) {
                logger.info('[Poll] Catalog empty; starting background backfill.');
                backfillAllForums(client).catch((error) => logger.error('[Poll] Backfill failed:', error));
            }
        } catch (error) {
            logger.error('[Poll] Backfill check failed:', error);
        }

        // Load top squad state from DB
        await loadTopSquadFromDB();

        // Process expired transfer requests
        try {
            const expiredTransfers = await fetchExpiredPendingTransfers();
            for (const transfer of expiredTransfers) {
                await updateTransferRequestStatus(transfer.message_id, 'Expired');
            }
            if (expiredTransfers.length > 0) {
                logger.info(`[Startup] Processed ${expiredTransfers.length} expired transfer request(s).`);
            }
        } catch (error) {
            logger.error('[Startup] Error processing expired transfers:', error);
        }

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

        // Daily: Reconcile squad membership and disband ownerless squads - 11:59 PM Chicago
        cron.schedule('59 23 * * *', async () => {
            try {
                await pruneInactiveMembers(client);
            } catch (error) {
                logger.error('[Cron] Squad Membership Cleanup failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Weekly: League Health Check - Sunday 12:00 PM Chicago
        cron.schedule('0 12 * * 0', async () => {
            try {
                await runLeagueHealthCheck(client);
            } catch (error) {
                logger.error('[Cron] League Health Check failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Daily: League Tier Sync - 12:30 PM Chicago (after the Sunday health
        // check refreshes member counts, promotions/demotions use fresh data)
        cron.schedule('30 12 * * *', async () => {
            try {
                await runLeagueTierSync(client);
            } catch (error) {
                logger.error('[Cron] League Tier Sync failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Monthly: Check-in Reminder - 1st of month 12:00 PM Chicago
        cron.schedule('0 12 1 * *', async () => {
            try {
                await sendCheckinReminder(client);
            } catch (error) {
                logger.error('[Cron] Check-in Reminder failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Monthly: Check-in Warning - 21st of month 12:00 PM Chicago
        cron.schedule('0 12 21 * *', async () => {
            try {
                await sendCheckinWarning(client);
            } catch (error) {
                logger.error('[Cron] Check-in Warning failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Monthly: Check-in Deadline - 28th of month 12:00 PM Chicago
        cron.schedule('0 12 28 * *', async () => {
            try {
                await processCheckinDeadline(client);
            } catch (error) {
                logger.error('[Cron] Check-in Deadline failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Hourly: Chat Reaction Cleanup
        cron.schedule('0 * * * *', async () => {
            try {
                await cleanReactedMessages(client);
            } catch (error) {
                logger.error('[Cron] Chat Reaction Cleanup failed:', error);
            }
        });

        // Weekly: Rank Role Sync - Wednesday midnight Chicago
        cron.schedule('0 0 * * 3', async () => {
            try {
                await syncRankRoles(client);
            } catch (error) {
                logger.error('[Cron] Rank Role Sync failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Weekly: Community Metrics - Monday 9:00 AM Chicago (summarizes trailing 7 days)
        cron.schedule('0 9 * * 1', async () => {
            try {
                await runWeeklyCommunityMetrics(client);
            } catch (error) {
                logger.error('[Cron] Community Metrics failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Weekly: Re-engagement sweep - Tuesday 10:00 AM Chicago. The sweep is a
        // no-op unless REENGAGE_ENABLED=true, and the sender further refuses to DM
        // anyone outside REENGAGE_ALLOWLIST when that is set.
        cron.schedule('0 10 * * 2', async () => {
            try {
                await runReengagementSweep(client);
            } catch (error) {
                logger.error('[Cron] Re-engagement sweep failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Daily: Top 5 nudge in idea/bug threads - 1:00 PM Chicago
        cron.schedule('0 13 * * *', async () => {
            try {
                await runPollNudge(client);
            } catch (error) {
                logger.error('[Cron] Poll nudge failed:', error);
            }
        }, { timezone: 'America/Chicago' });

        // Every 5 minutes: tourny officials sync. No-op unless TOURNY_API_URL /
        // TOURNY_API_KEY are set. TOURNY_DASHBOARD_URL is optional -- proof
        // links fall back to a fixed sentinel string when it is unset.
        cron.schedule('*/5 * * * *', async () => {
            try {
                await runTournySync(client);
            } catch (error) {
                logger.error('[Cron] Tourny sync failed:', error.message);
            }
        });

        // Daily: mirror the Active Leagues table into the leagues spreadsheet - 7:00 AM Chicago
        cron.schedule('0 7 * * *', async () => {
            try {
                await runLeaguesSheetSync();
            } catch (error) {
                logger.error('[Cron] Leagues Sheet Sync failed:', error.message);
            }
        }, { timezone: 'America/Chicago' });

        logger.info('[Startup] Scheduled jobs registered: Top Squad (Fri 4PM CT), Level Sync (11:45PM CT), Squad Membership Cleanup (11:59PM CT), League Health (Sun 12PM CT), Checkin Cycle (1st/21st/28th 12PM CT), Chat Reaction Cleanup (hourly), Rank Role Sync (Wed midnight CT), Community Metrics (Mon 9AM CT), Poll Nudge (daily 1PM CT), Tourny Sync (every 5min), Leagues Sheet Sync (daily 7AM CT), League Tier Sync (daily 12:30PM CT)');
    },
};
