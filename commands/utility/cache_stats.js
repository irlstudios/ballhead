const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
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
                    content: 'You don\'t have permission to clear the cache.',
                    ephemeral: true
                });
                return;
            }

            // Clear cache if requested
            if (shouldClear) {
                clearCache();
            }

            const stats = getCacheStats();

            const embed = new EmbedBuilder()
                .setTitle('📊 Google Sheets Cache Statistics')
                .setColor(shouldClear ? '#ff9900' : '#00ff00')
                .addFields(
                    { name: '🎯 Cache Hit Rate', value: stats.hitRate, inline: true },
                    { name: '✅ Cache Hits', value: stats.hits.toString(), inline: true },
                    { name: '❌ Cache Misses', value: stats.misses.toString(), inline: true },
                    { name: '🌐 API Calls', value: stats.apiCalls.toString(), inline: true },
                    { name: '⚡ Avg API Time', value: stats.avgApiTime, inline: true },
                    { name: '💾 Cache Size', value: `${stats.cacheSize} ranges`, inline: true },
                    { name: '⏱️ Uptime', value: stats.uptime, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: shouldClear ? 'Cache cleared!' : 'Cache warming runs every 15 minutes' });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error in cache-stats command:', error);
            await interaction.reply({
                content: 'An error occurred while fetching cache statistics.',
                ephemeral: true
            });
        }
    }
};
