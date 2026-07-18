'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { addRosterOfficial, removeRosterOfficial, listRosterOfficials } = require('../../db');

const SUB = 'Officials Roster';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('official-roster')
        .setDescription('Manage the league officials roster (staff)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand((s) => s
            .setName('add')
            .setDescription('Add or update an official on the roster')
            .addUserOption((o) => o.setName('user').setDescription('The official to add').setRequired(true))
            .addStringOption((o) => o.setName('sport').setDescription('Sport they officiate, or "Any"').setRequired(false).setMaxLength(60)))
        .addSubcommand((s) => s
            .setName('remove')
            .setDescription('Remove an official from the roster')
            .addUserOption((o) => o.setName('user').setDescription('The official to remove').setRequired(true)))
        .addSubcommand((s) => s
            .setName('list')
            .setDescription('List the active roster officials')),

    async execute(interaction) {
        // setDefaultMemberPermissions gates the command; re-check here because
        // server admins can override command permissions per-role in Discord.
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return interaction.reply({
                ...noticePayload('You do not have permission to manage the officials roster.', { title: 'Permission Denied', subtitle: SUB }),
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const sub = interaction.options.getSubcommand();

            if (sub === 'add') {
                const user = interaction.options.getUser('user');
                if (user.bot) {
                    return interaction.editReply(noticePayload('Bots cannot be officials.', { title: 'Invalid Official', subtitle: SUB }));
                }
                const sport = (interaction.options.getString('sport') || 'Any').trim() || 'Any';
                await addRosterOfficial({ discordId: user.id, discordName: user.username, sport, addedBy: interaction.user.id });
                return interaction.editReply(noticePayload(
                    `Added <@${user.id}> to the officials roster (sport: **${sport}**).`,
                    { title: 'Official Added', subtitle: SUB }
                ));
            }

            if (sub === 'remove') {
                const user = interaction.options.getUser('user');
                const removed = await removeRosterOfficial(user.id);
                return interaction.editReply(noticePayload(
                    removed ? `Removed <@${user.id}> from the officials roster.` : `<@${user.id}> is not on the active roster.`,
                    { title: removed ? 'Official Removed' : 'Not on Roster', subtitle: SUB }
                ));
            }

            // list
            const officials = await listRosterOfficials();
            if (officials.length === 0) {
                return interaction.editReply(noticePayload('The officials roster is empty. Add one with `/official-roster add`.', { title: 'Roster Empty', subtitle: SUB }));
            }
            const lines = officials.map((o) => `- <@${o.discord_id}> — ${o.sport || 'Any'}`);
            return interaction.editReply(noticePayload(lines, { title: `Officials Roster (${officials.length})`, subtitle: SUB }));
        } catch (error) {
            logger.error('[Officials] official-roster failed:', error);
            return interaction.editReply(noticePayload('An error occurred while managing the roster.', { title: 'Roster Error', subtitle: SUB }));
        }
    },
};
