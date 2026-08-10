'use strict';

// /room event clip and /room event monitor: incident evidence capture for EMH
// sessions. Kept out of room_commands.js (file-size ceiling) and room_event.js
// (start/status flow), same precedent as that split.

const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, ContainerBuilder, FileBuilder, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { buildTextBlock } = require('../utils/ui');
const { getSessionByChannel } = require('../utils/host_session_manager');
const { clipFromCapture } = require('../utils/voice_moderation/clipper');
const { insertIncident } = require('../utils/voice_moderation/incidents');
const { startMonitoring, stopMonitoring, isMonitoring } = require('../utils/voice_moderation/transcriber');
const {
    MODERATOR_ROLES, VOICE_EVIDENCE_CHANNEL_ID,
    VOICE_CLIP_DEFAULT_SECONDS, VOICE_CLIP_MIN_SECONDS, VOICE_CLIP_MAX_SECONDS,
} = require('../config/constants');

const isModerator = (callerRoleIds) => MODERATOR_ROLES.some((roleId) => callerRoleIds.includes(roleId));

const canUseClip = ({ callerId, callerRoleIds, session }) =>
    callerId === session.hostId || isModerator(callerRoleIds);

const notice = (interaction, body) => {
    const container = new ContainerBuilder();
    const block = buildTextBlock(body);
    if (block) container.addTextDisplayComponents(block);
    return interaction.deferred
        ? interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] })
        : interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
        });
};

// Mods may aim at any session channel; everyone else clips the room they are in.
const resolveTargetSession = (interaction) => {
    const callerRoleIds = [...interaction.member.roles.cache.keys()];
    const explicit = interaction.options.getChannel('channel');
    const channelId = (explicit && isModerator(callerRoleIds)) ? explicit.id : interaction.member.voice.channelId;
    if (!channelId) return { session: null, reason: 'Join the event lobby (or pass the channel option as a moderator) first.' };
    const session = getSessionByChannel(channelId);
    if (!session) return { session: null, reason: 'That channel has no live event session.' };
    return { session, reason: null };
};

const clipFileName = (sessionId, endMs) =>
    `incident-session${sessionId}-${new Date(endMs).toISOString().replace(/[:.]/g, '-')}.wav`;

const FALLBACK_DIR = path.join(__dirname, '..', 'logs', 'voice_clips');

const saveFallback = (fileName, wav) => {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    const fullPath = path.join(FALLBACK_DIR, fileName);
    fs.writeFileSync(fullPath, wav);
    return fullPath;
};

