const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');

const roleHierarchy = {
    '1286098187223957617': 3,
    '1286098139513880648': 2,
    '1286098091396698134': 1
};

const roleIds = ['1286098187223957617', '1286098139513880648', '1286098091396698134'];

const auth = new google.auth.GoogleAuth({
    keyFile: 'resources/secret.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});


function sortOfficialsByRole(officials) {
    return officials.sort((a, b) => roleHierarchy[b.highestRoleId] - roleHierarchy[a.highestRoleId]);
}

async function updateGoogleSheet(sheets, officials, spreadsheetId) {
    try {
        const sortedOfficials = sortOfficialsByRole(officials);

        await sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: 'Officials - ALL!A:C',
        });

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
                await interaction.reply({ content: 'Bot is not in the server.', ephemeral: true });
                return;
            }

            const client = await auth.getClient();
            const sheets = google.sheets({ version: 'v4', auth: client });
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
                await interaction.reply({ content: 'No officials found.', ephemeral: true });
                return;
            }

            await updateGoogleSheet(sheets, officials, spreadsheetId);

            await interaction.reply({ content: 'Officials list has been updated in Google Sheets.', ephemeral: true });
        } catch (error) {
            console.log('Error executing the list_officials command', { error });
            await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
    }
};