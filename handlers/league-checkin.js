'use strict';

const logger = require('../utils/logger');
const { noticePayload } = require('../utils/ui');
const {
    fetchLeaguesByOwner,
    insertLeagueCheckin,
    updateLeagueCheckinDate,
    updateLeagueStatus,
} = require('../db');
const {
    GYM_CLASS_GUILD_ID,
    LEAGUE_OWNER_ROLE_ID,
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

const handleLeagueCheckinModal = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    try {
        const activityNotes = interaction.fields.getTextInputValue('activity-notes') || '';
        const userId = interaction.user.id;
        const month = getCurrentMonth();

        const leagues = await fetchLeaguesByOwner(userId);
        if (leagues.length === 0) {
            return interaction.editReply(
                noticePayload(
                    'You do not own any registered leagues.',
                    { title: 'No League Found', subtitle: 'League Check-in' }
                )
            );
        }

        const results = [];

        for (const league of leagues) {
            await insertLeagueCheckin(league.league_id, userId, activityNotes, month);
            await updateLeagueCheckinDate(league.league_id);

            if (league.league_status === 'Inactive') {
                await updateLeagueStatus(league.league_id, 'Active');

                try {
                    const gymGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                    const member = await gymGuild.members.fetch(userId).catch(() => null);
                    if (member) {
                        await member.roles.add(LEAGUE_OWNER_ROLE_ID).catch(() => {});
                        const tierRoleId = getTierRoleId(league.league_type);
                        if (tierRoleId) {
                            await member.roles.add(tierRoleId).catch(() => {});
                        }
                    }
                } catch (error) {
                    logger.error(`[Checkin] Failed to restore roles for ${userId}:`, error.message);
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
