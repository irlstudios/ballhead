const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const REQUIRED_ROLE_ID = '924522770057031740';
const LOGGING_GUILD_ID = '1233740086839869501';
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';
const SQUAD_LEADER_ROLE_ID = '1218468103382499400';
const COMPETITIVE_ROLE_ID = '1288918946258489354';
const CONTENT_ROLE_ID = '1290803054140199003';

const formatDate = () => {
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear().toString().slice(-2);
    return `${month}/${day}/${year}`;
};

module.exports = {
    cooldown: 604800,
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register a new Squad.')
        .addStringOption(option =>
            option.setName('squadname')
                .setDescription('The desired name/tag for your Squad (1-4 alphanumeric chars).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('squadtype')
                .setDescription('Select the intended type for your Squad.')
                .setRequired(true)
                .addChoices(
                    { name: 'Casual', value: 'Casual' },
                    { name: 'Competitive', value: 'Competitive' },
                    { name: 'Content', value: 'Content' }
                )),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const hasRequiredRole = interaction.member.roles.cache.has(REQUIRED_ROLE_ID);
        if (!hasRequiredRole) {
            return interaction.editReply({ content: `You must have the <@&${REQUIRED_ROLE_ID}> role to register a squad!`, ephemeral: true });
        }

        const squadName = interaction.options.getString('squadname').toUpperCase();
        const squadType = interaction.options.getString('squadtype');
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userTag = interaction.user.tag;

        if (!/^[A-Z0-9]{1,4}$/.test(squadName)) {
            return interaction.editReply({ content: 'Squad names must be 1 to 4 letters (A-Z) or numbers (0-9).', ephemeral: true });
        }

        const sheets = await getSheetsClient();

        try {
            const [allDataResponse, squadLeadersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' })
            ]).catch(err => {
                console.error('Error fetching sheet data:', err); throw new Error('Failed to retrieve necessary data from Google Sheets.');
            });

            const allData = (allDataResponse.data.values || []).slice(1);
            const squadLeaders = (squadLeadersResponse.data.values || []).slice(1);

            const userInAllData = allData.find(row => row && row.length > 1 && row[1] === userId);
            const userInSquadLeaders = squadLeaders.find(row => row && row.length > 1 && row[1] === userId);
            const squadNameTaken = squadLeaders.find(row => row && row.length > 2 && row[2]?.toUpperCase() === squadName);
            const isMarkedLeaderInAllData = userInAllData && userInAllData.length > 6 && userInAllData[6] === 'Yes';
            if (userInSquadLeaders || isMarkedLeaderInAllData) {
                return interaction.editReply({ content: 'You appear to already own a squad.', ephemeral: true });
            }
            if (userInAllData && userInAllData.length > 2 && userInAllData[2] !== 'N/A' && userInAllData[2]?.toUpperCase() !== squadName) {
                return interaction.editReply({ content: `You are already listed as a member of squad **${userInAllData[2]}**.`, ephemeral: true });
            }
            if (squadNameTaken) {
                return interaction.editReply({ content: `The squad tag **${squadName}** is already taken.`, ephemeral: true });
            }
            const squadLeaderRole = interaction.guild.roles.cache.get(SQUAD_LEADER_ROLE_ID);
            const competitiveRole = interaction.guild.roles.cache.get(COMPETITIVE_ROLE_ID);
            const contentRole = interaction.guild.roles.cache.get(CONTENT_ROLE_ID);
            if (!squadLeaderRole || !competitiveRole || !contentRole) {
                return interaction.editReply({ content: 'Configuration error: required squad leader roles are missing.', ephemeral: true });
            }

            const dateString = formatDate();
            const newLeaderRow = [
                username,
                userId,
                squadName,
                'N/A',
                'FALSE',
                dateString
            ];

            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Squad Leaders!A1',
                valueInputOption: 'RAW',
                resource: { values: [newLeaderRow] }
            }).catch(err => { throw new Error(`Failed to append to Squad Leaders sheet: ${err.message}`); });

            const userInAllDataIndex = allData.findIndex(row => row && row.length > 1 && row[1] === userId);

            if (userInAllDataIndex !== -1) {
                const sheetRowIndex = userInAllDataIndex + 2;
                const valuesToUpdate = [
                    squadName,
                    squadType || 'N/A',
                    'N/A',
                    'FALSE',
                    'Yes'
                ];
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `All Data!C${sheetRowIndex}:G${sheetRowIndex}`,
                    valueInputOption: 'RAW',
                    resource: { values: [valuesToUpdate] }
                }).catch(err => { throw new Error(`Failed to update All Data sheet: ${err.message}`); });
            } else {
                const newAllDataRow = [
                    username,
                    userId,
                    squadName,
                    squadType || 'N/A',
                    'N/A',
                    'FALSE',
                    'Yes',
                    'TRUE'
                ];
                await sheets.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: 'All Data!A1',
                    valueInputOption: 'RAW',
                    resource: { values: [newAllDataRow] }
                }).catch(err => { throw new Error(`Failed to append to All Data sheet: ${err.message}`); });
            }

            try {
                await interaction.member.roles.add(squadLeaderRole);
                if (squadType === 'Competitive') await interaction.member.roles.add(competitiveRole);
                if (squadType === 'Content') await interaction.member.roles.add(contentRole);
            } catch (roleError) {
                console.warn(`Failed to add roles to ${username} (${userId}): ${roleError.message}`);
                await interaction.followUp({ content: 'Warning: squad created, but some roles could not be assigned. Please check permissions and assign manually.', ephemeral: true });
            }

            try {
                await interaction.member.setNickname(`[${squadName}] ${interaction.member.user.username}`);
            } catch (nickError) {
                console.warn(`Failed to set nickname for ${username}: ${nickError.message}`);
                await interaction.followUp({ content: 'Warning: squad created, but nickname could not be updated due to permissions.', ephemeral: true });
            }

            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder().setTitle('Squad Registered').setDescription(`Your squad **${squadName}** (${squadType}) has been registered!`).setColor(0x00FF00)]
                });
            } catch (dmError) {
                console.warn(`Failed to send registration DM to ${username}: ${dmError.message}`);
            }

            await interaction.editReply({
                content: `✅ Squad **${squadName}** (${squadType}) has been registered and configured.`,
                ephemeral: true
            });

        } catch (error) {
            console.error(`Error processing /register command for ${userTag} (${userId}):`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Squad Registration Command Error')
                    .setDescription(`**User:** ${userTag} (${userId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log registration error to Discord:', logError);
            }
            await interaction.editReply({
                content: `An error occurred while registering your squad: ${error.message || 'Please try again later or contact an admin.'}`,
                ephemeral: true
            }).catch(console.error);
        }
    }
};
