const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../../resources/secret.json');
const MODERATOR_ROLES = ['805833778064130104', '909227142808756264'];

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
        .setName('force-squad-name')
        .setDescription('Forcefully change the name of a squad (Mods only).')
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('The current name of the squad to change.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('new-name')
                .setDescription('The new name for the squad. (1-4 alphanumeric characters)')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const moderatorUserId = interaction.user.id;
        const moderatorUserTag = interaction.user.tag;
        const currentSquadName = interaction.options.getString('squad').toUpperCase();
        const newSquadName = interaction.options.getString('new-name').toUpperCase();
        const guild = interaction.guild;

        const member = await guild.members.fetch(moderatorUserId);
        const isMod = MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));
        if (!isMod) {
            return interaction.editReply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const squadNamePattern = /^[A-Z0-9]{1,4}$/;
        if (!squadNamePattern.test(newSquadName)) {
            return interaction.editReply({
                content: 'Invalid new squad name. The name must be between 1 and 4 alphanumeric characters.',
                ephemeral: true
            });
        }

        if (currentSquadName === newSquadName) {
            return interaction.editReply({
                content: 'The new squad name cannot be the same as the current squad name.',
                ephemeral: true
            });
        }


        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F'
            });
            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E'
            });
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H'
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            const squadLeaderRowIndex = squadLeaders.findIndex(row => row && row.length > 2 && row[2].toUpperCase() === currentSquadName);
            if (squadLeaderRowIndex === -1) {
                return interaction.editReply({
                    content: `The squad **${currentSquadName}** does not exist in the Squad Leaders sheet.`,
                    ephemeral: true
                });
            }
            const squadLeaderRow = squadLeaders[squadLeaderRowIndex];
            const leaderId = squadLeaderRow[1];

            const isSquadNameTaken = squadLeaders.some((row, index) => row && row.length > 2 && row[2].toUpperCase() === newSquadName && index !== squadLeaderRowIndex);
            if (isSquadNameTaken) {
                return interaction.editReply({
                    content: `The squad name **${newSquadName}** is already in use. Please choose a different name.`,
                    ephemeral: true
                });
            }

            const updatedSquadLeaders = squadLeaders.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2].toUpperCase() === currentSquadName) {
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5]];
                }
                return row;
            });

            const updatedSquadMembers = squadMembers.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2].toUpperCase() === currentSquadName) {
                    return [row[0], row[1], newSquadName, row[3], row[4]];
                }
                return row;
            });

            const updatedAllData = allData.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2].toUpperCase() === currentSquadName) {
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5], row[6], row[7]];
                }
                const fullRow = Array(8).fill('');
                for(let i = 0; i < Math.min(row.length, 8); i++) {
                    fullRow[i] = row[i] !== undefined && row[i] !== null ? row[i] : '';
                }
                return fullRow;
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A1:F' + updatedSquadLeaders.length,
                valueInputOption: 'RAW',
                resource: { values: updatedSquadLeaders }
            }).catch(err => { throw new Error(`Failed to update Squad Leaders sheet: ${err.message}`); });


            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A1:E' + updatedSquadMembers.length,
                valueInputOption: 'RAW',
                resource: { values: updatedSquadMembers }
            }).catch(err => { throw new Error(`Failed to update Squad Members sheet: ${err.message}`); });


            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A1:H' + updatedAllData.length,
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            }).catch(err => { throw new Error(`Failed to update All Data sheet: ${err.message}`); });


            const squadMembersToUpdate = squadMembers.filter(row => row && row.length > 2 && row[2].toUpperCase() === currentSquadName);

            for (const memberRow of squadMembersToUpdate) {
                const memberId = memberRow[1];
                if (!memberId) continue;

                try {
                    const guildMember = await guild.members.fetch(memberId);
                    if (guildMember) {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('Squad Name Changed')
                            .setDescription(`Your squad's name (**${currentSquadName}**) has been forcefully changed to **${newSquadName}** by a moderator.`)
                            .setColor(0xFFFF00);
                        await guildMember.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));

                        try {
                            await guildMember.setNickname(`[${newSquadName}] ${guildMember.user.username}`);
                        } catch (nickError) {
                            if (nickError.code !== 50013) {
                                console.log(`Could not update nickname for ${guildMember.user.tag} (${memberId}):`, nickError.message);
                            }
                        }
                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007) { console.log(`Member ${memberId} not found in guild, skipping nickname/DM.`); }
                    else { console.log(`Could not fetch member ${memberId} for nickname/DM: ${fetchError.message}`); }
                }
            }

            if (leaderId) {
                try {
                    const leader = await guild.members.fetch(leaderId);
                    if (leader) {
                        try {
                            await leader.setNickname(`[${newSquadName}] ${leader.user.username}`);
                        } catch (nickError) {
                            if (nickError.code !== 50013) {
                                console.log(`Could not update nickname for leader ${leader.user.tag} (${leaderId}):`, nickError.message);
                            }
                        }
                    }
                } catch (fetchError) {
                    if (fetchError.code === 10007) { console.log(`Leader ${leaderId} not found in guild, skipping nickname update.`); }
                    else { console.log(`Could not fetch leader ${leaderId} for nickname update: ${fetchError.message}`); }
                }
            }


            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                try {
                    await loggingChannel.send(`Squad **${currentSquadName}** was forcefully renamed to **${newSquadName}** by moderator **${moderatorUserTag}** (${moderatorUserId}).`);
                } catch (logError) {
                    console.error('Failed to send log message:', logError);
                }
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Name Forcefully Changed')
                .setDescription(`The squad **${currentSquadName}** has been successfully renamed to **${newSquadName}**. Members have been notified and nicknames updated (where possible).`)
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });


        } catch (error) {
            console.error('Error during the force-squad-name command execution:', error);
            let errorMessage = 'An error occurred while changing the squad name. Please try again later.';
            if (error.response?.data?.error) { errorMessage += ` (Details: ${error.response.data.error.message})`; }
            else if (error.message) { errorMessage += ` (Details: ${error.message})`; }
            await interaction.editReply({
                content: errorMessage,
                ephemeral: true
            });
        }
    }
};