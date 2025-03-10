const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
require('dotenv').config();
const axios = require('axios');

const ERROR_LOG_CHANNEL_ID = '1233853458092658749';
const ERROR_LOG_GUILD_ID = '1233740086839869501';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bot-info')
        .setDescription('Get some info on the bot'),
    async execute(interaction) {
        const client = interaction.client;

        try {
            const responseTime = await axios.get('http://localhost:3000/api-response-time')
                .then(response => response.data)
                .catch(err => {
                    console.error('Failed to fetch response time:', err);
                    return 'Unavailable';
                });

            const currentPrefix = process.env.BOT_PREFIX;
            const randomColor = Math.floor(Math.random() * 16777215).toString(16);
            const totalSeconds = (client.uptime / 1000);
            const days = Math.floor(totalSeconds / 86400);
            const hours = Math.floor(totalSeconds / 3600) % 24;
            const minutes = Math.floor(totalSeconds / 60) % 60;
            const seconds = Math.floor(totalSeconds % 60);
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const usedMemory = totalMemory - freeMemory;
            const usedMemoryMB = Math.floor(usedMemory / 1024 / 1024);
            const totalMemoryMB = Math.floor(totalMemory / 1024 / 1024);
            const memoryUsage = process.memoryUsage();
            const rssMemoryMB = Math.floor(memoryUsage.rss / 1024 / 1024);
            const cpus = os.cpus();
            const cpu = cpus[0];
            const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0);
            const percentageCPU = ((cpu.times.user + cpu.times.nice + cpu.times.sys) / total) * 100;
            const nodeVersion = process.version;

            const embed = new EmbedBuilder()
                .setTitle('Bot Information')
                .setDescription(`
                    # Info
                    - Current Prefix: ${currentPrefix}
                    - Community Server discord.gg/ballhead
                `)
                .addFields(
                    { name: 'Bot Uptime', value: `> ${days}d ${hours}h ${minutes}m ${seconds}s`, inline: false },
                    { name: 'Ping', value: `> ${Math.round(client.ws.ping)} ms`, inline: false },
                    { name: 'API Response Time', value: `> ${responseTime}`, inline: false },
                    {
                        name: 'CPU & RAM Usage ',
                        value: `> CPU % : ${percentageCPU.toFixed(2)}% \n > RAM : ${usedMemoryMB} MB of ${totalMemoryMB} MB (RSS: ${rssMemoryMB} MB)`,
                        inline: false
                    },
                    { name: 'Node.js Version', value: `> ${nodeVersion}`, inline: false }
                )
                .setColor(`#${randomColor}`)
                .setTimestamp()
                .setFooter({ text: 'Bot Info', iconURL: client.user.displayAvatarURL() });

            await interaction.reply({ embeds: [embed], ephemeral: true });

            const commandData = {
                command_name: interaction.commandName,
                user_id: interaction.user.id,
                channel_id: interaction.channelId,
                server_id: interaction.guildId,
                timestamp: new Date()
            };

            await axios.post('http://localhost:3000/api/command-usage', commandData)
                .catch(err => {
                    console.error('Failed to send command usage data:', err);
                });
        } catch (error) {
            console.error('Error executing the bot-info command:', error);

            const errorEmbed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription(`An error occurred while executing the bot-info command: ${error.message}`)
                .setColor('#FF0000');

            try {
                const errorGuild = await interaction.client.guilds.fetch(ERROR_LOG_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(ERROR_LOG_CHANNEL_ID);
                await errorChannel.send({ embeds: [errorEmbed] });
            } catch (logError) {
                console.error('Failed to send error log:', logError);
            }

            if (!interaction.replied) {
                await interaction.reply({ content: 'An error occurred while processing your request. The admins have been notified.', ephemeral: true });
            }
        }
    },
};