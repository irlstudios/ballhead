const {SlashCommandBuilder} = require('discord.js');
const {REST, Routes} = require('discord.js');

const rest = new REST({version: '10'}).setToken(process.env.TOKEN);

const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refresh-commands')
        .setDescription('Refresh the bot\'s commands'),

    async execute(interaction) {
        const ownerId = process.env.BOT_OWNER_ID;
        const clientId = process.env.CLIENT_ID;

        if (interaction.user.id !== ownerId) {
            await interaction.reply({content: 'You do not have permission to use this command.', ephemeral: true});
            return;
        }

        try {
            await rest.put(Routes.applicationCommands(clientId), {body: []});
            console.log('Commands were refreshed.');
            await interaction.reply({content: 'All global commands have been successfully deleted.', ephemeral: true});
        } catch (error) {
            console.error('Failed to delete global commands:', error);
            await interaction.reply({
                content: 'Failed to delete global commands. Please check the console for more details.',
                ephemeral: true
            });

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while executing the refresh-commands command: ${error.message}`)
                    .setColor('#FF0000');

                await errorChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }
        }
    }
};