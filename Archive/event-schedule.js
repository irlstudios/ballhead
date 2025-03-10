const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('event-schedule')
        .setDescription('View the schedule of upcoming events in the server.')
        .addStringOption(option =>
            option.setName('day')
                .setDescription('Filter by day of the week.')
                .addChoices(
                    { name: 'Sunday', value: 'Sunday' },
                    { name: 'Monday', value: 'Monday' },
                    { name: 'Tuesday', value: 'Tuesday' },
                    { name: 'Wednesday', value: 'Wednesday' },
                    { name: 'Thursday', value: 'Thursday' },
                    { name: 'Friday', value: 'Friday' },
                    { name: 'Saturday', value: 'Saturday' }
                )
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Filter by the user hosting the event.')
                .setRequired(false)
        ),
    async execute(interaction) {
        try {
            await interaction.deferReply();

            const dayFilter = interaction.options.getString('day');
            const userFilter = interaction.options.getUser('user')?.id || null;

            const guild = interaction.guild;
            const events = await guild.scheduledEvents.fetch();

            if (!events.size) {
                return interaction.editReply({
                    content: 'There are no scheduled events in this server.',
                    ephemeral: true
                });
            }

            let filteredEvents = events;

            if (dayFilter) {
                const dayIndex = getDayIndex(dayFilter);
                filteredEvents = filteredEvents.filter(event => {
                    const eventDate = event.scheduledStartTimestamp ? new Date(event.scheduledStartTimestamp) : null;
                    return eventDate && eventDate.getDay() === dayIndex;
                });
            }

            if (userFilter) {
                filteredEvents = filteredEvents.filter(event => event.creatorId === userFilter);
            }

            if (!filteredEvents.size) {
                return interaction.editReply({
                    content: `No events found${dayFilter ? ` on ${dayFilter}` : ''}${userFilter ? ` hosted by <@${userFilter}>` : ''}.`,
                    ephemeral: true
                });
            }

            const eventList = filteredEvents.map(event => {
                const startTime = `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`;
                const hostMention = event.creatorId ? `<@${event.creatorId}>` : 'Unknown Host';
                return `**${event.name}**\n**Time:** ${startTime}\n**Hosted by:** ${hostMention}`;
            }).join('\n---\n');

            const embed = new EmbedBuilder()
                .setTitle('Event Schedule')
                .setDescription(eventList)
                .setColor('#0099ff')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error fetching event schedule:', error);
            if (!interaction.replied) {
                await interaction.editReply({
                    content: 'There was an error while fetching the event schedule. Please try again later.',
                    ephemeral: true
                });
            }
        }
    },
};

function getDayIndex(day) {
    const daysOfWeek = {
        'Sunday': 0,
        'Monday': 1,
        'Tuesday': 2,
        'Wednesday': 3,
        'Thursday': 4,
        'Friday': 5,
        'Saturday': 6
    };
    return daysOfWeek[day];
}
