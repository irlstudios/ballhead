const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags, TextDisplayBuilder } = require('discord.js');
const { getCacheStats, clearCache } = require('../../utils/sheets_cache');

// Admin role IDs who can clear cache
const ADMIN_ROLES = [
    '805833778064130104',
    '939634611909185646',
    '1258042039895986249'
];

function isAdmin(member) {
    if (!member || !member.roles) return false;
    return ADMIN_ROLES.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cache-stats')
        .setDescription('View Google Sheets cache statistics')
        .addBooleanOption(option =>
            option.setName('clear')
                .setDescription('(Admin only) Clear the cache to force fresh data fetch')
                .setRequired(false)
        ),
    async execute(interaction) {
        try {
            const shouldClear = interaction.options.getBoolean('clear') || false;

            // Check admin permission if trying to clear
            if (shouldClear && !isAdmin(interaction.member)) {
                await interaction.reply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        new TextDisplayBuilder().setContent('## Access Denied'),
                        new TextDisplayBuilder().setContent('You do not have permission to clear the cache.')
                    ],
                    ephemeral: true
                });
                return;
            }

            // Clear cache if requested
            if (shouldClear) {
                clearCache();
            }

            const stats = getCacheStats();

            const statsLines = [
                `**Cache Hit Rate:** ${stats.hitRate}`,
                `**Cache Hits:** ${stats.hits}`,
                `**Cache Misses:** ${stats.misses}`,
                `**API Calls:** ${stats.apiCalls}`,
                `**Avg API Time:** ${stats.avgApiTime}`,
                `**Cache Size:** ${stats.cacheSize} ranges`,
                `**Uptime:** ${stats.uptime}`
            ];

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    new TextDisplayBuilder().setContent('## Cache Statistics'),
                    new TextDisplayBuilder().setContent(statsLines.join('\n')),
                    new TextDisplayBuilder().setContent(`-# ${shouldClear ? 'Cache cleared' : 'Cache warming every 15 minutes'}`)
                ],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error in cache-stats command:', error);
            await interaction.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    new TextDisplayBuilder().setContent('## Cache Stats Failed'),
                    new TextDisplayBuilder().setContent('An error occurred while fetching cache statistics.')
                ],
                ephemeral: true
            });
        }
    }
};
