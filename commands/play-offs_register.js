const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

const authorize = () => {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key.replace(/\\n/g, '\n'), // Handle escaped newlines
        ['https://www.googleapis.com/auth/spreadsheets']
    );
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playoffs_signup')
        .setDescription('Sign up for the Playoffs')
        .addStringOption(option =>
            option.setName('team')
                .setDescription('Select your team')
                .setRequired(true)
                .addChoices(
                    { name: 'Skeletons', value: 'Skeletons' },
                    { name: 'Gorilla', value: 'Gorilla' },
                    { name: 'Alligator', value: 'Alligator' },
                    { name: 'Bee', value: 'Bee' },
                    { name: 'Snowmen', value: 'Snowmen' },
                    { name: 'Duck', value: 'Duck' }
                )
        ),
    async execute(interaction) {
        const team = interaction.options.getString('team');
        const discordId = interaction.user.id;
        const discordUsername = interaction.user.tag;

        const sheets = google.sheets({ version: 'v4', auth: authorize() });
        const spreadsheetId = '1oAvSbaP2Yo2R9PghLRgH_6hkE9yAdI6znnMVxji4NHg';
        const range = "Users!A:C";

        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            });
            const rows = response.data.values || [];

            // Check if user is already registered
            const userExists = rows.some(row => row[0] === discordId);

            if (userExists) {
                return interaction.reply({
                    content: '❌ You have already signed up! You can only sign up for one team.',
                    ephemeral: true
                });
            }

            // Append new user data if not already registered
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[discordId, discordUsername, team]]
                }
            });

            await interaction.reply({ content: `✅ Successfully signed up for **${team}** team!`, ephemeral: true });
        } catch (error) {
            console.error('Error processing signup:', error);
            await interaction.reply({ content: 'Failed to sign up. Please try again later.', ephemeral: true });
        }
    }
};
