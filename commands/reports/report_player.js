const {SlashCommandBuilder} = require('@discordjs/builders');
const { AttachmentBuilder, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, FileBuilder, TextDisplayBuilder } = require('discord.js');

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) {
        parts.push(`## ${title}`);
    }
    if (subtitle) {
        parts.push(subtitle);
    }
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) {
            parts.push('');
        }
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) {
        return null;
    }
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}

function buildNoticeContainer({ title, subtitle, lines}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
            if (block) container.addTextDisplayComponents(block);
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report-player')
        .setDescription('Report a player who has broken the rules.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Username of the player to report')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('rule-broken')
                .setDescription('Describe the rule broken by the player')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('time-of-offense')
                .setDescription('Time of offense (e.g., 2025-03-10 14:30 UTC)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('lobby-name')
                .setDescription('Lobby name where the offense occurred')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('proof')
                .setDescription('(Optional) Provide a video of the user breaking the guidelines')
                .setRequired(false)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ephemeral: true});

            const reporter = interaction.user.tag;
            const reportedUser = interaction.options.getString('username');
            const ruleBroken = interaction.options.getString('rule-broken');
            const timeOfOffense = interaction.options.getString('time-of-offense');
            const lobbyName = interaction.options.getString('lobby-name');
            const proof = interaction.options.getAttachment('proof');

            const reportContainer = new ContainerBuilder();
            const reportLines = [
                `**Report From:** ${reporter}`,
                `**User Reported:** ${reportedUser}`,
                `**Rule Broken:** ${ruleBroken}`,
                `**Time of Offense:** ${timeOfOffense}`,
                `**Lobby Name:** ${lobbyName}`
            ];
            const block = buildTextBlock({
                title: `Player Report: ${reportedUser}`,
                subtitle: 'Submitted to Gym Class VR moderation',
                lines: reportLines
            });
            if (block) reportContainer.addTextDisplayComponents(block);

            const files = [];
            let fileComponent;
            if (proof) {
                const contentType = proof.contentType || '';
                if (contentType.startsWith('image/')) {
                    reportContainer.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(proof.url)
                    )
                );
            } else {
                    const proofAttachment = new AttachmentBuilder(proof.url, {name: proof.name});
                    files.push(proofAttachment);
                    fileComponent = new FileBuilder().setURL(`attachment://${proof.name}`);
                }
            }

            const forumChannel = interaction.guild.channels.cache.get('1139975178013655183');
            if (!forumChannel) {
                throw new Error('The forum channel for reports could not be found.');
            }

            await forumChannel.threads.create({
                name: `Report: ${reportedUser}`,
                message: {
                    flags: MessageFlags.IsComponentsV2,
                    components: fileComponent ? [reportContainer, fileComponent] : [reportContainer],
                    files: files.length > 0 ? files : undefined }
            });

            const successContainer = buildNoticeContainer({
                title: 'Report Submitted',
                subtitle: reportedUser,
                lines: ['Your report has been submitted successfully.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });
        } catch (error) {
            console.error('Error handling report submission:', error);
            const errorContainer = buildNoticeContainer({
                title: 'Report Failed',
                subtitle: 'Try Again Later',
                lines: ['There was an error while submitting your report. Please try again later.']
            });
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
