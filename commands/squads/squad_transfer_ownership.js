'use strict';

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags, ContainerBuilder, TextDisplayBuilder,
} = require('discord.js');
const squadDb = require('../../utils/squad_db');
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

            const ownedSquads = await squadDb.fetchSquadsByOwner(userId);
            const { squad, error } = squadDb.disambiguateOwnedSquad(ownedSquads, specifiedSquad);
            if (error) {
                return interaction.editReply({ content: error });
            }

            const squadName = squad.name;
            const squadType = squad.squad_type;

            // Verify target is a member of this squad
            const targetMembership = await squadDb.fetchMembership(targetUser.id);
            if (!targetMembership || targetMembership.squad.id !== squad.id) {
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
                squadId: squad.id,
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
