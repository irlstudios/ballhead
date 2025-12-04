const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../../resources/secret.json');

const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';
const compSquadLevelRoles = [
    '1288918067178508423', '1288918165417365576', '1288918209294237707', '1288918281343733842', '1200889836844896316'
];
const contentSquadLevelRoles = [
    '1291090496869109762', '1291090569346682931', '1291090608315699229', '1291090760405356708'
];
const mascotSquads = [
    { name: 'Duck Squad', roleId: '1359614680615620608' },
    { name: 'Pumpkin Squad', roleId: '1361466564292907060' },
    { name: 'Snowman Squad', roleId: '1361466801443180584' },
    { name: 'Gorilla Squad', roleId: '1361466637261471961' },
    { name: 'Bee Squad', roleId: '1361466746149666956' },
    { name: 'Alligator Squad', roleId: '1361466697059664043' },
];

const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SL_EVENT_SQUAD = 3;
const SM_ID = 1;
const SM_SQUAD_NAME = 2;
const AD_ID = 1;
const AD_SQUAD_TYPE = 3;

async function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    await auth.authorize();
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-from-squad')
        .setDescription('Remove a member from your squad (Squad Leaders only).')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member you want to remove from your squad.')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const commandUserID = interaction.user.id;
        const commandUserTag = interaction.user.tag;
        const targetUser = interaction.options.getUser('member');
        const guild = interaction.guild;

        if (!targetUser) {
            await interaction.editReply({ content: 'Could not find the specified user.', ephemeral: true });
            return;
        }
        const targetUserID = targetUser.id;
        const targetUserTag = targetUser.tag;

        if (commandUserID === targetUserID) {
            await interaction.editReply({ content: 'You can\'t remove yourself from your own squad. Use `/leave-squad` or `/disband-squad`.', ephemeral: true });
            return;
        }
        if (targetUser.bot) {
            await interaction.editReply({ content: 'You cannot remove bots from squads.', ephemeral: true });
            return;
        }

        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const [allDataResponse, squadLeadersResponse, squadMembersResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
            ]).catch(() => { throw new Error('Failed to retrieve data from Google Sheets.'); });

            const allData = (allDataResponse.data.values || []);
            const squadLeadersData = (squadLeadersResponse.data.values || []);
            const squadMembersData = (squadMembersResponse.data.values || []);

            allData.shift();
            squadLeadersData.shift();
            squadMembersData.shift();

            const leaderRow = squadLeadersData.find(row => row && row.length > SL_ID && row[SL_ID] === commandUserID);
            if (!leaderRow) {
                await interaction.editReply({ content: 'You must be a squad leader to use this command.', ephemeral: true });
                return;
            }
            const leaderSquadName = leaderRow[SL_SQUAD_NAME];
            if (!leaderSquadName || leaderSquadName === 'N/A') {
                await interaction.editReply({ content: 'Could not determine your squad name.', ephemeral: true });
                return;
            }

            let targetMemberRowIndex = -1;
            const targetMemberRow = squadMembersData.find((row, index) => {
                if (row && row.length > SM_SQUAD_NAME && row[SM_ID] === targetUserID && row[SM_SQUAD_NAME] === leaderSquadName) {
                    targetMemberRowIndex = index;
                    return true;
                }
                return false;
            });

            if (!targetMemberRow || targetMemberRowIndex === -1) {
                await interaction.editReply({ content: `<@${targetUserID}> is not currently a member of your squad **${leaderSquadName}**.`, ephemeral: true });
                return;
            }

            const leaderAllDataRow = allData.find(row => row && row.length > AD_ID && row[AD_ID] === commandUserID);
            const squadTypeForRoles = leaderAllDataRow ? leaderAllDataRow[AD_SQUAD_TYPE] : null;
            const squadTypeRolesToRemove = squadTypeForRoles === 'Competitive' ? compSquadLevelRoles :
                squadTypeForRoles === 'Content' ? contentSquadLevelRoles : [];

            const eventSquadName = leaderRow[SL_EVENT_SQUAD];
            let mascotRoleIdToRemove = null;
            if (eventSquadName && eventSquadName !== 'N/A') {
                const mascotInfo = mascotSquads.find(m => m.name === eventSquadName);
                if (mascotInfo) {
                    mascotRoleIdToRemove = mascotInfo.roleId;
                    console.log(`Squad ${leaderSquadName} has mascot role: ${eventSquadName} (${mascotRoleIdToRemove})`);
                } else {
                    console.warn(`Squad ${leaderSquadName} has event squad '${eventSquadName}' but no matching role ID found.`);
                }
            }


            const sheetRowIndexSM = targetMemberRowIndex + 2;
            const clearRangeSM = `Squad Members!A${sheetRowIndexSM}:E${sheetRowIndexSM}`;
            console.log(`Clearing Squad Members range ${clearRangeSM} for user ${targetUserID}`);
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: clearRangeSM,
            }).catch(err => { throw new Error(`Failed to clear row in Squad Members sheet: ${err.message}`); });

            let targetAllDataRowIndex = -1;
            allData.find((row, index) => {
                if (row && row.length > AD_ID && row[AD_ID] === targetUserID) {
                    targetAllDataRowIndex = index;
                    return true;
                }
                return false;
            });

            if (targetAllDataRowIndex !== -1) {
                const sheetRowIndexAD = targetAllDataRowIndex + 2;
                const rangeToUpdateAD = `All Data!C${sheetRowIndexAD}:G${sheetRowIndexAD}`;
                const valuesToUpdateAD = [['N/A', 'N/A', 'N/A', 'FALSE', 'No']];
                console.log(`Updating All Data range ${rangeToUpdateAD} for user ${targetUserID}`);
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: rangeToUpdateAD,
                    valueInputOption: 'RAW',
                    resource: { values: valuesToUpdateAD },
                }).catch(err => { throw new Error(`Failed to update row in All Data sheet: ${err.message}`); });
            } else {
                console.warn(`User ${targetUserTag} (${targetUserID}) was in Squad Members but not found in All Data.`);
            }
            console.log(`Updated sheets for removing ${targetUserTag} from ${leaderSquadName}`);

            try {
                const memberToRemove = await guild.members.fetch(targetUserID);
                if (memberToRemove.nickname && memberToRemove.nickname.toUpperCase().startsWith(`[${leaderSquadName.toUpperCase()}]`)) {
                    console.log(`Resetting nickname for ${targetUserTag}`);
                    await memberToRemove.setNickname(null).catch(nickErr => {
                        if (nickErr.code !== 50013) { console.error(`Could not reset nickname for ${targetUserTag}:`, nickErr.message); }
                        else { console.log(`Missing permissions to reset nickname for ${targetUserTag}.`); }
                    });
                }

                const rolesToRemove = [...squadTypeRolesToRemove];
                if (mascotRoleIdToRemove) {
                    rolesToRemove.push(mascotRoleIdToRemove);
                }

                if (rolesToRemove.length > 0) {
                    const rolesMemberHas = rolesToRemove.filter(roleId => memberToRemove.roles.cache.has(roleId));
                    if (rolesMemberHas.length > 0) {
                        console.log(`Attempting to remove roles [${rolesMemberHas.join(', ')}] from ${targetUserTag}`);
                        await memberToRemove.roles.remove(rolesMemberHas).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                console.error(`Failed to remove roles from ${targetUserTag}:`, roleErr.message);
                            } else {
                                console.log(`Missing permissions or roles already gone for ${targetUserTag}.`);
                            }
                        });
                    } else {
                        console.log(`${targetUserTag} did not have any relevant roles to remove.`);
                    }
                }

            } catch (discordError) {
                if (discordError.code === 10007) {
                    console.log(`Member ${targetUserTag} (${targetUserID}) left the server before nickname/roles could be updated.`);
                } else {
                    console.error(`Error updating Discord member ${targetUserTag}:`, discordError.message);
                }
                await interaction.followUp({ content: `Warning: Could not reset nickname or remove roles for ${targetUserTag}. They may have left the server.`, ephemeral: true }).catch(followUpError => {
                    console.error('Failed to send follow-up warning after remove-from-squad:', followUpError);
                });
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logMessage = `❌ Member Removed: **${commandUserTag}** (<@${commandUserID}>) removed **${targetUserTag}** (<@${targetUserID}>) from squad **${leaderSquadName}**.`;
                await loggingChannel.send(logMessage);
            } catch (logError) {
                console.error('Failed to send removal log message:', logError);
            }

            await interaction.editReply({
                content: `<@${targetUserID}> has been successfully removed from **${leaderSquadName}**. Their roles and nickname have been reset.`,
                ephemeral: true
            });

        } catch (error) {
            console.error(`Error during /remove-from-squad for ${commandUserTag} removing ${targetUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Remove From Squad Command Error')
                    .setDescription(`**User:** ${commandUserTag} (${commandUserID})\n**Target:** ${targetUserTag} (${targetUserID})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to log removal command error:', logError);
            }
            await interaction.editReply({
                content: `An error occurred: ${error.message || 'Please try again later.'}`,
                ephemeral: true
            }).catch(console.error);
        }
    }
};
