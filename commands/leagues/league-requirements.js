'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, fetchCheckinMonths, countActiveStrikes } = require('../../db');
const {
    evaluateActiveLeagueRequirements,
    evaluateActiveLeagueRetention,
} = require('../../utils/league_enforcement');

const checklistLines = (checks) => checks.map(
    (c) => `${c.ok ? '[Met]' : '[Not met]'} ${c.label} - ${c.detail}`
);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-requirements')
        .setDescription('See where your league stands on the Active League requirements'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const leagues = await fetchLeaguesByOwner(interaction.user.id);
            const league = leagues[0];

            if (!league) {
                return interaction.editReply(
                    noticePayload('You do not own a league. Register one with **/apply base-league**.', {
                        title: 'No League Found',
                        subtitle: 'League Requirements',
                    })
                );
            }

            if (league.league_type === 'Sponsored') {
                return interaction.editReply(
                    noticePayload('Your league is Sponsored, the top tier. Tier requirements do not apply; your partnership is managed directly with the team.', {
                        title: 'Sponsored League',
                        subtitle: league.league_name,
                    })
                );
            }

            // Prefer the live guild count; fall back to the stored one.
            let memberCount = Number.isFinite(league.member_count) ? league.member_count : null;
            const leagueGuild = await interaction.client.guilds.fetch(league.server_id).catch(() => null);
            if (leagueGuild?.memberCount) {
                memberCount = leagueGuild.memberCount;
            }
            const activeStrikes = await countActiveStrikes(league.league_id);

            if (league.league_type === 'Active') {
                const retention = evaluateActiveLeagueRetention({
                    memberCount,
                    lastCheckinDate: league.last_checkin_date,
                    activeStrikes,
                });
                return interaction.editReply(
                    noticePayload(
                        [
                            'Your league is **Active**. To keep the tier, stay above the retention bar:',
                            '',
                            ...checklistLines(retention.checks),
                            '',
                            retention.ok
                                ? 'You are meeting everything. Keep it up.'
                                : 'Leagues below the bar are moved back to Base by the daily tier sync.',
                        ],
                        { title: 'Active League Retention', subtitle: league.league_name }
                    )
                );
            }

            const requirements = evaluateActiveLeagueRequirements({
                memberCount,
                approvalDate: league.approval_date,
                lastCheckinDate: league.last_checkin_date,
                checkinMonths: await fetchCheckinMonths(league.league_id),
                activeStrikes,
                healthStatus: league.health_status,
            });
            return interaction.editReply(
                noticePayload(
                    [
                        'Your league is **Base**. Meet every Active League requirement and the daily tier sync promotes you automatically:',
                        '',
                        ...checklistLines(requirements.checks),
                        '',
                        requirements.ok
                            ? 'You meet everything - promotion lands within a day.'
                            : 'See **/league guide** for how each requirement works.',
                    ],
                    { title: 'Active League Requirements', subtitle: league.league_name }
                )
            );
        } catch (error) {
            logger.error('[League Requirements] Error:', error);
            await interaction.editReply(
                noticePayload('Could not load your league requirements. Please try again later.', {
                    title: 'Requirements Unavailable',
                    subtitle: 'League Requirements',
                })
            ).catch(err => logger.error('[League Requirements] Failed to edit reply:', err));
        }
    },
};
