'use strict';

const logger = require('../utils/logger');
const { noticePayload } = require('../utils/ui');
const {
    fetchLeaguesByOwner,
    fetchLeaguesByCoOwner,
    insertLeagueCheckin,
    updateLeagueCheckinDate,
    updateLeagueStatus,
} = require('../db');
const {
    GYM_CLASS_GUILD_ID,
    LEAGUE_OWNER_ROLE_ID,
    LEAGUE_CO_OWNER_ROLE_ID,
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
    SPONSORED_LEAGUE_ROLE_ID,
} = require('../config/constants');

function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function getTierRoleId(leagueType) {
    const map = {
        'Base': BASE_LEAGUE_ROLE_ID,
        'Active': ACTIVE_LEAGUE_ROLE_ID,
        'Sponsored': SPONSORED_LEAGUE_ROLE_ID,
    };
    return map[leagueType] || null;
}

async function restoreCoOwnerRoles(client, league) {
    const gymGuild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);
    const coOwnerIds = [league.co_owner_1, league.co_owner_2].filter(Boolean);
    for (const coOwnerId of coOwnerIds) {
        const member = await gymGuild.members.fetch(coOwnerId).catch(() => null);
        if (member) {
            await member.roles.add(LEAGUE_CO_OWNER_ROLE_ID).catch(() => {});
        }
    }
}

const handleLeagueCheckinModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    try {
        const activityNotes = interaction.fields.getTextInputValue('activity-notes') || '';
        const userId = interaction.user.id;
        const month = getCurrentMonth();

        const ownedLeagues = await fetchLeaguesByOwner(userId);
        const coOwnedLeagues = await fetchLeaguesByCoOwner(userId);
        const allLeagues = [...ownedLeagues, ...coOwnedLeagues];

        if (allLeagues.length === 0) {
            return interaction.editReply(
                noticePayload(
                    'You do not own or co-own any registered leagues.',
                    { title: 'No League Found', subtitle: 'League Check-in' }
                )
            );
        }

        const results = [];

        for (const league of allLeagues) {
            const isOwner = league.owner_id.toString() === userId;
            await insertLeagueCheckin(league.league_id, userId, activityNotes, month);
            await updateLeagueCheckinDate(league.league_id);

            if (league.league_status === 'Inactive') {
                await updateLeagueStatus(league.league_id, 'Active');

                try {
                    const gymGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);

                    const ownerMember = await gymGuild.members.fetch(league.owner_id.toString()).catch(() => null);
                    if (ownerMember) {
                        await ownerMember.roles.add(LEAGUE_OWNER_ROLE_ID).catch(() => {});
                        const tierRoleId = getTierRoleId(league.league_type);
                        if (tierRoleId) {
                            await ownerMember.roles.add(tierRoleId).catch(() => {});
                        }
                    }

                    await restoreCoOwnerRoles(interaction.client, league);

                    if (!isOwner) {
                        const callerMember = await gymGuild.members.fetch(userId).catch(() => null);
                        if (callerMember) {
                            await callerMember.roles.add(LEAGUE_CO_OWNER_ROLE_ID).catch(() => {});
                        }
                    }
                } catch (error) {
                    logger.error(`[Checkin] Failed to restore roles for league ${league.league_id}:`, error.message);
                }

                results.push(`**${league.league_name}** - reactivated`);
            } else {
                results.push(`**${league.league_name}** - confirmed`);
            }
        }

        return interaction.editReply(
            noticePayload(
                results,
                { title: 'Check-in Received', subtitle: month }
            )
        );
    } catch (error) {
        logger.error('[Checkin] Error processing check-in:', error);
        return interaction.editReply(
            noticePayload(
                'An error occurred while processing your check-in.',
                { title: 'Check-in Failed', subtitle: 'League Check-in' }
            )
        );
    }
};

module.exports = { handleLeagueCheckinModal };
