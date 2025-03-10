const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const sheetId = '1yxGmKTN27i9XtOefErIXKgcbfi1EXJHYWH7wZn_Cnok';
const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';

try {
    registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
    registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

function authorize() {
    const { client_email, private_key } = credentials;
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
        .setName('ff-leaderboard')
        .setDescription('Displays the leaderboard for the specified category')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('The category to display the leaderboard for')
                .setRequired(true)
                .addChoices(
                    { name: 'Points', value: 'Points' },
                    { name: 'Blocks', value: 'Blocks' },
                    { name: 'Steals', value: 'Steals' },
                    { name: 'Wins', value: 'Wins' },
                    { name: 'Games Played', value: 'Games Played' },
                    { name: 'Player Rating (MMR)', value: 'MMR' },
                )
        ),

    async execute(interaction) {
        const category = interaction.options.getString('category');
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        try {
            await interaction.deferReply();

            const sheetInfo = await sheets.spreadsheets.get({
                spreadsheetId: sheetId
            });

            const tabs = sheetInfo.data.sheets.map(sheet => sheet.properties.title);
            const currentSeasonTab = tabs
                .filter(tab => (tab.startsWith('Season') || tab.match(/Season \d+ Week \d+/)) && !tab.includes('Media'))
                .sort()
                .reverse()[0];

            if (!currentSeasonTab) {
                return interaction.editReply({ content: 'No valid season tab found.', ephemeral: true });
            }

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: `${currentSeasonTab}!A:J`
            });

            const rows = response.data.values;
            const headers = rows[0];
            const data = rows.slice(1);

            const categoryIndex = headers.indexOf(category);
            if (categoryIndex === -1) {
                return interaction.editReply({ content: `Category ${category} not found.`, ephemeral: true });
            }

            const sortedData = data.sort((a, b) => parseFloat(b[categoryIndex]) - parseFloat(a[categoryIndex]));
            const top10 = sortedData.slice(0, 10);

            const canvas = createCanvas(1000, 1400);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#4B0082');
            gradient.addColorStop(1, '#8A2BE2');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.font = 'bold 60px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.shadowBlur = 5;
            ctx.fillText(`${category} Leaderboard`, 50, 80);

            ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
            ctx.fillStyle = '#FFD700';
            ctx.fillText(`Friendly Fire ${currentSeasonTab}`, 50, 150);

            ctx.font = 'bold 50px "Anton SC", "Bebas Neue", sans-serif';
            top10.forEach((player, index) => {
                const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : '#ffffff';
                ctx.fillStyle = rankColor;
                ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;
                ctx.shadowBlur = 2;

                const yPosition = 250 + (index * 110);

                const containerGradient = ctx.createLinearGradient(0, yPosition - 50, 0, yPosition + 50);
                containerGradient.addColorStop(0, '#6A0DAD');
                containerGradient.addColorStop(1, '#8A2BE2');

                drawRoundedRect(ctx, 40, yPosition - 50, 920, 100, 15, containerGradient, rankColor);

                ctx.fillStyle = rankColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`#${index + 1} ${player[0]} - ${player[categoryIndex]} ${category}`, 500, yPosition);
            });

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'leaderboard.png' });
            const leaderboardEmbed = new EmbedBuilder()
                .setTitle(`${category} Leaderboard`)
                .setColor('#0099ff')
                .setImage('attachment://leaderboard.png')
                .setTimestamp()
                .setFooter({ text: `Friendly Fire ${currentSeasonTab}`, iconURL: 'https://ballhead.app/ff-leaderboard' });

            await interaction.editReply({ embeds: [leaderboardEmbed], files: [attachment] });

        } catch (error) {
            console.error('Error fetching leaderboard:', error);

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while fetching the leaderboard: ${error.message}`)
                    .setColor('#FF0000');

                await errorChannel.send({ embeds: [errorEmbed] });
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