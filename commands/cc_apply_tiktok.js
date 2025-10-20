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
        .setName('tiktok-cc-apply')
        .setDescription('Apply for the TikTok Content Creator role')
        .addStringOption(option =>
            option.setName('handle')
                .setDescription('Your TikTok username or link')
                .setRequired(true)),
    async execute(interaction) {
        const handle = interaction.options.getString('handle');
        const userRoles = interaction.member.roles.cache;
        const prospect_role = '1003902288940765234';

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

        const tiktokRegex = /^(?:https?:\/\/(?:www\.)?tiktok\.com\/(@?[\w.-]+)\/?)|(@?[\w.-]+)$/;
        const match = handle.match(tiktokRegex);
        if (!match) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Format')
                .setDescription('Invalid TikTok username or link format. Accepted formats are:\n`exampleusername`\n`@exampleusername`\n`tiktok.com/exampleusername`\n`https://www.tiktok.com/exampleusername`')
                .setColor('#FF0000');
            return interaction.reply({embeds: [embed], ephemeral: true});
        }

        let tiktokUsername = match[1] || match[2];
        if (!tiktokUsername.startsWith('@')) {
            tiktokUsername = `@${tiktokUsername}`;
        }
        const tiktokUrl = `https://www.tiktok.com/${tiktokUsername}`;
        await interaction.deferReply({ephemeral: true});

        let accountExists = false;
        try {
            const browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            const page = await browser.newPage();
            await page.goto(tiktokUrl, {waitUntil: 'networkidle2'});
            const notFoundText = await page.evaluate(() => document.body.innerText.includes("Couldn't find this account"));
            const notFound404 = await page.evaluate(() => document.title.includes('404'));
            accountExists = !notFoundText && !notFound404;
            await browser.close();
        } catch (error) {
            console.error('Error checking TikTok account:', error);
            return interaction.editReply({content: 'Error checking TikTok account. Please try again later. Or try applying here : https://ballhead.app/apply'});
        }

        if (!accountExists) {
            return interaction.editReply({content: `TikTok account not found: ${tiktokUrl}`});
        }

        const sheets = google.sheets({version: 'v4', auth: authorize()});
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const yy = String(now.getUTCFullYear()).slice(-2);
        const timestamp = `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${yy}`;
        const cleanUsername = tiktokUsername.replace(/^@+/, '');
        const values = [
            ['Tiktok', cleanUsername, interaction.user.id, timestamp]
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

        const logChannel = interaction.client.channels.cache.get('1084168091778424972');
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('New TikTok CC Application')
                .setDescription(`User: ${interaction.user.username} (${interaction.user.id})\nTikTok: ${tiktokUrl}`)
                .setColor('#008000');
            logChannel.send({embeds: [logEmbed]});
        }

        await interaction.editReply({content: `Your application has been submitted successfully! TikTok: ${tiktokUrl}`});
        await interaction.member.roles.add(prospect_role);
    }
};
