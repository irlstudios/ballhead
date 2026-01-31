const { SlashCommandBuilder, ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');

// Authorized role IDs
const AUTHORIZED_ROLES = [
    '909227142808756264',
    '805833778064130104',
    '939634611909185646',
    '1150196818475491419',
];

const scheduledResets = new Map();

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
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Access Denied\nYou do not have permission to use this command.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        // Ensure the command runs in a guild text-based channel that supports slowmode
        const channel = interaction.channel;
        if (!channel || interaction.guildId == null) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Server Only\nThis command can only be used in a server channel.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        // Check capability: setRateLimitPerUser is available on text-based guild channels (not DMs)
        if (typeof channel.setRateLimitPerUser !== 'function') {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Unsupported Channel\nThis channel type does not support cooldown (slowmode).'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        const cooldownSeconds = interaction.options.getInteger('cooldown', true);
        const lengthInput = interaction.options.getString('length', true);
        const durationMs = parseDuration(lengthInput);
        if (durationMs == null) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Invalid Length\nInvalid length. Use formats like 30m, 1h, or 1d.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        try {
            await channel.setRateLimitPerUser(cooldownSeconds, `Set by ${interaction.user.tag} via /set_cooldown for ${lengthInput}`);

            // Clear any existing scheduled reset for this channel
            const previous = scheduledResets.get(channel.id);
            if (previous?.timeout) clearTimeout(previous.timeout);

            const expiresAt = Date.now() + durationMs;
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
            scheduledResets.set(channel.id, { timeout, expiresAt, cooldownSeconds, appliedBy: interaction.user.id });

            const title = previous ? 'Channel Cooldown Updated' : 'Channel Cooldown Set';
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `## ${title}\n**Cooldown:** ${cooldownSeconds} seconds\n**Length:** ${lengthInput}\n**Expires:** <t:${Math.floor(expiresAt / 1000)}:R>`
                ));

            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });

            // Log this action to the specified log channel
            try {
                const logChannelId = '834246361716883466';
                const logChannel = await interaction.client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel && typeof logChannel.send === 'function') {
                    const expiresUnix = Math.floor(expiresAt / 1000);
                    const logTitle = previous ? 'Cooldown Updated' : 'Cooldown Applied';
                    let logLines = [
                        `**Channel:** <#${channel.id}>`,
                        `**Cooldown:** ${cooldownSeconds} seconds`,
                        `**Applied By:** <@${interaction.user.id}>`,
                        `**Expires:** <t:${expiresUnix}:R> (<t:${expiresUnix}:F>)`
                    ];
                    if (previous?.expiresAt) {
                        const prevUnix = Math.floor(previous.expiresAt / 1000);
                        logLines.push(`**Previous Expires:** <t:${prevUnix}:R> (<t:${prevUnix}:F>)`);
                    }
                    const logContainer = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${logTitle}\n${logLines.join('\n')}`));
                    await logChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
                }
            } catch (logErr) {
                console.error('Failed to log cooldown action:', logErr?.message || logErr);
            }
        } catch (error) {
            console.error('Error setting channel slowmode:', error);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Cooldown Failed\nFailed to set cooldown. Ensure I have permission to manage this channel.'));
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }
    },
};
