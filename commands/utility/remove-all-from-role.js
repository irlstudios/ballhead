'use strict';

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const { MODERATOR_ROLES } = require('../../config/constants');
const { noticePayload } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-all-from-role')
        .setDescription('Removes a specified role from every member who currently has it.')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to remove from all members')
                .setRequired(true)),

    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isMod = MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));

        if (!isMod) {
            return interaction.reply({
                ...noticePayload('You do not have permission to use this command.', { title: 'Access Denied' }),
                ephemeral: true,
            });
        }

        const botMember = await interaction.guild.members.fetch(interaction.client.user.id);

        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return interaction.reply({
                ...noticePayload('I do not have permission to manage roles.', { title: 'Missing Permissions' }),
                ephemeral: true,
            });
        }

        const role = interaction.options.getRole('role');

        if (role.managed) {
            return interaction.reply({
                ...noticePayload('That role is managed by an integration and cannot be removed manually.', { title: 'Invalid Role' }),
                ephemeral: true,
            });
        }

        if (botMember.roles.highest.position <= role.position) {
            return interaction.reply({
                ...noticePayload('My highest role is not above the target role. I cannot remove it.', { title: 'Role Hierarchy Error' }),
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await interaction.guild.members.fetch();

            const membersWithRole = interaction.guild.roles.cache.get(role.id)?.members;

            if (!membersWithRole || membersWithRole.size === 0) {
                return interaction.editReply(
                    noticePayload(`No members currently have the role **${role.name}**.`, { title: 'No Members Found' })
                );
            }

            const total = membersWithRole.size;
            let succeeded = 0;
            let failed = 0;
            const failedUsers = [];

            for (const [, guildMember] of membersWithRole) {
                try {
                    await guildMember.roles.remove(role);
                    succeeded += 1;
                } catch (error) {
                    failed += 1;
                    failedUsers.push(guildMember.user.tag ?? guildMember.id);
                    logger.error(`Failed to remove role ${role.name} from ${guildMember.user.tag} (${guildMember.id}): ${error.message}`);
                }
            }

            const lines = [
                `**Role:** ${role.name}`,
                `**Members found:** ${total}`,
                `**Removed:** ${succeeded}`,
                `**Failed:** ${failed}`,
            ];

            if (failedUsers.length > 0) {
                const displayLimit = 10;
                const shown = failedUsers.slice(0, displayLimit);
                lines.push('', '**Failed users:**');
                lines.push(...shown.map(u => `- ${u}`));
                if (failedUsers.length > displayLimit) {
                    lines.push(`- ...and ${failedUsers.length - displayLimit} more (see logs)`);
                }
            }

            return interaction.editReply(
                noticePayload(lines, { title: 'Role Removal Complete' })
            );
        } catch (error) {
            logger.error(`remove-all-from-role failed for ${role.name}: ${error.message}`);
            return interaction.editReply(
                noticePayload('An error occurred while removing the role. Check logs for details.', { title: 'Error' })
            );
        }
    },
};
