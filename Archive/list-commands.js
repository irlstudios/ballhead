const { SlashCommandBuilder } = require('discord.js');

const compSquadLevelRoles = [
    '1288918067178508423',
    '1288918165417365576',
    '1288918209294237707',
    '1288918281343733842'
];

const contentSquadLevelRoles = [
    '1291090496869109762',
    '1291090569346682931',
    '1291090608315699229',
    '1291090760405356708'
];


module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-cmd')
        .setDescription('Lists all available commands and their descriptions'),

    async execute(interaction) {
        const commandList = interaction.client.commands.map(command =>
            `/${command.data.name}`
        ).join('\n');

        await interaction.reply({
            content: `${commandList}`,
            ephemeral: true
        });
    }
};