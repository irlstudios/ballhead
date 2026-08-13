'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

// Pure: find an owner's linked A/B pair among their squads, or null.
function findABPair(ownedSquads) {
    const bTeam = ownedSquads.find((s) => s.parent_squad_id !== null && s.parent_squad_id !== undefined);
    if (!bTeam) {
        return null;
    }
    const aTeam = ownedSquads.find((s) => s.id === bTeam.parent_squad_id);
    return aTeam ? { aTeam, bTeam } : null;
}

module.exports = {
    findABPair,
    data: new SlashCommandBuilder()
        .setName('squad-promote')
        .setDescription('Promote a member from B team to A team')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('The member to promote')
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
                return interaction.editReply({ content: 'You cannot promote yourself.' });
            }

            const pair = findABPair(await squadDb.fetchSquadsByOwner(userId));
            if (!pair) {
                return interaction.editReply({ content: 'You do not have both an A team and B team.' });
            }

            const result = await squadDb.moveMemberBetweenSquads(pair.bTeam.id, pair.aTeam.id, targetUser.id);
            if (!result.ok) {
                if (result.code === 'FULL') {
                    return interaction.editReply({ content: `Your A team (**${pair.aTeam.name}**) is full.` });
                }
                return interaction.editReply({ content: `**${targetUser.username}** is not on your B team (**${pair.bTeam.name}**).` });
            }

            logger.info(`[Promote] ${targetUser.id} moved ${pair.bTeam.name} -> ${pair.aTeam.name} by ${userId}`);
            return interaction.editReply({
                content: `**${targetUser.username}** has been moved from **${pair.bTeam.name}** (B) to **${pair.aTeam.name}** (A).`,
            });
        } catch (error) {
            logger.error('[Promote] Error:', error);
            return interaction.editReply({ content: 'An error occurred while promoting the member.' });
        }
    },
};
