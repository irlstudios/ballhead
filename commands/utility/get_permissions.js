const {SlashCommandBuilder, ChannelType, PermissionsBitField, MessageFlags, ContainerBuilder, TextDisplayBuilder} = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = '1ZLbmCl3prerT5Qp57Gc3BESfGe0EGUryVk4DpjxrVtI';
const SHEET_NAME = 'Gym Class';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';
const REQUIRED_ROLES = ['752218192197320735', '805833778064130104'];

async function getChannelPermissions(channel) {
    const roles = [];
    const users = [];

    const everyoneRole = channel.guild.roles.everyone;
    const everyonePermissions = channel.permissionsFor(everyoneRole);
    if (everyonePermissions.has(PermissionsBitField.Flags.ViewChannel)) {
        roles.push('@everyone');
    }

    if (!channel.permissionOverwrites) {
        return {roles, users};
    }

    const permissions = channel.permissionOverwrites.cache;
    permissions.forEach(permission => {
        const entityType = permission.type === 0 ? 'role' : 'member';
        if (permission.allow.has(PermissionsBitField.Flags.ViewChannel) && !permission.deny.has(PermissionsBitField.Flags.ViewChannel)) {
            if (entityType === 'role') {
                const role = channel.guild.roles.cache.get(permission.id);
                if (role) {
                    roles.push(role.name);
                }
            } else if (entityType === 'member') {
                const member = channel.guild.members.cache.get(permission.id);
                if (member) {
                    users.push(member.user.tag);
                }
            }
        }
    });

    return {roles, users};
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('get-permissions')
        .setDescription('Get the permissions for all channels and upload to Google Sheets'),
    async execute(interaction) {
        const hasRequiredRole = interaction.member.roles.cache.some(role => REQUIRED_ROLES.includes(role.id));
        if (!hasRequiredRole) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Access Denied\nYou do not have the required role to use this command.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        await interaction.deferReply({ephemeral: true});

        const guild = interaction.guild;

        await guild.members.fetch();
        await guild.roles.fetch();

        const channels = guild.channels.cache.filter(channel =>
            [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildNews, ChannelType.GuildStore].includes(channel.type)
        );

        const sheets = await getSheetsClient();

        const data = [];
        const csvData = [['Name', 'Roles', 'Members', 'ID', 'Link']];

        data.push(['Guild Information']);
        data.push(['Guild Name:', guild.name]);
        data.push(['Guild ID:', guild.id]);
        data.push(['Guild Owner:', guild.ownerId]);
        data.push(['Total Members:', guild.memberCount]);
        data.push([]);
        csvData.push(['Guild Information']);
        csvData.push(['Guild Name:', guild.name]);
        csvData.push(['Guild ID:', guild.id]);
        csvData.push(['Guild Owner:', guild.ownerId]);
        csvData.push(['Total Members:', guild.memberCount]);
        csvData.push([]);

        data.push(['Channels Information']);
        csvData.push(['Channels Information']);
        for (const channel of channels.values()) {
            if (channel.type !== ChannelType.GuildCategory) {
                const {roles, users} = await getChannelPermissions(channel);
                data.push([`#${channel.name}`, 'Roles:', roles.join(', ') || 'N/A', 'Members:', users.join(', ') || 'N/A', `${channel.id}`, `https://discord.com/channels/${guild.id}/${channel.id}`]);
                csvData.push([`#${channel.name}`, roles.join(', ') || 'N/A', users.join(', ') || 'N/A', `${channel.id}`, `https://discord.com/channels/${guild.id}/${channel.id}`]);
            }
        }
        data.push([]);
        csvData.push([]);

        // Add categories information
        data.push(['Categories Information']);
        csvData.push(['Categories Information']);
        for (const channel of channels.values()) {
            if (channel.type === ChannelType.GuildCategory) {
                const {roles, users} = await getChannelPermissions(channel);
                data.push([`#${channel.name}`, 'Roles:', roles.join(', ') || 'N/A', 'Members:', users.join(', ') || 'N/A', `${channel.id}`, `https://discord.com/channels/${guild.id}/${channel.id}`]);
                csvData.push([`#${channel.name}`, roles.join(', ') || 'N/A', users.join(', ') || 'N/A', `${channel.id}`, `https://discord.com/channels/${guild.id}/${channel.id}`]);
            }
        }
        data.push([]);
        csvData.push([]);


        try {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: data
                }
            });

            const csvContent = csvData.map(row => row.map(item => `"${item}"`).join(',')).join('\n');
            const fileName = `permissions_${guild.id}.csv`;
            const filePath = path.join(__dirname, fileName);

            fs.writeFileSync(filePath, csvContent);
            await interaction.followUp({files: [filePath], ephemeral: true});

            fs.unlinkSync(filePath);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Export Complete\nPermissions have been uploaded to the Google Sheet and CSV generated.'));
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        } catch (error) {
            console.error('Error during command execution:', error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const logContainer = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Permissions Export Failed\n**Error:** ${error.message}\n-# Admins notified`));

                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Export Failed\nThere was an error uploading to the Google Sheet or generating the CSV.\nThe admins have been notified.'));
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }
    }
};
