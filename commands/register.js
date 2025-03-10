const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const axios = require('axios');
const credentials = require('../resources/secret.json');

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
    cooldown: 604800,
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Request the creation of a Squad!')
        .addStringOption(option =>
            option.setName('squadname')
                .setDescription('The name of your Squad!')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('squadtype')
                .setDescription('Select the type of your Squad.')
                .setRequired(true)
                .addChoices(
                    { name: 'Casual', value: 'Casual' },
                    { name: 'Competitive', value: 'Competitive' },
                    { name: 'Content', value: 'Content' }
                )),

    async execute(interaction) {
        const requiredRoleId = '924522770057031740';
        const hasRequiredRole = interaction.member.roles.cache.has(requiredRoleId);

        if (!hasRequiredRole) {
            return interaction.reply({ content: 'You must have the <@&924522770057031740> role to register a squad!', ephemeral: true });
        }

        const squadName = interaction.options.getString('squadname').toUpperCase();
        const squadType = interaction.options.getString('squadtype');
        const userId = interaction.user.id;
        const username = interaction.user.username;

        if (!/^[A-Z0-9]{1,4}$/.test(squadName)) {
            return interaction.reply({
                content: 'Squad names must be 1 to 4 alphabetical or numerical characters.',
                ephemeral: true
            });
        }

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        try {
            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'All Data!A:E'
            });

            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Squad Leaders!A:C'
            });

            const applicationsResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Applications!A:F'
            });

            const allData = allDataResponse.data.values;
            const squadLeaders = squadLeadersResponse.data.values;
            const applications = applicationsResponse.data.values;

            const userInAllData = allData.find(row => row[1] === userId);
            const userInSquadLeaders = squadLeaders.find(row => row[1] === userId);
            const squadNameTaken = squadLeaders.find(row => row[2] === squadName);

            if (userInSquadLeaders || (userInAllData && userInAllData[3] === 'Yes')) {
                return interaction.reply({
                    content: 'You already own a squad and cannot register a new one.',
                    ephemeral: true
                });
            }

            if (userInAllData && userInAllData[2] !== 'N/A') {
                return interaction.reply({
                    content: 'You are already in a squad and cannot register a new one.',
                    ephemeral: true
                });
            }

            if (squadNameTaken) {
                return interaction.reply({
                    content: 'This squad tag is already taken. Please choose a different one.',
                    ephemeral: true
                });
            }

            const applicationEmbed = new EmbedBuilder()
                .setTitle('New Squad Registration')
                .addFields(
                    { name: 'Username', value: username, inline: true },
                    { name: 'User ID', value: userId, inline: true },
                    { name: 'Squad Name', value: squadName, inline: true },
                    { name: 'Squad Type', value: squadType, inline: true }
                )
                .setTimestamp();

            const actionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`application_accept_${interaction.id}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`application_deny_${interaction.id}`)
                        .setLabel('Deny')
                        .setStyle(ButtonStyle.Danger)
                );

            const channel = await interaction.client.channels.fetch('1218466649695457331');
            const applicationMessage = await channel.send({ embeds: [applicationEmbed], components: [actionRow] });

            const applicationData = {
                member_display_name: interaction.member.displayName,
                member_object: {
                    id: interaction.user.id,
                    username: interaction.user.username,
                    discriminator: interaction.user.discriminator,
                    avatar: interaction.user.avatar
                },
                member_squad_name: squadName,
                message_url: applicationMessage.url,
                user_id: userId,
                squad_type: squadType
            };

            await axios.post('http://localhost:3000/api/squad-application', applicationData);

            await sheets.spreadsheets.values.append({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: 'Applications!A:F',
                valueInputOption: 'RAW',
                resource: {
                    values: [
                        [username, userId, squadName, squadType, applicationMessage.url, 'Pending']
                    ]
                }
            });

            await interaction.reply({ content: 'Your squad application has been submitted.', ephemeral: true });
        } catch (error) {
            console.error(error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription(`An error occurred while processing the squad registration command: ${error.message}`)
                .setColor('#FF0000');

            const errorGuild = await interaction.client.guilds.fetch('1233740086839869501');
            const errorChannel = await errorGuild.channels.fetch('1233853458092658749');
            await errorChannel.send({ embeds: [errorEmbed] });

            await interaction.editReply({
                content: 'An error occurred while processing your request. The admins have been notified.',
                ephemeral: true
            });
        }
    }
};
