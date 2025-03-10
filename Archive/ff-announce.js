const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce-hosting')
        .setDescription('Announces a hosting event with a link to the detailed rules.')
        .addStringOption(option =>
            option.setName('ruleset')
                .setDescription('Select the ruleset for the hosting')
                .setRequired(true)
                .addChoices(
                    { name: 'FF Ruleset', value: 'FF' },
                    { name: 'Pro Circuit Ruleset', value: 'Pro Circuit' },
                    { name: 'Discord Ruleset', value: 'Discord' },
                    { name: 'Custom Ruleset', value: 'Custom' }
                ))
        .addStringOption(option =>
            option.setName('role')
                .setDescription('Select your hosting role')
                .setRequired(true)
                .addChoices(
                    { name: 'Prospect Official', value: 'Prospect Official' },
                    { name: 'Active Official', value: 'Active Official' },
                    { name: 'Senior Official', value: 'Senior Official' },
                    { name: 'FF Official', value: 'FF Official' },
                    { name: 'Senior FF Official', value: 'Senior FF Official' }
                )),

    async execute(interaction) {
        const allowedRoles = [
            '1286098187223957617',
            '1286098139513880648',
            '1286098091396698134',
            '1284249724513292350',
            '982875514874232832'
        ];

        const hasRole = allowedRoles.some(role => interaction.member.roles.cache.has(role));
        if (!hasRole) {
            return interaction.reply({
                content: 'You do not have the required role to use this command.',
                ephemeral: true
            });
        }

        const ruleset = interaction.options.getString('ruleset');
        const hostRole = interaction.options.getString('role');

        const rulesLinks = {
            'FF': 'https://discord.com/channels/752216589792706621/1286079900196798515',
            'Pro Circuit': 'https://discord.com/channels/752216589792706621/1286080189385670676',
            'Discord': 'https://discord.com/channels/752216589792706621/1286079497803792416',
            'Custom': 'Please check the custom rules documentation provided by the host.'
        };

        const rulesUrl = rulesLinks[ruleset];
        const rulesText = ruleset === 'Custom' ? rulesUrl : `[Click here to view the ${ruleset} rules](${rulesUrl})`;

        const announcementChannel = interaction.guild.channels.cache.get('987233054915428422');
        if (!announcementChannel || announcementChannel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: 'Error: Announcement channel not found!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`Hey all 👋 ${hostRole} ${interaction.user.username} is now hosting!`)
            .setDescription(`They are hosting games for the Official FF Tournament!\n\n**Ruleset:**\n${rulesText}`)
            .setTimestamp();

        await announcementChannel.send({ embeds: [embed] });
        await interaction.reply({ content: 'Hosting announcement made!', ephemeral: true });
    },
};
