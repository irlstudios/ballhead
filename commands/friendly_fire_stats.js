const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

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

const auth = authorize();

const sheetId = '1yxGmKTN27i9XtOefErIXKgcbfi1EXJHYWH7wZn_Cnok';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ff-stats')
    .setDescription('Get tournament stats for a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to look up')
        .setRequired(false)),
  async execute(interaction) {
    await interaction.deferReply({flags: 64});

    const user = interaction.options.getUser('user') || interaction.user;
    const discordId = user.id;

    const sheets = google.sheets({ version: 'v4', auth });

    const metadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const seasonTabs = metadata.data.sheets
      .map(s => s.properties.title)
      .filter(t => /^Season \d+$/.test(t))
      .map(t => ({ title: t, num: parseInt(t.split(' ')[1], 10) }))
      .sort((a, b) => b.num - a.num);

    if (seasonTabs.length === 0) {
      return interaction.editReply('No valid season sheets found.');
    }

    const latestSeason = seasonTabs[0].title;
    const range = `'${latestSeason}'!A:H`;
    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    const rows = sheet.data.values;
    if (!rows || rows.length < 2) {
      return interaction.editReply('The stats sheet is empty or invalid.');
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const discordIdIndex = headers.indexOf('DiscordID');

    const userRow = dataRows.find(row => row[discordIdIndex] === discordId);

    if (!userRow) {
      if (user.id === interaction.user.id) {
        return interaction.editReply({ content: `You haven't signed up yet. Please register here: https://forms.gle/DKLWrwU9BzBMiT9X7`, flags: 64 });
      } else {
        return interaction.editReply({ content: `${user.username} hasn't signed up yet.`, flags: 64 });
      }
    }

    const name = userRow[0] || 'Unknown';
    const points = userRow[1] || '0';
    const blocks = userRow[2] || '0';
    const steals = userRow[3] || '0';
    const wins = userRow[4] || '0';
    const gamesPlayed = userRow[5] || '0';
    const mmr = userRow[6] || '0';

    const embed = new EmbedBuilder()
      .setTitle(`${name}'s Stats - ${latestSeason}`)
      .addFields(
        { name: 'MMR', value: mmr, inline: true },
        { name: 'Points', value: points, inline: true },
        { name: 'Blocks', value: blocks, inline: true },
        { name: 'Steals', value: steals, inline: true },
        { name: 'Wins', value: wins, inline: true },
        { name: 'Games Played', value: gamesPlayed, inline: true },
      )
      .setFooter({ text: `Stats from "${latestSeason}"` });

    await interaction.editReply({ embeds: [embed] });
  },
};