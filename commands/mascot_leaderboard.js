const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { createCanvas, loadImage, registerFont } = require('canvas'); // Ensure 'canvas' is installed
const credentials = require('../resources/secret.json'); // Assuming path is correct

// --- Authorization Function ---
// Using the consistent authorize function pattern
function authorize() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT(
        client_email,
        null,
        // Ensure private key newlines are handled correctly if needed
        private_key.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets.readonly'] // Readonly is sufficient
    );
    return auth;
}

// --- Optional: Font Registration ---
try {
    // Example: registerFont('./fonts/BebasNeue-Regular.ttf', { family: 'Bebas Neue' });
    // registerFont('./fonts/YourSecondaryFont-Regular.ttf', { family: 'Your Secondary Font' });
    console.log("Attempted font registration (if paths were provided).");
} catch (fontError) {
    console.warn("Could not register custom fonts. Using system defaults.", fontError.message);
}

// --- Helper function for rounded rectangles ---
function roundRect(ctx, x, y, width, height, radius) {
    if (typeof radius === 'undefined') { radius = 5; }
    if (typeof radius === 'number') { radius = { tl: radius, tr: radius, br: radius, bl: radius }; }
    else { const defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 }; for (const side in defaultRadius) { radius[side] = radius[side] || defaultRadius[side]; } }
    ctx.beginPath(); ctx.moveTo(x + radius.tl, y); ctx.lineTo(x + width - radius.tr, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br); ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl); ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y); ctx.closePath();
}

// --- Image Generation Function ---
async function generateLeaderboardImage(data) {
    const canvasWidth = 1000;
    const topEntries = data.slice(0, 10);
    const headerHeight = 150;
    const footerHeight = 50;
    const rowHeight = 55;
    const startY = 210;
    const canvasHeight = headerHeight + (topEntries.length * rowHeight) + footerHeight;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // --- 1. Draw Background ---
    // Simple, clean, dark background
    ctx.fillStyle = '#1e1f26'; // Dark charcoal/blue
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    // Optional: Add a very subtle noise or texture overlay here if desired

    // --- 2. Draw Header ---
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // Slightly darker overlay for header contrast
    roundRect(ctx, 40, 30, canvasWidth - 80, 100, 10);
    ctx.fill();
    ctx.fillStyle = '#FFD700'; // Gold title
    ctx.font = 'bold 48px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2;
    ctx.fillText('🏆 Playoffs Leaderboard 🏆', canvasWidth / 2, 95);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // --- 3. Draw Column Headers ---
    const headerY = 180;
    ctx.fillStyle = '#BDC3C7'; // Light grey for headers
    ctx.font = '28px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rank', 150, headerY);
    ctx.fillText('Team Name', 450, headerY);
    // *** UPDATED HEADER TEXT ***
    ctx.fillText('Score', 800, headerY); // Changed from 'Wins'

    // --- 4. Draw Leaderboard Entries (Cards) ---
    const cardPadding = 8;
    const cardWidth = canvasWidth - 140;
    const cardX = 70;

    topEntries.forEach((team, index) => {
        const cardY = startY + index * rowHeight;

        // Card Background
        ctx.fillStyle = index === 0 ? 'rgba(201, 176, 55, 0.2)' : // Dull Gold tint
            index === 1 ? 'rgba(180, 180, 180, 0.2)' : // Silver tint
                index === 2 ? 'rgba(173, 138, 86, 0.2)' :  // Bronze tint
                    'rgba(44, 62, 80, 0.5)'; // Darker blue-grey tint
        roundRect(ctx, cardX, cardY, cardWidth, rowHeight - cardPadding, 8);
        ctx.fill();

        // Optional Card Border
        if (index < 3) {
            ctx.strokeStyle = index === 0 ? '#FFDF00' : index === 1 ? '#C0C0C0' : '#CD7F32';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Content Y position
        const contentY = cardY + (rowHeight - cardPadding) / 2 + 9;

        // Rank
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 28px "Bebas Neue", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`#${index + 1}`, 150, contentY);

        // Team Name
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '24px "Your Secondary Font", sans-serif'; // Use a readable secondary font
        ctx.textAlign = 'center';
        const maxTeamNameWidth = 450;
        let teamNameText = team.teamName;
        if (ctx.measureText(teamNameText).width > maxTeamNameWidth) {
            while (ctx.measureText(teamNameText + '...').width > maxTeamNameWidth && teamNameText.length > 0) { teamNameText = teamNameText.slice(0, -1); }
            teamNameText += '...';
        }
        ctx.fillText(teamNameText, 450, contentY);

        // *** UPDATED SCORE DISPLAY ***
        ctx.fillStyle = '#FFFFFF'; // White for score
        ctx.font = 'bold 28px "Bebas Neue", sans-serif';
        ctx.textAlign = 'center';
        // Format score - example: show 1 decimal place if not integer
        const scoreString = Number.isInteger(team.normalizedScore) ? String(team.normalizedScore) : team.normalizedScore.toFixed(1);
        ctx.fillText(scoreString, 800, contentY);
    });

    // --- 5. Footer ---
    ctx.fillStyle = '#AAAAAA';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';

    return canvas.toBuffer();
}

// --- Module Export (Command Definition and Execute) ---
module.exports = {
    data: new SlashCommandBuilder()
        .setName('playoffs_leaderboard')
        .setDescription('Displays the event playoff leaderboard based on normalized score.'), // Updated description

    async execute(interaction) {
        await interaction.deferReply();

        const auth = authorize();
        const sheets = google.sheets({ version: 'v4', auth });

        // *** UPDATED SHEET ID AND RANGE TO INCLUDE COLUMN G ***
        const spreadsheetId = '1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus';
        const range = `'Playoffs Conf'!D:G`; // Read columns D (Team) through G (Normalized Score)

        try {
            const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const rows = response.data.values;

            if (!rows || rows.length <= 1) {
                return interaction.editReply('No leaderboard data found in the sheet.');
            }

            // *** UPDATED DATA MAPPING AND SORTING ***
            const data = rows
                .slice(1) // Skip header row
                .map(row => ({
                    // Column D (index 0 in D:G range) is Team Name
                    teamName: row[0]?.trim() || 'Unknown Team',
                    // Column G (index 3 in D:G range) is Normalized Score
                    normalizedScore: parseFloat(row[3]) || 0 // Parse score as float, default 0
                }))
                .filter(team => team.teamName !== 'Unknown Team') // Filter out invalid entries
                .sort((a, b) => b.normalizedScore - a.normalizedScore); // Sort by normalizedScore descending

            if (data.length === 0) {
                return interaction.editReply('No valid leaderboard data could be processed.');
            }

            // Generate the image using the separate function
            const imageBuffer = await generateLeaderboardImage(data);

            // Send the image
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'playoffs-leaderboard.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('Error generating playoffs leaderboard:', error);
            await interaction.editReply({ content: 'Failed to generate the leaderboard due to an error.', ephemeral: true });
            // Optional: Log detailed error to a channel
            try {
                const errorGuild = await interaction.client.guilds.fetch('1233740086839869501'); // Example ID
                const errorChannel = await errorGuild.channels.fetch('1233853458092658749'); // Example ID
                const errorEmbed = new EmbedBuilder().setTitle('Leaderboard Command Error').setDescription(`**Error:** ${error.message}`).setColor(0xFF0000).setTimestamp();
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) { console.error("Failed to log leaderboard error:", logError); }
        }
    }
};