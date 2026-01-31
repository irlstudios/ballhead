const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) {
        parts.push(`## ${title}`);
    }
    if (subtitle) {
        parts.push(subtitle);
    }
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) {
            parts.push('');
        }
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) {
        return null;
    }
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}

const roleHierarchy = {
    '1286098187223957617': 3,
    '1286098139513880648': 2,
    '1286098091396698134': 1
};

const roleIds = ['1286098187223957617', '1286098139513880648', '1286098091396698134'];

function sortOfficialsByRole(officials) {
    return officials.sort((a, b) => roleHierarchy[b.highestRoleId] - roleHierarchy[a.highestRoleId]);
}

async function updateGoogleSheet(sheets, officials, spreadsheetId) {
    try {
        const sortedOfficials = sortOfficialsByRole(officials);

        await sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: 'Officials - ALL!A:C' });

        const rows = [
            ['Discord Username', 'Discord ID', 'Officials Role'],
            ...sortedOfficials.map(official => [official.name, official.id, official.highestRole])
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: 'Officials - ALL!A:C',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rows }
        });

        console.log('Google Sheet updated with sorted officials data');
    } catch (error) {
        console.log('Failed to update Google Sheets', { error });
        throw new Error('Google Sheets update failed');
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list_officials')
        .setDescription('List and log officials with specific roles into Google Sheets'),

    async execute(interaction) {
        try {
            const guild = interaction.guild;
            if (!guild) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Guild Missing', subtitle: 'Officials Sync', lines: ['Bot is not in the server.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
                return;
            }

            const sheets = await getSheetsClient();
            const spreadsheetId = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';

            await guild.members.fetch();

            const officials = guild.members.cache
                .filter(member => member.roles.cache.some(role => roleIds.includes(role.id)))
                .map(member => {
                    const highestRole = member.roles.cache
                        .filter(role => roleIds.includes(role.id))
                        .reduce((a, b) => (roleHierarchy[a.id] > roleHierarchy[b.id] ? a : b));

                    return {
                        name: member.user.username,
                        id: member.id,
                        highestRole: highestRole.name,
                        highestRoleId: highestRole.id
                    };
                });

            if (officials.length === 0) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'No Officials Found', subtitle: 'Officials Sync', lines: ['No officials found.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
                return;
            }

            await updateGoogleSheet(sheets, officials, spreadsheetId);

            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Officials Updated', subtitle: 'Google Sheets Sync', lines: ['Officials list has been updated in Google Sheets.'] });
            if (block) successContainer.addTextDisplayComponents(block);
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
        } catch (error) {
            console.log('Error executing the list_officials command', { error });
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Officials Sync', lines: ['An error occurred while processing your request.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
