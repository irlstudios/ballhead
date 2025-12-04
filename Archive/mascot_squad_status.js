const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return auth;
}

const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SL_OPEN_SQUAD = 4;
const SM_ID = 1;
const SM_SQUAD_NAME = 2;
const AD_ID = 1;
const AD_SQUAD_NAME = 2;
const AD_OPEN_SQUAD = 5;


module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-status')
        .setDescription('Set your squad\'s open/closed status (Squad Leaders only).')
        .addStringOption(option =>
            option.setName('status')
                .setDescription('Choose whether your squad is Open or Closed for new members.')
                .setRequired(true)
                .addChoices(
                    { name: 'Open', value: 'TRUE' },
                    { name: 'Closed', value: 'FALSE' }
                )),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const leaderUserId = interaction.user.id;
        const leaderUserTag = interaction.user.tag;
        const desiredStatus = interaction.options.getString('status');

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const [squadLeadersResponse, squadMembersResponse, allDataResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' }),
            ]).catch(err => {
                console.error("Error fetching sheet data for status update:", err);
                throw new Error("Failed to retrieve necessary data from Google Sheets.");
            });

            const squadLeadersData = squadLeadersResponse.data.values || [];
            const squadMembersData = squadMembersResponse.data.values || [];
            const allDataData = allDataResponse.data.values || [];

            const squadLeadersHeader = squadLeadersData.shift() || [];
            const squadMembersHeader = squadMembersData.shift() || [];
            const allDataHeader = allDataData.shift() || [];

            let leaderRowIndex = -1;
            const leaderRow = squadLeadersData.find((row, index) => {
                if (row && row.length > SL_ID && row[SL_ID] === leaderUserId) {
                    leaderRowIndex = index;
                    return true;
                }
                return false;
            });

            if (!leaderRow || leaderRowIndex === -1) {
                await interaction.editReply({ content: 'You must be a squad leader to use this command.', ephemeral: true });
                return;
            }

            const leaderSquadName = leaderRow[SL_SQUAD_NAME];
            if (!leaderSquadName || leaderSquadName === 'N/A') {
                await interaction.editReply({ content: 'Could not determine your squad name.', ephemeral: true });
                return;
            }

            const currentLeaderStatus = leaderRow[SL_OPEN_SQUAD];
            if (currentLeaderStatus === desiredStatus) {
                const statusText = desiredStatus === 'TRUE' ? 'Open' : 'Closed';
                await interaction.editReply({ content: `Your squad **${leaderSquadName}** is already set to **${statusText}**. No changes made.`, ephemeral: true });
                return;
            }

            const memberIds = squadMembersData
                .filter(row => row && row.length > SM_SQUAD_NAME && row[SM_SQUAD_NAME] === leaderSquadName && row[SM_ID])
                .map(row => row[SM_ID]);

            const allParticipantIds = [...new Set([leaderUserId, ...memberIds])];
            const participantIdSet = new Set(allParticipantIds);

            console.log(`Updating status to ${desiredStatus} for squad ${leaderSquadName} members: ${allParticipantIds.join(', ')}`);


            const updatedSquadLeaders = squadLeadersData.map((row, index) => {
                if (index === leaderRowIndex) {
                    const newRow = [...row];
                    while (newRow.length <= SL_OPEN_SQUAD) { newRow.push(''); }
                    newRow[SL_OPEN_SQUAD] = desiredStatus;
                    return newRow;
                }
                return row;
            });

            const updatedAllData = allDataData.map(row => {
                if (row && row.length > AD_ID && participantIdSet.has(row[AD_ID])) {
                    const newRow = [...row];
                    while (newRow.length <= AD_OPEN_SQUAD) { newRow.push(''); }
                    newRow[AD_OPEN_SQUAD] = desiredStatus;
                    return newRow;
                }
                const fullRow = Array(allDataHeader.length).fill('');
                for(let i = 0; i < Math.min(row?.length ?? 0, allDataHeader.length); i++) {
                    fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : '';
                }
                return fullRow;
            });

            const finalSquadLeaders = [squadLeadersHeader, ...updatedSquadLeaders];
            const finalAllData = [allDataHeader, ...updatedAllData];

            await Promise.all([
                sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `Squad Leaders!A1:F${finalSquadLeaders.length}`,
                    valueInputOption: 'RAW',
                    resource: { values: finalSquadLeaders }
                }),
                sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `All Data!A1:H${finalAllData.length}`,
                    valueInputOption: 'RAW',
                    resource: { values: finalAllData }
                })
            ]).catch(err => {
                console.error(`Error updating sheets for status change (Squad: ${leaderSquadName}):`, err);
                throw new Error("Failed to update squad status in Google Sheets.");
            });

            console.log(`Updated Open Squad status to ${desiredStatus} for squad ${leaderSquadName}`);

            const statusText = desiredStatus === 'TRUE' ? 'Open' : 'Closed';
            const successEmbed = new EmbedBuilder()
                .setColor(desiredStatus === 'TRUE' ? '#00FF00' : '#FF0000')
                .setTitle('Squad Status Updated')
                .setDescription(`The status for your squad **${leaderSquadName}** has been set to **${statusText}**.`)
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });

        } catch (error) {
            console.error(`Error processing /squad-status for ${leaderUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Squad Status Command Error')
                    .setDescription(`**User:** ${leaderUserTag} (${leaderUserId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log status command error:', logError);
            }
            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Please try again later.'}`,
                ephemeral: true
            }).catch(console.error);
        }
    }
};