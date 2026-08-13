'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const squadDb = require('../../utils/squad_db');
const { findABPair } = require('./squad_promote');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-demote')
        .setDescription('Demote a member from A team to B team')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('The member to demote')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const userId = interaction.user.id;
            const targetUser = interaction.options.getUser('member');

            if (!targetUser || targetUser.bot) {
                return interaction.editReply({ content: 'Invalid target user.' });
            }
            if (targetUser.id === userId) {
                return interaction.editReply({ content: 'You cannot demote yourself.' });
            }

            const pair = findABPair(await squadDb.fetchSquadsByOwner(userId));
            if (!pair) {
                return interaction.editReply({ content: 'You do not have both an A team and B team.' });
            }

            const result = await squadDb.moveMemberBetweenSquads(pair.aTeam.id, pair.bTeam.id, targetUser.id);
            if (!result.ok) {
                if (result.code === 'FULL') {
                    return interaction.editReply({ content: `Your B team (**${pair.bTeam.name}**) is full.` });
                }
                return interaction.editReply({ content: `**${targetUser.username}** is not on your A team (**${pair.aTeam.name}**).` });
            }

            logger.info(`[Demote] ${targetUser.id} moved ${pair.aTeam.name} -> ${pair.bTeam.name} by ${userId}`);
            return interaction.editReply({
                content: `**${targetUser.username}** has been moved from **${pair.aTeam.name}** (A) to **${pair.bTeam.name}** (B).`,
            });
        } catch (error) {
            logger.error('[Demote] Error:', error);
            return interaction.editReply({ content: 'An error occurred while demoting the member.' });
        }
    },
};
