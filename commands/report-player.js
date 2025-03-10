const {SlashCommandBuilder} = require('@discordjs/builders');
const {EmbedBuilder, AttachmentBuilder} = require('discord.js');

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
        .addAttachmentOption(option =>
            option.setName('proof')
                .setDescription('Attach proof (video/image) of the rule-breaking')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ephemeral: true});

            const reporter = interaction.user.tag;
            const reportedUser = interaction.options.getString('username');
            const ruleBroken = interaction.options.getString('rule-broken');
            const proof = interaction.options.getAttachment('proof');

            const reportEmbed = new EmbedBuilder()
                .setTitle(`Report: ${reportedUser}`)
                .setDescription(`**Report From:** ${reporter}\n\n**User who broke the guidelines:** ${reportedUser}\n\n**Rule broken by user(s):** ${ruleBroken}`)
                .setColor(0xff0000)
                .setTimestamp()
                .setFooter({text: 'Player Report'});

            const files = [];
            if (proof) {
                if (proof.contentType.startsWith('image/')) {
                    reportEmbed.setImage(proof.url);
                } else {
                    const proofAttachment = new AttachmentBuilder(proof.url, {name: proof.name});
                    files.push(proofAttachment);
                }
            }

            const forumChannel = interaction.guild.channels.cache.get('1139975178013655183');
            if (!forumChannel) {
                throw new Error('The forum channel for reports could not be found.');
            }

            await forumChannel.threads.create({
                name: `Report: ${reportedUser}`,
                message: {
                    embeds: [reportEmbed],
                    files: files.length > 0 ? files : undefined,
                }
            });

            await interaction.editReply({content: 'Your report has been submitted successfully.', ephemeral: true});
        } catch (error) {
            console.error('Error handling report submission:', error);
            await interaction.editReply({
                content: 'There was an error while submitting your report. Please try again later.',
                ephemeral: true,
            });
        }
    }
}
