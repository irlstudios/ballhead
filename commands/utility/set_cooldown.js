const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');

// Authorized role IDs
const AUTHORIZED_ROLES = [
    '909227142808756264',
    '805833778064130104',
    '939634611909185646',
    '1150196818475491419',
];

// Track scheduled resets per-channel so newer schedules replace older ones
const scheduledResets = new Map(); // channelId -> Timeout

/**
 * Parse duration strings like `30m`, `1h`, `1d`, `45s` into milliseconds
 * @param {string} input
 * @returns {number|null} milliseconds or null if invalid
 */
function parseDuration(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim().toLowerCase();
    const match = trimmed.match(/^(\d+)\s*([smhd])$/); // seconds, minutes, hours, days
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unitMs = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
    }[unit];
    return amount * unitMs;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set_cooldown')
        .setDescription('Set the channel slowmode (cooldown) for a limited time in this channel')
        .addIntegerOption(opt =>
            opt.setName('cooldown')
                .setDescription('Slowmode per-user delay')
                .setRequired(true)
                .addChoices(
                    { name: '5 Seconds', value: 5 },
                    { name: '10 Seconds', value: 10 },
                    { name: '15 Seconds', value: 15 },
                    { name: '30 Seconds', value: 30 },
                    { name: '1 Minute', value: 60 },
                )
        )
        .addStringOption(opt =>
            opt.setName('length')
                .setDescription('How long to keep the cooldown active (e.g., 30m, 1h, 1d)')
                .setRequired(true)
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        // Role authorization
        const hasRole = interaction.member?.roles?.cache?.some(r => AUTHORIZED_ROLES.includes(r.id));
        if (!hasRole) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        // Ensure the command runs in a guild text-based channel that supports slowmode
        const channel = interaction.channel;
        if (!channel || interaction.guildId == null) {
            return interaction.reply({ content: 'This command can only be used in a server channel.', ephemeral: true });
        }

        // Check capability: setRateLimitPerUser is available on text-based guild channels (not DMs)
        if (typeof channel.setRateLimitPerUser !== 'function') {
            return interaction.reply({ content: 'This channel type does not support cooldown (slowmode).', ephemeral: true });
        }

        const cooldownSeconds = interaction.options.getInteger('cooldown', true);
        const lengthInput = interaction.options.getString('length', true);
        const durationMs = parseDuration(lengthInput);
        if (durationMs == null) {
            return interaction.reply({ content: 'Invalid length. Use formats like 30m, 1h, or 1d.', ephemeral: true });
        }

        try {
            await channel.setRateLimitPerUser(cooldownSeconds, `Set by ${interaction.user.tag} via /set_cooldown for ${lengthInput}`);

            // Clear any existing scheduled reset for this channel
            const previous = scheduledResets.get(channel.id);
            if (previous) clearTimeout(previous);

            const timeout = setTimeout(async () => {
                try {
                    await channel.setRateLimitPerUser(0, 'Automatic reset after scheduled cooldown length');
                } catch (err) {
                    // Swallow errors silently but could be logged to a central channel if desired
                    console.error('Failed to reset slowmode:', err?.message || err);
                } finally {
                    scheduledResets.delete(channel.id);
                }
            }, durationMs);
            scheduledResets.set(channel.id, timeout);

            const embed = new EmbedBuilder()
                .setTitle('Channel Cooldown Set')
                .setDescription(`Slowmode updated for <#${channel.id}>`)
                .addFields(
                    { name: 'Cooldown', value: `${cooldownSeconds} seconds`, inline: true },
                    { name: 'Length', value: lengthInput, inline: true },
                )
                .setColor(0x2ECC71);

            await interaction.reply({ embeds: [embed], ephemeral: true });

            // Log this action to the specified log channel
            try {
                const logChannelId = '834246361716883466';
                const logChannel = await interaction.client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel && typeof logChannel.send === 'function') {
                    const expiresAt = Date.now() + durationMs;
                    const expiresUnix = Math.floor(expiresAt / 1000);
                    const logEmbed = new EmbedBuilder()
                        .setTitle('Cooldown Applied')
                        .setColor(0x3498DB)
                        .setDescription('A channel cooldown has been applied.')
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Cooldown', value: `${cooldownSeconds} seconds`, inline: true },
                            { name: 'Applied By', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Expires', value: `<t:${expiresUnix}:R> (<t:${expiresUnix}:F>)`, inline: false },
                        )
                        .setTimestamp(new Date(expiresAt));
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (logErr) {
                console.error('Failed to log cooldown action:', logErr?.message || logErr);
            }
        } catch (error) {
            console.error('Error setting channel slowmode:', error);
            return interaction.reply({ content: 'Failed to set cooldown. Ensure I have permission to manage this channel.', ephemeral: true });
        }
    },
};
