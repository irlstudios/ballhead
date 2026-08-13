'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { GYM_CLASS_GUILD_ID } = require('../../config/constants');
const squadDb = require('../../utils/squad_db');
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
            const guild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);

            const ownedSquads = await squadDb.fetchSquadsByOwner(userId);
            const { squad, error } = squadDb.disambiguateOwnedSquad(ownedSquads, specifiedSquad);
            if (error) {
                return interaction.editReply({ content: error });
            }

            const allGuildMembers = await guild.members.fetch();
            const guildMemberIds = new Set(allGuildMembers.keys());

            const pruned = await pruneSquad(guild, guildMemberIds, squad);

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
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        } catch (error) {
            logger.error('[Squad Prune Command] Error:', error);
            return interaction.editReply({ content: 'An error occurred while pruning the squad.' });
        }
    },
};
