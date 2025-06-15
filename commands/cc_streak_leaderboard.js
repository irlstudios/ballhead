const {SlashCommandBuilder} = require('@discordjs/builders');
const {google} = require('googleapis');
const {createCanvas, loadImage, registerFont} = require('canvas');
const {AttachmentBuilder, EmbedBuilder} = require('discord.js');
const credentials = require('../resources/secret.json');

const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';
const excludedRoles = ['1024725674696646717', '1256318001796485250'];

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', {family: 'Anton SC'});
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', {family: 'Bebas Neue'});
} catch (error) {
    console.error('Error loading fonts:', error);
}

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

function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cc-streak-leaderboard')
        .setDescription('Displays the leaderboard for active CCs\' posting streaks.'),

    async execute(interaction) {
        const auth = authorize();
        const sheets = google.sheets({version: 'v4', auth});

        try {
            await interaction.deferReply();

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: 'Active CC!A:ZZ'
            });

            const rows = response.data.values;
            const headers = rows[2];
            const data = rows.slice(3);

            const currentWeekIndex = headers.length - 1;

            const guildMembers = await interaction.guild.members.fetch();

            const streaks = data.map(row => {
                const username = row[1];
                const discordId = row[2];
                const member = guildMembers.get(discordId);

                if (member && excludedRoles.some(role => member.roles.cache.has(role))) {
                    return null;
                }

                let streak = 0;
                for (let i = currentWeekIndex; i >= 6; i--) {
                    if (row[i] === 'TRUE') {
                        streak++;
                    } else {
                        break;
                    }
                }

                return {username, discordId, streak};
            }).filter(Boolean);

            const sortedStreaks = streaks.sort((a, b) => b.streak - a.streak);
            const top10 = sortedStreaks.slice(0, 10);

            const canvas = createCanvas(1000, 1400);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#ec336a');
            gradient.addColorStop(1, '#fa8a28');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.font = 'bold 60px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.shadowBlur = 5;
            ctx.fillText('Active CC Streak Leaderboard', 50, 80);

            ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
            top10.forEach((cc, index) => {
                const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#DAA520' : '#ffffff';
                ctx.fillStyle = rankColor;
                ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;
                ctx.shadowBlur = 2;

                const yPosition = 250 + (index * 110);

                const containerGradient = ctx.createLinearGradient(0, yPosition - 50, 0, yPosition + 50);
                containerGradient.addColorStop(0, '#b74a04');
                containerGradient.addColorStop(1, '#fa8a28');

                drawRoundedRect(ctx, 40, yPosition - 50, 920, 100, 15, containerGradient, rankColor);

                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`#${index + 1} ${cc.username} - ${cc.streak} week streak`, 500, yPosition);
            });

            const attachment = new AttachmentBuilder(canvas.toBuffer(), {name: 'cc-leaderboard.png'});
            const leaderboardEmbed = new EmbedBuilder()
                .setTitle('Active CC Streak Leaderboard')
                .setColor('#0099ff')
                .setImage('attachment://cc-leaderboard.png')
                .setTimestamp()
                .setFooter({text: 'Active CC Streaks', iconURL: 'https://cdn.ballhead.app/web_assets/logo.png'});

            await interaction.editReply({embeds: [leaderboardEmbed], files: [attachment]});

        } catch (error) {
            console.error('Error fetching leaderboard:', error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while fetching the leaderboard: ${error.message}`)
                    .setColor('#FF0000');

                await errorChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            await interaction.editReply({
                content: 'An error occurred while fetching the leaderboard. The admins have been notified.',
                ephemeral: true
            });
        }
    }
};
