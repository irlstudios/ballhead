const {SlashCommandBuilder} = require('@discordjs/builders');
const {CommandInteraction, PermissionsBitField, AttachmentBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder} = require('discord.js');
const {Buffer} = require('node:buffer');
const axios = require('axios');

const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-role-ids-by-role')
        .setDescription('Gets the list of user IDs of people who are in a specified role')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to get the user IDs from')
                .setRequired(true)
        ),

    /**
     * @param {CommandInteraction} interaction
     */
    async execute(interaction) {
        const role = interaction.options.getRole('role');

        if (!interaction.guild) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Server Only\nThis command can only be used in a guild.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        const botMember = await interaction.guild.members.fetch(interaction.client.user.id);

        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Missing Permissions\nI do not have permission to manage roles.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        await interaction.deferReply({ephemeral: true});

        try {
            await interaction.guild.members.fetch();

            const membersWithRole = interaction.guild.roles.cache.get(role.id).members;
            const userIDs = membersWithRole.map(member => member.user.id);

            if (userIDs.length === 0) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## No Members Found\nNo users found with the role ${role.name}.`));
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
            }

            const userIDContent = userIDs.join('\n');
            const buffer = Buffer.from(userIDContent, 'utf-8');
            const file = new AttachmentBuilder(buffer, {name: `user_ids_with_role_${role.name}.txt`});

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Role Members Exported\nUser IDs with role ${role.name} are attached.`));
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], files: [file] });
        } catch (error) {
            console.error(error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const logContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Role Export Failed\n**Error:** ${error.message}\n-# Admins notified`));

                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Export Failed\nThere was an error fetching the members with this role.'));
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        }
    }
};
