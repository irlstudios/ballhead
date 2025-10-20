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
        .setName('instagram-cc-apply')
        .setDescription('Apply for the Instagram Content Creator role')
        .addStringOption(option =>
            option.setName('handle')
                .setDescription('Your Instagram username or link')
                .setRequired(true)),
    async execute(interaction) {
        const usernameOrLink = interaction.options.getString('handle');
        const userRoles = interaction.member.roles.cache;
        const prospect_role = '1270464270722928700';

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

        const instagramRegex = /^(?:https?:\/\/(?:www\.)?instagram\.com\/([\w.-]+)\/?|([\w.-]+))$/;
        const match = usernameOrLink.match(instagramRegex);
        if (!match) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Format')
                .setDescription('Invalid Instagram username or link format. Accepted formats are:\n`yourusername`\n`https://instagram.com/yourusername/`\n`https://www.instagram.com/yourusername/`')
                .setColor('#FF0000');
            return interaction.reply({embeds: [embed], ephemeral: true});
        }

        let instagramUsername = match[1] || match[2];
        const instagramUrl = `https://www.instagram.com/${instagramUsername}/`;

        await interaction.deferReply({ephemeral: true});

        let accountExists = false;
        try {
            const browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            const page = await browser.newPage();
            await page.goto(instagramUrl, {waitUntil: 'networkidle2'});

            const accountNotFound = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return bodyText.includes("Sorry, this page isn't available.") || bodyText.includes("The link you followed may be broken, or the page may have been removed.");
            });

            accountExists = !accountNotFound;
            await browser.close();
        } catch (error) {
            console.error('Error checking Instagram account:', error);
            return interaction.editReply({content: 'Error checking Instagram account. Please try again later. Or try applying here : https://ballhead.app/apply'});
        }

        if (!accountExists) {
            return interaction.editReply({content: `Instagram account not found: ${instagramUrl}`});
        }

        const sheets = google.sheets({version: 'v4', auth: authorize()});
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const yy = String(now.getUTCFullYear()).slice(-2);
        const timestamp = `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${yy}`;
        const cleanUsername = instagramUsername.replace(/^@+/, '');
        const values = [
            ['Reels', cleanUsername, interaction.user.id, timestamp]
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

        const logChannel = interaction.client.channels.cache.get('1128804307261718568');
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('New Instagram CC Application')
                .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\nInstagram: ${instagramUrl}`)
                .setColor('#00ff00');
            logChannel.send({embeds: [logEmbed]});
        }

        await interaction.editReply({content: `Your application has been submitted successfully! Instagram: ${instagramUrl}`});
        await interaction.member.roles.add(prospect_role);
    }
};
