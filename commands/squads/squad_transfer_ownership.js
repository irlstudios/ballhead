'use strict';

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags, ContainerBuilder, TextDisplayBuilder,
} = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID } = require('../../config/constants');
const { disambiguateSquad, findMemberRow } = require('../../utils/squad_queries');
const { insertTransferRequest } = require('../../db');
const logger = require('../../utils/logger');

const TRANSFER_EXPIRY_MS = 48 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-transfer-ownership')
        .setDescription('Transfer squad ownership to another member')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('The member to transfer ownership to')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('squad')
                .setDescription('Squad name (required if you own multiple)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const userId = interaction.user.id;
            const targetUser = interaction.options.getUser('member');
            const specifiedSquad = interaction.options.getString('squad');

            if (!targetUser) {
                return interaction.editReply({ content: 'Could not find the specified member.' });
            }
            if (targetUser.id === userId) {
                return interaction.editReply({ content: 'You cannot transfer ownership to yourself.' });
            }
            if (targetUser.bot) {
                return interaction.editReply({ content: 'You cannot transfer ownership to a bot.' });
            }

            const sheets = await getSheetsClient();
            const results = await getCachedValues({
                sheets,
                spreadsheetId: SPREADSHEET_SQUADS,
                ranges: ['Squad Leaders!A:G', 'Squad Members!A:E'],
                ttlMs: 30000,
            });
            const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
            const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);

            const { squad, error } = disambiguateSquad(squadLeaders, userId, specifiedSquad);
            if (error) {
                return interaction.editReply({ content: error });
            }

            const squadName = squad[2];
            const squadType = squad[3] || '';

            // Verify target is a member of this squad
            const targetMemberRow = findMemberRow(squadMembers, targetUser.id, squadName);
            if (!targetMemberRow) {
                return interaction.editReply({
                    content: `**${targetUser.username}** is not a member of **${squadName}**.`,
                });
            }

            // Send the transfer request message with buttons
            const expiresAt = new Date(Date.now() + TRANSFER_EXPIRY_MS);

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Squad Ownership Transfer'),
                new TextDisplayBuilder().setContent(
                    `**${interaction.user.username}** wants to transfer ownership of **${squadName}** (${squadType}) to **${targetUser.username}**.\n\nThis request expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>.`
                )
            );

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('transfer-accept')
                    .setLabel('Accept')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('transfer-decline')
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger)
            );

            const dmMessage = await targetUser.send({
                flags: MessageFlags.IsComponentsV2,
                components: [container, buttons],
            }).catch(() => null);

            if (!dmMessage) {
                return interaction.editReply({
                    content: `Could not DM **${targetUser.username}**. They may have DMs disabled.`,
                });
            }

            // Store in DB
            await insertTransferRequest({
                leaderId: userId,
                targetId: targetUser.id,
                squadName,
                squadType,
                messageId: dmMessage.id,
                expiresAt,
            });

            await interaction.editReply({
                content: `Transfer request sent to **${targetUser.username}** for **${squadName}**. They have 48 hours to respond.`,
            });

        } catch (error) {
            logger.error('[Squad Transfer] Error:', error);
            await interaction.editReply({ content: 'An error occurred while creating the transfer request.' });
        }
    },
};
