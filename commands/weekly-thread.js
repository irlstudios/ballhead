const {SlashCommandBuilder} = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require('discord.js');

const ERROR_LOGGING_CHANNEL_ID = '1233853458092658749';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weekly-thread')
        .setDescription('Create the weekly thread for gym class general')
        .addStringOption(option =>
            option.setName('topic')
                .setDescription('The topic of the thread / discussion')
                .setRequired(true)),
    async execute(interaction) {
        const requiredRoleId = '805833778064130104';
        const channelId = '1112183354725515274';
        const reminderChannelId = '752216589792706624';
        const announcementRoleId = '911339799259017276';
        const topic = interaction.options.getString('topic');
        if (!interaction.member.roles.cache.has(requiredRoleId)) {
            return interaction.reply({
                content: 'You do not have the required role to use this command.',
                ephemeral: true
            });
        }

        try {
            const channel = await interaction.client.channels.fetch(channelId);
            const thread = await channel.threads.create({
                name: `Weekly Discussion: ${topic}`,
                autoArchiveDuration: 1440,
                reason: 'Weekly discussion thread created by bot',
            });

            await thread.send('Hey folks! Welcome to the weekly discussion thread where you can chat with others on the presented topic of the week. We would love to hear your thoughts so please drop them in here!');

            await interaction.reply({content: 'The weekly discussion thread has been created.', ephemeral: true});

            const announcementEmbed = new EmbedBuilder()
                .setTitle('Hey Gym Class! 🏋️‍♂️')
                .setDescription(`Exciting news for our weekly discussion this week – we're diving into **${topic}** 🌟 Don't miss out on the fun! Jump into the thread below and share your thoughts on the topic! 🗣️💬 Let's make this discussion the most vibrant one yet! 💪😄`);
            const announcementButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Join Thread')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://discord.com/channels/${interaction.guild.id}/${thread.id}`)
                );
            await channel.send({
                content: `<@&${announcementRoleId}>`,
                embeds: [announcementEmbed],
                components: [announcementButton]
            });

            const reminderEmbed = new EmbedBuilder()
                .setDescription(`Hey all, we would love to hear your thoughts on our weekly topic! 🌟 To join the discussion thread, simply hit the button below and let your ideas flow! 💬🚀`);
            const reminderButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Join Thread')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://discord.com/channels/${interaction.guild.id}/${thread.id}`)
                );

            let reminderMessage = await interaction.client.channels.fetch(reminderChannelId)
                .then(channel => channel.send({embeds: [reminderEmbed], components: [reminderButton]}));

            await new Promise(resolve => setTimeout(resolve, 20 * 60 * 1000));

            const interval = 20 * 60 * 1000;
            const duration = 24 * 60 * 60 * 1000;
            const iterations = duration / interval;

            for (let i = 0; i < iterations; i++) {
                await reminderMessage.delete();
                reminderMessage = await interaction.client.channels.fetch(reminderChannelId)
                    .then(channel => channel.send({embeds: [reminderEmbed], components: [reminderButton]}));
                await new Promise(resolve => setTimeout(resolve, interval));
            }
        } catch (error) {
            console.error('Error:', error);
            try {
                const errorLoggingChannel = await interaction.client.channels.fetch(ERROR_LOGGING_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while processing the \`weekly-thread\` command: ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorLoggingChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                console.error('Failed to log error:', logError);
            }

            if (!interaction.replied) {
                await interaction.reply({
                    content: 'An error occurred while processing your request.',
                    ephemeral: true
                }).catch(console.error);
            }
        }
    }
};