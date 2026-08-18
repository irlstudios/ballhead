const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const {
    BOT_BUGS_CHANNEL_ID,
    WEEKLY_DISCUSSION_CHANNEL_ID,
} = require('../../config/constants');

const REQUIRED_ROLE_ID = '805833778064130104';
const ANNOUNCEMENT_ROLE_ID = '911339799259017276';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weekly-thread')
        .setDescription('Create the weekly thread for gym class general')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
        .addStringOption(option =>
            option.setName('topic')
                .setDescription('The topic of the thread / discussion')
                .setRequired(true)
                .setMaxLength(500)),
    async execute(interaction) {
        const topic = interaction.options.getString('topic');
        if (!interaction.member.roles.cache.has(REQUIRED_ROLE_ID)) {
            return interaction.reply({
                content: 'You do not have the required role to use this command.',
                ephemeral: true
            });
        }

        try {
            const channel = await interaction.client.channels.fetch(WEEKLY_DISCUSSION_CHANNEL_ID);
            const thread = await channel.threads.create({
                // Discord caps thread names at 100 chars; full topic goes in the announcement.
                name: `Weekly Discussion: ${topic}`.slice(0, 100),
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
                content: `<@&${ANNOUNCEMENT_ROLE_ID}>`,
                embeds: [announcementEmbed],
                components: [announcementButton],
                // The client-wide allowedMentions strips role pings; this ping is intentional.
                allowedMentions: { roles: [ANNOUNCEMENT_ROLE_ID] }
            });
        } catch (error) {
            logger.error('[WeeklyThread] Command failed:', error);
            try {
                const errorLoggingChannel = await interaction.client.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription(`An error occurred while processing the \`weekly-thread\` command: ${error.message}`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await errorLoggingChannel.send({embeds: [errorEmbed]});
            } catch (logError) {
                logger.error('[WeeklyThread] Failed to log error:', logError);
            }

            if (!interaction.replied) {
                await interaction.reply({
                    content: 'An error occurred while processing your request.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
};
