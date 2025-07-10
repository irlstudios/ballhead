const { SlashCommandBuilder } = require('@discordjs/builders');
const { google } = require('googleapis');
const { createCanvas, registerFont } = require('canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const credentials = require('../resources/secret.json');

const sheetId = '1zjBhY8oBLOlxuSLpozy0M4WpV11Q83kvoxs74u4EjyM';
const tabName = 'HRD Participants (Weekly)';

registerFont('./resources/Fonts/AntonSC-Regular.ttf', { family: 'Anton SC' });
registerFont('./resources/Fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });

function authorize() {
    const { client_email, private_key } = credentials;
    return new google.auth.JWT(
        client_email,
        null,
        private_key,
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hrd-leaderboard')
        .setDescription('Displays the home run derby weekly leaderboard'),
    async execute(interaction) {
        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        await interaction.deferReply();
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: `\`${tabName}\`!A:ZZ`
            });
            const rows = response.data.values;
            if (!rows || rows.length < 2) {
                return interaction.editReply({ content: 'No data found.', ephemeral: true });
            }
            const headers = rows[0];
            const dataRows = rows.slice(1);
            const homeRunCols = headers
                .map((title, index) => ({ title, index }))
                .filter(col => /^Home Runs$/i.test(col.title))
                .map(col => col.index);
            const nameCols = headers
                .map((title, index) => ({ title, index }))
                .filter(col => /Participants$/i.test(col.title))
                .map(col => col.index);
            const idCols = headers
                .map((title, index) => ({ title, index }))
                .filter(col => /^Discord ID$/i.test(col.title))
                .map(col => col.index);
            const entries = dataRows.map(row => {
                let total = homeRunCols.reduce((sum, idx) => sum + (parseInt(row[idx]) || 0), 0);
                const name = row[nameCols[0]] || '';
                const discordId = row[idCols[0]] || '';
                return { name, discordId, total };
            }).filter(e => e.name);
            const sorted = entries.sort((a, b) => b.total - a.total).slice(0, 10);
            const canvas = createCanvas(800, 200 + sorted.length * 60);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#2C2F33';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.font = 'bold 40px "Anton SC"';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('Home Run Derby Weekly', 20, 50);
            ctx.font = 'bold 30px "Bebas Neue"';
            sorted.forEach((entry, i) => {
                const y = 100 + i * 50;
                ctx.fillText(`#${i + 1}`, 20, y);
                ctx.fillText(entry.name, 80, y);
                ctx.fillText(entry.total.toString(), canvas.width - 80, y);
            });
            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'hrd_leaderboard.png' });
            const embed = new EmbedBuilder()
                .setTitle('HRD Weekly Leaderboard')
                .setColor('#7289DA')
                .setImage('attachment://hrd_leaderboard.png')
                .setTimestamp();
            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: 'Failed to fetch leaderboard.', ephemeral: true });
        }
    }
};