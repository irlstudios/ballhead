const { SlashCommandBuilder } = require("@discordjs/builders");
const { Client } = require('pg');

const clientConfig = {
    host: process.env.HOST,
    user: process.env.USER,
    database: process.env.DATABASE,
    password: process.env.PASSWORD,
    ssl: { rejectUnauthorized: false },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-league-description')
        .setDescription('Updates the description of a league.')
        .addStringOption(option => option.setName('description').setDescription('The new description of the league.').setRequired(true)),
    async execute(interaction) {
        await interaction.reply.defer()
        const pgClient = new Client(clientConfig)
        await pgClient.connect();
        const description = interaction.options.getString('description');

        const leagueOwnerRole = ''
        const leagueCoOwnerRole = ''

        const userRoles = interaction.member.roles.cache

        const hasRequiredRole = userRoles.has(leagueOwnerRole) || userRoles.has(leagueCoOwnerRole)

        if (!hasRequiredRole) {
            return interaction.reply({
                content: "Your not a league owner, therefor you can not update a league description \n#- if you think this is a mistake please contact support and have the issue escalated to the developers.",
                ephemeral: true
            });
        }

        const league = await pgClient.query('SELECT owner_id, ')
    }
};