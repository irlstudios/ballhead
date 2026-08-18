'use strict';

// The Report to Moderators button posted with every monitored room's consent
// notice. One click ships the last minute of room audio to the evidence
// channel for review. Per-user cooldown keeps mashing from spamming mods.

const { MessageFlags } = require('discord.js');
const { noticePayload } = require('../utils/ui');
const { postRoomReport } = require('../utils/voice_moderation/room_monitor');

const COOLDOWN_MS = 60 * 1000;
const lastReportAt = new Map();

// Pure cooldown decision, exported for tests.
const reportCooldownRemaining = (userId, nowMs, cooldowns = lastReportAt, cooldownMs = COOLDOWN_MS) => {
    const last = cooldowns.get(userId);
    if (last === undefined) return 0;
    return Math.max(0, last + cooldownMs - nowMs);
};

const ephemeral = (interaction, title, lines) => interaction.editReply({
    ...noticePayload(lines, { title, subtitle: 'Room Report' }),
});

const handleVoiceReport = async (interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const remaining = reportCooldownRemaining(interaction.user.id, Date.now());
    if (remaining > 0) {
        return ephemeral(interaction, 'Hold On', [
            `You reported recently. Try again in ${Math.ceil(remaining / 1000)}s.`,
        ]);
    }
    lastReportAt.set(interaction.user.id, Date.now());
    const result = await postRoomReport({
        client: interaction.client,
        channelId: interaction.channelId,
        reporterId: interaction.user.id,
    });
    if (!result.ok) {
        lastReportAt.delete(interaction.user.id);
        const reasons = {
            'not-monitored': 'This room is not being monitored right now, so there is no audio to send.',
            'no-audio': 'Nothing has been said in the last minute, so there is no audio to send.',
            'post-failed': 'Could not deliver the report. Staff have been notified through logs; please ping a moderator directly.',
        };
        return ephemeral(interaction, 'Report Not Sent', [reasons[result.reason] || reasons['post-failed']]);
    }
    return ephemeral(interaction, 'Report Sent', [
        'Moderators received the last minute of audio from this room. Thank you.',
    ]);
};

module.exports = { handleVoiceReport, reportCooldownRemaining };
