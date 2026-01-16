const {SlashCommandBuilder} = require('@discordjs/builders');
const {CommandInteraction, PermissionsBitField, AttachmentBuilder, EmbedBuilder} = require('discord.js');
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
            return interaction.reply({content: 'This command can only be used in a guild.', ephemeral: true});
        }

        const botMember = await interaction.guild.members.fetch(interaction.client.user.id);

        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return interaction.reply({content: 'I do not have permission to manage roles.', ephemeral: true});
        }

        await interaction.deferReply({ephemeral: true});

        try {
            await interaction.guild.members.fetch();

            const membersWithRole = interaction.guild.roles.cache.get(role.id).members;
            const userIDs = membersWithRole.map(member => member.user.id);

            if (userIDs.length === 0) {
                return interaction.editReply({content: `No users found with the role ${role.name}.`});
            }

            const userIDContent = userIDs.join('\n');
            const buffer = Buffer.from(userIDContent, 'utf-8');
            const file = new AttachmentBuilder(buffer, {name: `user_ids_with_role_${role.name}.txt`});

            await interaction.editReply({content: `User IDs with role ${role.name}:`, files: [file]});
        } catch (error) {
            console.error(error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while executing the list-role-ids-by-role command: ${error.message}`)
                    .setColor('#FF0000');

                await errorChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            return interaction.editReply({content: 'There was an error fetching the members with this role.'});
        }
    }
};