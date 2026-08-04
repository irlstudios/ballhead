const { SlashCommandBuilder } = require('@discordjs/builders');
const logger = require('../../utils/logger');
const { MOD_PING_ROLES } = require('../../config/constants');
const {
    subscribeToModPings,
    unsubscribeFromModPings,
    listModPingSubscriptions,
} = require('../../utils/mod_ping_queries');

const ALL_CHOICE = 'all';
const roleChoices = [
    ...MOD_PING_ROLES.map(({ name, id }) => ({ name, value: id })),
    { name: 'All mod roles', value: ALL_CHOICE },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mod-pings')
        .setDescription('Subscribe to DMs when other mod roles get pinged')
        .addSubcommand((sub) => sub
            .setName('subscribe')
            .setDescription('Get a DM when a mod role you do not hold is pinged')
            .addStringOption((option) => option
                .setName('role')
                .setDescription('The mod role to subscribe to')
                .setRequired(true)
                .addChoices(...roleChoices)))
        .addSubcommand((sub) => sub
            .setName('unsubscribe')
            .setDescription('Stop DMs for a mod role')
            .addStringOption((option) => option
                .setName('role')
                .setDescription('The mod role to unsubscribe from')
                .setRequired(true)
                .addChoices(...roleChoices)))
        .addSubcommand((sub) => sub
            .setName('list')
            .setDescription('Show your mod ping subscriptions')),
    async execute(interaction) {
        try {
            const isMod = MOD_PING_ROLES.some(({ id }) => interaction.member.roles.cache.has(id));
            if (!isMod) {
                return interaction.reply({
                    content: 'You do not have the required role to use this command.',
                    ephemeral: true,
                });
            }

            const subcommand = interaction.options.getSubcommand();
            const userId = interaction.user.id;

            if (subcommand === 'list') {
                const roleIds = await listModPingSubscriptions(userId);
                const names = roleIds
                    .map((id) => MOD_PING_ROLES.find((role) => role.id === id)?.name)
                    .filter(Boolean);
                return interaction.reply({
                    content: names.length > 0
                        ? `You are subscribed to: ${names.join(', ')}`
                        : 'You have no mod ping subscriptions.',
                    ephemeral: true,
                });
            }

            const choice = interaction.options.getString('role');
            const roleIds = choice === ALL_CHOICE
                ? MOD_PING_ROLES.map(({ id }) => id)
                : [choice];
            const label = choice === ALL_CHOICE
                ? 'all mod roles'
                : MOD_PING_ROLES.find((role) => role.id === choice).name;

            if (subcommand === 'subscribe') {
                await subscribeToModPings(userId, roleIds);
                return interaction.reply({
                    content: `Subscribed to pings for ${label}. You will be DMed unless you hold the pinged role.`,
                    ephemeral: true,
                });
            }

            await unsubscribeFromModPings(userId, roleIds);
            return interaction.reply({
                content: `Unsubscribed from pings for ${label}.`,
                ephemeral: true,
            });
        } catch (error) {
            logger.error('[ModPings] Command failed:', error);
            if (!interaction.replied) {
                await interaction.reply({
                    content: 'An error occurred while processing your request.',
                    ephemeral: true,
                }).catch(() => {});
            }
        }
    },
};
