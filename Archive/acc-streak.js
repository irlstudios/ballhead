const {SlashCommandBuilder} = require('@discordjs/builders');
const {google} = require('googleapis');
const {EmbedBuilder} = require('discord.js');
const credentials = require('../resources/secret.json');
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';

const ccRoles = {
    '1256318001796485250': '#3498db', // Sponsored
    '1256318239097622651': '#2ecc71', // Top Active
    '1130621784677421096': '#e74c3c', // Reels CC
    '879911243471802378': '#9b59b6',  // YouTube
    '879911017281359882': '#f1c40f'   // TikTok CC
};

function authorize() {
    const {client_email, private_key} = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    return auth;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acc-streak')
        .setDescription('Displays the activity streak for a specified user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check the activity streak for')
                .setRequired(true)
        ),

    async execute(interaction) {
        const auth = authorize();
        const sheets = google.sheets({version: 'v4', auth});

        const user = interaction.options.getUser('user');
        const userId = user.id;

        const member = await interaction.guild.members.fetch(userId);
        const memberRoles = member.roles.cache.map(role => role.id);

        const userTopRoleColor = memberRoles.map(roleId => ccRoles[roleId]).filter(Boolean)[0] || '#34495e';

        try {
            await interaction.deferReply({ephemeral: true});

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: 'Active CC!A:ZZ'
            });

            const rows = response.data.values;
            const headers = rows[2];
            const data = rows.slice(3);

            const userData = data.find(row => row[2] === userId);

            if (!userData) {
                return interaction.editReply({content: 'No data found for this user.', ephemeral: true});
            }

            let streak = 0;
            let activityWeeks = [];

            for (let i = headers.length - 1; i >= 6; i--) {
                if (userData[i] === 'TRUE') {
                    streak++;
                    activityWeeks.push({week: headers[i], active: true});
                } else {
                    activityWeeks.push({week: headers[i], active: false});
                }
            }

            const streakEmbed = new EmbedBuilder()
                .setTitle(`Activity Streak for ${user.username}`)
                .setDescription(`**Current Streak:** ${streak} week(s)`)
                .setColor(userTopRoleColor);

            await interaction.editReply({embeds: [streakEmbed], ephemeral: true});

        } catch (error) {
            console.error('Error fetching activity streak:', error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while fetching the activity streak: ${error.message}`)
                    .setColor('#FF0000');

                await errorChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            await interaction.editReply({
                content: 'An error occurred while fetching the activity streak. The admins have been notified.',
                ephemeral: true
            });
        }
    }
};