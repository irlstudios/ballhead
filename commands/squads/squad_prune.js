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
