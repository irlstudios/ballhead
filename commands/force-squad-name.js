const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const axios = require('axios');
const credentials = require('../resources/secret.json');

const MODERATOR_ROLES = ['805833778064130104', '909227142808756264'];

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
    );
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

        const userId = interaction.user.id;
        const squadName = interaction.options.getString('squad').toUpperCase();
        const newSquadName = interaction.options.getString('new-name').toUpperCase();
        const member = await interaction.guild.members.fetch(userId);

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
                content: 'Invalid squad name. The name must be between 1 and 4 alphanumeric characters.',
                ephemeral: true
            });
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });


        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:C'
            });

            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:C'
            });

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F'
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            const squadLeaderRow = squadLeaders.find(row => row[2] === squadName);
            if (!squadLeaderRow) {
                return interaction.editReply({
                    content: `The squad **${squadName}** does not exist.`,
                    ephemeral: true
                });
            }

            const isSquadNameTaken = squadLeaders.some(row => row[2] === newSquadName);
            if (isSquadNameTaken) {
                return interaction.editReply({
                    content: `The squad name ${newSquadName} is already in use. Please choose a different name.`,
                    ephemeral: true
                });
            }

            const updatedSquadLeaders = squadLeaders.map(row => {
                if (row[2] === squadName) {
                    return [row[0], row[1], newSquadName];
                }
                return row;
            });

            const updatedSquadMembers = squadMembers.map(row => {
                if (row[2] === squadName) {
                    return [row[0], row[1], newSquadName];
                }
                return row;
            });

            const updatedAllData = allData.map(row => {
                if (row[2] === squadName) {
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5]];
                }
                return row;
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:C',
                valueInputOption: 'RAW',
                resource: { values: updatedSquadLeaders }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Members!A:C',
                valueInputOption: 'RAW',
                resource: { values: updatedSquadMembers }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:F',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            });

            const squadMembersToUpdate = squadMembers.filter(row => row[2] === squadName);
            for (const memberRow of squadMembersToUpdate) {
                const memberId = memberRow[1];
                const member = await interaction.guild.members.fetch(memberId).catch(() => null);
                if (member) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Squad Name Changed')
                        .setDescription(`The squad name has been forcefully changed to **${newSquadName}** by a moderator.`)
                        .setColor(0x00FF00);
                    await member.send({ embeds: [dmEmbed] }).catch(() => null);

                    try {
                        await member.setNickname(`[${newSquadName}] ${member.user.username}`);
                    } catch (error) {
                        console.log(`Could not update nickname for ${memberId}:`, error.message);
                    }
                }
            }

            const leaderId = squadLeaderRow[1];
            const leader = await interaction.guild.members.fetch(leaderId);
            if (leader) {
                try {
                    await leader.setNickname(`[${newSquadName}] ${leader.user.username}`);
                } catch (error) {
                    console.log(`Could not update nickname for ${leaderId}:`, error.message);
                }
            }

            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                await loggingChannel.send(`The squad **${squadName}** has been renamed to **${newSquadName}** by a moderator.`);
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('Squad Name Forcefully Changed')
                .setDescription(`The squad name has been successfully changed to **${newSquadName}** by a moderator.`)
                .setColor(0x00FF00);

            await interaction.editReply({ embeds: [successEmbed], ephemeral: true });


        } catch (error) {
            console.error('Error during the command execution:', error);
            await interaction.editReply({
                content: 'An error occurred while changing the squad name. Please try again later.',
                ephemeral: true
            });
        }
    }
};
