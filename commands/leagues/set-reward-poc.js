'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { fetchLeaguesByOwner, setRewardPoc } = require('../../db');

const SUB = 'Reward POC';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-reward-poc')
        .setDescription('Name which owner/co-owner handles reward requests (Sponsored)')
        .addUserOption((o) => o.setName('user').setDescription('Owner or co-owner to designate').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const league = (await fetchLeaguesByOwner(interaction.user.id))[0] || null;
            if (!league) {
                return interaction.editReply(noticePayload('You do not own a registered league.', { title: 'No League Found', subtitle: SUB }));
            }
            if (league.league_type !== 'Sponsored') {
                return interaction.editReply(noticePayload('Only Sponsored leagues can set a reward POC.', { title: 'Sponsored Only', subtitle: SUB }));
            }

            const target = interaction.options.getUser('user');
            const eligible = [league.owner_id?.toString(), league.co_owner_1, league.co_owner_2].filter(Boolean).map(String);
            if (!eligible.includes(target.id)) {
                return interaction.editReply(noticePayload('The reward POC must be the owner or a co-owner of your league.', { title: 'Not an Owner/Co-Owner', subtitle: SUB }));
            }

            await setRewardPoc(league.league_id, target.id);
            return interaction.editReply(noticePayload(`<@${target.id}> is now the reward POC for **${league.league_name}**.`, { title: 'Reward POC Set', subtitle: SUB }));
        } catch (error) {
            logger.error('[Rewards] set-reward-poc failed:', error);
            return interaction.editReply(noticePayload('An error occurred while setting the reward POC.', { title: 'POC Error', subtitle: SUB }));
        }
    },
};
