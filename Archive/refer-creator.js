const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return auth;
}

async function logReferral(referrerUsername, referrerId, referredUsername, referredId, date) {
    const sheets = google.sheets({ version: 'v4', auth: authorize() });
    const spreadsheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
    const range = 'Referring <> Referred Creators';

    const values = [[referrerUsername, referrerId, referredUsername, referredId, date]];

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values,
        },
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refer')
        .setDescription('Refer an active IG or YT creator.')
        .addUserOption(option =>
            option
                .setName('creator')
                .setDescription('The Discord user of the creator you want to refer.')
                .setRequired(true)
        ),
    async execute(interaction) {
        try {
            const referredUser = interaction.options.getUser('creator');
            const referrer = interaction.user;

            if (!referredUser) {
                return interaction.reply({
                    content: 'You need to specify a valid Discord user.',
                    ephemeral: true,
                });
            }

            const referrerUsername = referrer.username;
            const referrerId = referrer.id;
            const referredUsername = referredUser.username;
            const referredId = referredUser.id;
            const date = new Date().toISOString().split('T')[0];

            if (referrerId === referredId) {
                return interaction.reply({
                    content: 'You cant refer yourself silly',
                    ephemeral: true,
                })
            }

            await logReferral(referrerUsername, referrerId, referredUsername, referredId, date);

            await interaction.reply({
                content: `Successfully referred **${referredUsername}**! Thank you for your submission.`,
                ephemeral: true,
            });
        } catch (error) {
            console.error('Error logging referral:', error);
            await interaction.reply({
                content: 'There was an error logging your referral. Please try again later.',
                ephemeral: true,
            });
        }
    },
};