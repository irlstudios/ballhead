const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

const GUILD_ID = '752216589792706621';
const LOGGING_GUILD_ID = '1233740086839869501';
const LOGGING_CHANNEL_ID = '1233853415952748645';
const SPREADSHEET_ID = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
const mascotSquads = [
    { name: "Duck Squad", roleId: "1359614680615620608" },
    { name: "Pumpkin Squad", roleId: "1361466564292907060" },
    { name: "Snowman Squad", roleId: "1361466801443180584" },
    { name: "Gorilla Squad", roleId: "1361466637261471961" },
    { name: "Bee Squad", roleId: "1361466746149666956" },
    { name: "Alligator Squad", roleId: "1361466697059664043" },
];
const SL_ID = 1;
const SL_SQUAD_NAME = 2;
const SL_EVENT_SQUAD = 3;
const AD_ID = 1;


function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/spreadsheets']);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave-squad')
        .setDescription('Leave your current squad'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const member = interaction.member;
        const guild = interaction.guild;

        if (!member || !guild) {
            await interaction.editReply({ content: 'Could not retrieve necessary server information.', ephemeral: true });
            return;
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            const [squadMembersResponse, squadLeadersResponse, allDataResponse] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Members!A:E' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Squad Leaders!A:F' }),
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'All Data!A:H' })
            ]).catch(err => { throw new Error("Failed to retrieve data from Google Sheets.") });

            const squadMembersData = (squadMembersResponse.data.values || []).slice(1);
            const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);
            const allData = (allDataResponse.data.values || []).slice(1);

            const userIsLeader = squadLeadersData.find(row => row && row.length > SL_ID && row[SL_ID]?.trim() === userId);
            if (userIsLeader) {
                return interaction.editReply({ content: 'Sorry, squad leaders cannot leave their squad using this command. Please use `/disband-squad`.', ephemeral: true });
            }

            const userInSquadRowIndex = squadMembersData.findIndex(row => row && row.length > 1 && row[1]?.trim() === userId);
            if (userInSquadRowIndex === -1) {
                return interaction.editReply({ content: 'You are not currently in a squad.', ephemeral: true });
            }

            const userInSquadRow = squadMembersData[userInSquadRowIndex];
            const squadName = userInSquadRow[2]?.trim();

            if (!squadName || squadName === 'N/A') {
                console.warn(`User ${userTag} (${userId}) found in Squad Members sheet but without a valid squad name.`);
                return interaction.editReply({ content: 'Your squad data seems inconsistent. Please contact an administrator.', ephemeral: true });
            }

            console.log(`User ${userTag} (${userId}) is leaving squad: ${squadName}`);

            let mascotRoleIdToRemove = null;
            const squadOwnerRowForEvent = squadLeadersData.find(row => row && row.length > SL_SQUAD_NAME && row[SL_SQUAD_NAME]?.trim() === squadName);
            if (squadOwnerRowForEvent) {
                const eventSquadName = squadOwnerRowForEvent[SL_EVENT_SQUAD];
                if (eventSquadName && eventSquadName !== 'N/A') {
                    const mascotInfo = mascotSquads.find(m => m.name === eventSquadName);
                    if (mascotInfo) {
                        mascotRoleIdToRemove = mascotInfo.roleId;
                        console.log(`Identified mascot role ${mascotInfo.name} (${mascotRoleIdToRemove}) to remove from ${userTag}.`);
                    } else {
                        console.warn(`Could not find role mapping for Event Squad '${eventSquadName}' of squad ${squadName}.`);
                    }
                }
            } else {
                console.warn(`Could not find leader row for squad ${squadName} to check for Event Squad assignment.`);
            }


            const squadMemberSheetRowIndex = userInSquadRowIndex + 2;
            const clearRange = `Squad Members!A${squadMemberSheetRowIndex}:E${squadMemberSheetRowIndex}`;
            console.log(`Clearing Squad Members range ${clearRange}`);
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: clearRange,
            }).catch(err => { throw new Error(`Failed to clear row in Squad Members sheet: ${err.message}`); });


            const userInAllDataIndex = allData.findIndex(row => row && row.length > AD_ID && row[AD_ID]?.trim() === userId);
            if (userInAllDataIndex !== -1) {
                const allDataSheetRowIndex = userInAllDataIndex + 2;
                const rangeToUpdate = `All Data!C${allDataSheetRowIndex}:G${allDataSheetRowIndex}`;
                const valuesToUpdate = [['N/A', 'N/A', 'N/A', 'FALSE', 'No']];
                console.log(`Updating All Data range ${rangeToUpdate} for user ${userId}`);
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: rangeToUpdate,
                    valueInputOption: 'RAW',
                    resource: { values: valuesToUpdate },
                }).catch(err => { throw new Error(`Failed to update row in All Data sheet: ${err.message}`); });
            } else {
                console.warn(`User ${userTag} (${userId}) was found in Squad Members but not in All Data sheet.`);
            }

            const squadOwnerRow = squadLeadersData.find(row => row && row.length > SL_SQUAD_NAME && row[SL_SQUAD_NAME]?.trim() === squadName);
            if (squadOwnerRow && squadOwnerRow[SL_ID]) {
                const ownerId = squadOwnerRow[SL_ID].trim();
                const ownerUsername = squadOwnerRow[0] || `Leader`;
                try {
                    const ownerUser = await interaction.client.users.fetch(ownerId);
                    const dmEmbed = new EmbedBuilder() /* ... DM embed ... */
                        .setTitle('Member Left Squad')
                        .setDescription(`Hello ${ownerUsername},\nUser **${userTag}** (<@${userId}>) has left your squad **${squadName}**.`)
                        .setColor('#FFA500');
                    await ownerUser.send({ embeds: [dmEmbed] }).catch(dmError => { /* ... handle DM error ... */
                        console.error(`Failed to DM squad leader ${ownerId}: ${dmError.message}`);
                    });
                } catch (error) { /* ... handle user fetch error ... */
                    console.error(`Failed to fetch squad leader user ${ownerId} for DM: ${error.message}`);
                }
            } else {
                console.warn(`Could not find leader for squad ${squadName} to notify.`);
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logEmbed = new EmbedBuilder() /* ... Log embed ... */
                    .setTitle('Member Left Squad')
                    .setDescription(`User **${userTag}** (<@${userId}>) has left the squad **${squadName}**.`)
                    .setColor('#FFA500')
                    .setTimestamp();
                await loggingChannel.send({ embeds: [logEmbed] });
            } catch (logError) { /* ... handle log error ... */
                console.error(`Failed to send log message: ${logError.message}`);
            }


            try {
                if (member.nickname && member.nickname.toUpperCase().startsWith(`[${squadName.toUpperCase()}]`)) {
                    console.log(`Resetting nickname for ${userTag}`);
                    await member.setNickname(null).catch(nickErr => {
                        if (nickErr.code !== 50013) { console.error(`Could not change nickname for ${userTag} (${userId}):`, nickErr.message); }
                        else { console.log(`Missing permissions to reset nickname for ${userTag} (${userId}).`);}
                    });
                } else {
                    console.log(`Nickname for ${userTag} doesn't match squad format, not resetting.`);
                }

                if (mascotRoleIdToRemove) {
                    const roleToRemove = await guild.roles.fetch(mascotRoleIdToRemove).catch(() => null);
                    if (roleToRemove && member.roles.cache.has(roleToRemove.id)) {
                        console.log(`Removing mascot role ${roleToRemove.name} from ${userTag}`);
                        await member.roles.remove(roleToRemove).catch(roleErr => {
                            if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                                console.error(`Could not remove mascot role ${roleToRemove.name} from ${userTag}:`, roleErr.message);
                            } else {
                                console.log(`Missing permissions or role already gone for mascot role ${roleToRemove.name} on ${userTag}.`);
                            }
                        });
                    } else if (roleToRemove) {
                        console.log(`User ${userTag} did not have mascot role ${roleToRemove.name} to remove.`);
                    } else {
                        console.warn(`Mascot role ${mascotRoleIdToRemove} not found in guild for removal.`);
                    }
                }
            } catch (error) {
                if (error.code === 10007) { console.log(`Member ${userTag} (${userId}) not found in guild ${GUILD_ID}, cannot reset nickname/roles.`); }
                else { console.error(`Error during nickname/role cleanup for ${userTag} (${userId}):`, error.message); }
            }

            await interaction.editReply({
                content: `You have successfully left the squad **${squadName}**. Any associated event roles have also been removed.`,
                ephemeral: true,
            });

        } catch (error) {
            console.error(`Error during /leave-squad for ${userTag} (${userId}):`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(LOGGING_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder() /* ... Error log embed ... */
                    .setTitle('Leave Squad Command Error')
                    .setDescription(`**User:** ${userTag} (${userId})\n**Error:** ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error(`Failed to log error to error channel: ${logError.message}`);
            }
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred while processing your request...', ephemeral: true }).catch(console.error);
            } else if (!interaction.replied) {
                await interaction.editReply({ content: 'An error occurred while processing your request...', ephemeral: true }).catch(console.error);
            }
        }
    },
};