const handleRoomEventClip = async (interaction) => {
    const subtitle = 'Incident Clip';
    const { session, reason } = resolveTargetSession(interaction);
    if (!session) {
        return notice(interaction, { title: 'No Session', subtitle, lines: [reason] });
    }
    const callerRoleIds = [...interaction.member.roles.cache.keys()];
    if (!canUseClip({ callerId: interaction.user.id, callerRoleIds, session })) {
        return notice(interaction, {
            title: 'Access Denied', subtitle,
            lines: ['Only the session host or moderators can capture an incident clip.'],
        });
    }
    const durationSeconds = Math.min(
        VOICE_CLIP_MAX_SECONDS,
        Math.max(VOICE_CLIP_MIN_SECONDS, interaction.options.getInteger('duration') || VOICE_CLIP_DEFAULT_SECONDS)
    );
    const note = interaction.options.getString('note') || null;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const clip = clipFromCapture({ channelId: session.channelId, durationSeconds });
    if (!clip) {
        return notice(interaction, {
            title: 'Nothing To Clip', subtitle,
            lines: [`No audio was captured in the last ${durationSeconds} seconds of that lobby.`],
        });
    }

    const fileName = clipFileName(session.id, clip.windowEndMs);
    const evidence = {
        title: 'Voice Incident Captured',
        subtitle: `EMH session ${session.id}`,
        lines: [
            `Captured by <@${interaction.user.id}> from <#${session.channelId}> (host <@${session.hostId}>).`,
            `Window: <t:${Math.floor(clip.windowStartMs / 1000)}:T> to <t:${Math.floor(clip.windowEndMs / 1000)}:T> (${durationSeconds}s).`,
            `Speakers in window: ${clip.participantIds.map((id) => `<@${id}>`).join(', ')}.`,
            note ? `Note: ${note}` : null,
        ],
    };

    let messageUrl = null;
    try {
        const evidenceChannel = await interaction.client.channels.fetch(VOICE_EVIDENCE_CHANNEL_ID);
        const container = new ContainerBuilder().setAccentColor(0xDC2626);
        const block = buildTextBlock(evidence);
        if (block) container.addTextDisplayComponents(block);
        // Components V2 hides raw attachments; the File component is what
        // renders the WAV in the message.
        container.addFileComponents(new FileBuilder().setURL(`attachment://${fileName}`));
        const sent = await evidenceChannel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            files: [new AttachmentBuilder(clip.wav, { name: fileName })],
            // The note is host-supplied free text; it must never ping through the bot.
            allowedMentions: { parse: [] },
        });
        messageUrl = sent.url;
    } catch (error) {
        const savedTo = saveFallback(fileName, clip.wav);
        logger.error(`[Voice Mod] Evidence upload failed; clip preserved at ${savedTo}:`, error);
    }

    try {
        await insertIncident({
            sessionId: session.id,
            channelId: session.channelId,
            clippedBy: interaction.user.id,
            note,
            windowStart: new Date(clip.windowStartMs),
            windowEnd: new Date(clip.windowEndMs),
            participantIds: clip.participantIds,
            evidenceMessageUrl: messageUrl,
        });
    } catch (error) {
        logger.error('[Voice Mod] Failed to record incident row:', error);
    }

    return notice(interaction, {
        title: messageUrl ? 'Clip Captured' : 'Clip Captured (Upload Failed)',
        subtitle,
        lines: [
            messageUrl
                ? `The last ${durationSeconds}s were posted to the evidence channel.`
                : 'Upload failed; the clip is preserved on the host machine and logged. Ping staff to retrieve it.',
        ],
    });
};

const handleRoomEventMonitor = async (interaction) => {
    const subtitle = 'Live Monitor';
    const callerRoleIds = [...interaction.member.roles.cache.keys()];
    if (!isModerator(callerRoleIds)) {
        return notice(interaction, {
            title: 'Access Denied', subtitle,
            lines: ['Only moderators can run live monitoring.'],
        });
    }
    const explicit = interaction.options.getChannel('channel');
    const channelId = explicit?.id || interaction.member.voice.channelId;
    if (!channelId) {
        return notice(interaction, {
            title: 'Channel Required', subtitle,
            lines: ['Join the session channel or pass the channel option.'],
        });
    }
    const action = interaction.options.getString('action');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (action === 'stop') {
        if (!isMonitoring(channelId)) {
            return notice(interaction, { title: 'Not Monitoring', subtitle, lines: ['That channel is not being monitored.'] });
        }
        await stopMonitoring(channelId);
        return notice(interaction, { title: 'Monitoring Stopped', subtitle, lines: ['The transcript thread has been closed out.'] });
    }

    const result = await startMonitoring({ client: interaction.client, channelId, startedById: interaction.user.id });
    if (!result.ok) {
        const reasons = {
            unconfigured: 'Live transcription is not configured (missing DEEPGRAM_API_KEY). Incident clipping still works.',
            'no-session': 'That channel has no live event session.',
            'already-monitoring': 'That channel is already being monitored.',
        };
        return notice(interaction, { title: 'Cannot Start', subtitle, lines: [reasons[result.reason]] });
    }
    return notice(interaction, {
        title: 'Monitoring Started', subtitle,
        lines: [`Live transcript: ${result.threadUrl}`, 'Stop it with `/room event monitor action:stop`.'],
    });
};

module.exports = { isModerator, canUseClip, handleRoomEventClip, handleRoomEventMonitor };
