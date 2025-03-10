const {SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle} = require('discord.js');
const {google} = require('googleapis');
const sheets = google.sheets('v4');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squads')
        .setDescription('See the list of all the squads and their owner registered in our system.'),
    async execute(interaction) {
        try {
            await interaction.deferReply({ephemeral: true});

            const auth = new google.auth.GoogleAuth({
                keyFile: 'resources/secret.json',
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const client = await auth.getClient();

            async function getSquadList() {
                const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';
                const range = 'Squad Leaders';
                try {
                    const response = await sheets.spreadsheets.values.get({
                        auth: client,
                        spreadsheetId,
                        range,
                    });
                    const rows = response.data.values;
                    if (rows.length) {
                        return rows.map(row => `- ${row[2]} (Owner: <@${row[1]}>)`);
                    } else {
                        return [];
                    }
                } catch (error) {
                    console.error('The API returned an error:', error);
                    return [];
                }
            }

            const squadList = await getSquadList();
            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(squadList.length / ITEMS_PER_PAGE);

            const generateEmbed = (page) => {
                const start = (page - 1) * ITEMS_PER_PAGE;
                const end = start + ITEMS_PER_PAGE;
                const pageItems = squadList.slice(start, end);
                return new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('List of Squads')
                    .setDescription(pageItems.join('\n'))
                    .setFooter({text: `Page ${page} of ${totalPages}`})
                    .setTimestamp();
            };

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('pagination_prev1')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('pagination_next1')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(totalPages === 1)
                );

            if (!interaction.client.commandData) {
                interaction.client.commandData = {};
            }

            interaction.client.commandData[interaction.id] = {
                squadList,
                totalPages,
                currentPage: 1
            };

            await interaction.editReply({embeds: [generateEmbed(1)], components: [row], ephemeral: true});
        } catch (error) {
            console.error('Error:', error);
            await interaction.editReply({content: 'An error occurred while executing the command.', ephemeral: true});
        }
    }
};
