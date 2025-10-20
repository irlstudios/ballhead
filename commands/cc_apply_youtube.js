const {SlashCommandBuilder} = require('@discordjs/builders');
const {EmbedBuilder} = require('discord.js');
const puppeteer = require('puppeteer');
const {google} = require('googleapis');
const credentials = require('../resources/secret.json');

function authorize() {
    const {client_email, private_key} = credentials;
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
        .setName('youtube-cc-apply')
        .setDescription('Apply for the YouTube Content Creator role')
        .addStringOption(option =>
            option.setName('handle')
                .setDescription('Your YouTube username or link')
                .setRequired(true)),
    async execute(interaction) {
        const handle = interaction.options.getString('handle');
        const userRoles = interaction.member.roles.cache;
        const prospect_role = '1094048523844063313';

        const requiredRoles = [
            '924522770057031740',
            '924522921370714152',
            '924522979768016946',
            '924523044268032080',
            '1242262635223715971',
            '925177626644058153',
            '1087071951270453278',
            '1223408044784746656'
        ];

        if (!requiredRoles.some(role => userRoles.has(role))) {
            return interaction.reply({content: 'You do not have the required role to apply.', ephemeral: true});
        }

        const youtubeRegex = /^(?:https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)?([\w.-]+)|([\w.-]+))$/;
        const match = handle.match(youtubeRegex);
        if (!match) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Format')
                .setDescription('Invalid YouTube username or link format. Accepted formats are:\n`exampleusername`\n`@exampleusername`\n`https://www.youtube.com/@exampleusername`\n`https://www.youtube.com/channel/UCzvtjvh8GODN_yIm-Gz8vbw`')
                .setColor('#FF0000');
            return interaction.reply({embeds: [embed], ephemeral: true});
        }

        let youtubeUsername = match[1] || match[2];
        let youtubeUrl;
        if (youtubeUsername.startsWith('@')) {
            youtubeUrl = `https://www.youtube.com/${youtubeUsername}`;
        } else if (youtubeUsername.startsWith('UC')) {
            youtubeUrl = `https://www.youtube.com/channel/${youtubeUsername}`;
        } else if (youtubeUsername.startsWith('c/') || youtubeUsername.startsWith('user/')) {
            youtubeUrl = `https://www.youtube.com/${youtubeUsername}`;
        } else {
            youtubeUrl = `https://www.youtube.com/@${youtubeUsername}`;
        }

        await interaction.deferReply({ephemeral: true});

        let accountExists = false;
        try {
            const browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            const page = await browser.newPage();
            await page.goto(youtubeUrl, {waitUntil: 'networkidle2'});

            const accountNotFound = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return (
                    bodyText.includes("This page isn't available") ||
                    bodyText.includes("Sorry about that.") ||
                    bodyText.includes("Try searching for something else.") ||
                    document.title.includes("404")
                );
            });

            accountExists = !accountNotFound;
            await browser.close();
        } catch (error) {
            console.error('Error checking YouTube account:', error);
            return interaction.editReply({content: 'Error checking YouTube account. Please try again later. Or try applying here : https://ballhead.app/apply'});
        }

        if (!accountExists) {
            return interaction.editReply({content: `YouTube account not found: ${youtubeUrl}`});
        }

        const sheets = google.sheets({version: 'v4', auth: authorize()});
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const yy = String(now.getUTCFullYear()).slice(-2);
        const timestamp = `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${yy}`;
        const cleanUsername = youtubeUsername.replace(/^@+/, '');
        const values = [
            ['YouTube', cleanUsername, interaction.user.id, timestamp]
        ];

        try {
            await sheets.spreadsheets.values.append({
                spreadsheetId: '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk',
                range: "'CC Applications'!A:D",
                valueInputOption: 'RAW',
                resource: {values}
            });
        } catch (error) {
            console.error('Error logging to Google Sheets:', error);
            return interaction.editReply({content: 'Error logging your application. Please try again later.'});
        }

        const logChannel = interaction.client.channels.cache.get('1098354875324174477');
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('New YouTube CC Application')
                .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\nYouTube: ${youtubeUrl}`)
                .setColor('#00ff00');
            logChannel.send({embeds: [logEmbed]});
        }

        await interaction.editReply({content: `Your application has been submitted successfully! YouTube: ${youtubeUrl}`});
        await interaction.member.roles.add(prospect_role);
    }
};
