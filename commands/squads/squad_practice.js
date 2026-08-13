'use strict';

// Squad practices (rebuilt 2026-08, sub-project 2): sessions are rows in
// squad_practices, so reminders, starts, and cleanup survive restarts (the
// old version lost its 24h setTimeout on every deploy). The squad sweep job
// (jobs/squad-sweep.js) does all timing.

const {
    SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
    ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { SQUAD_PRACTICE_CHANNEL_ID } = require('../../config/constants');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

// The text channel practice threads are created under (pre-existing value).
const PRACTICE_PARENT_CHANNEL_ID = '1214781415670153266';
const MIN_SCHEDULE_MS = 10 * 60 * 1000;
const MAX_SCHEDULE_MS = 14 * 24 * 60 * 60 * 1000;

// '2h', '45m', '1d', '1h30m' -> ms within [10m, 14d]; null otherwise.
function parseDuration(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!/^(\d+d)?(\d+h)?(\d+m)?$/.test(s) || s === '') {
        return null;
    }
    const get = (unit) => Number((s.match(new RegExp(`(\\d+)${unit}`)) || [])[1] || 0);
    const ms = ((get('d') * 24 + get('h')) * 60 + get('m')) * 60 * 1000;
    return ms >= MIN_SCHEDULE_MS && ms <= MAX_SCHEDULE_MS ? ms : null;
}

// Pure RSVP card body.
function buildRsvpCardLines(practice, yes, no) {
    const ts = Math.floor(new Date(practice.scheduled_at).getTime() / 1000);
    return [
        `**When:** <t:${ts}:F> (<t:${ts}:R>)`,
        `**Yes (${yes.length}):** ${yes.length ? yes.map((r) => `<@${r.user_id}>`).join(' ') : 'nobody yet'}`,
        `**No (${no.length}):** ${no.length ? no.map((r) => `<@${r.user_id}>`).join(' ') : 'nobody yet'}`,
        '',
        'RSVP with the buttons below. Everyone who said Yes gets a reminder DM 15 minutes before start.',
    ];
}

function rsvpComponents(practiceId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`practice:rsvp:${practiceId}:Yes`).setLabel('Yes, I am in').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`practice:rsvp:${practiceId}:No`).setLabel('Cannot make it').setStyle(ButtonStyle.Secondary),
    );
}

function notice(title, lines) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${title}`),
        new TextDisplayBuilder().setContent(Array.isArray(lines) ? lines.join('\n') : lines)
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true };
}

// Creates the private practice thread and invites the roster. Returns the
// thread, or null when the parent channel is unavailable.
async function createPracticeThread(client, squad, members, { scheduled, practice }) {
    const channel = await client.channels.fetch(PRACTICE_PARENT_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        logger.error(`[Practice] Parent channel ${PRACTICE_PARENT_CHANNEL_ID} not found or not a text channel.`);
        return null;
    }
    const thread = await channel.threads.create({
        name: `${squad.name} Practice${scheduled ? ' (scheduled)' : ' Session'}`,
        autoArchiveDuration: 1440,
        type: ChannelType.PrivateThread,
        reason: `Practice for squad ${squad.name}`,
        invitable: false,
    });

    const container = new ContainerBuilder();
    const headline = scheduled
        ? buildRsvpCardLines(practice, [], [])
        : [`Practice is on now! Started by <@${squad.owner_id}>.`, 'This thread cleans itself up 24 hours after start.'];
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## [${squad.name}] Practice`),
        new TextDisplayBuilder().setContent(headline.join('\n'))
    );
    const payload = { flags: MessageFlags.IsComponentsV2, components: [container] };
    if (scheduled) {
        payload.components.push(rsvpComponents(practice.id));
    }
    const card = await thread.send(payload);

    for (const userId of [String(squad.owner_id), ...members.map((m) => String(m.user_id))]) {
        await thread.members.add(userId).catch(() => {});
    }
    return { thread, card };
}

module.exports = {
    parseDuration,
    buildRsvpCardLines,
    rsvpComponents,
    MIN_SCHEDULE_MS,
    MAX_SCHEDULE_MS,
    PRACTICE_PARENT_CHANNEL_ID,
    data: new SlashCommandBuilder()
        .setName('squad-practice')
        .setDescription('Run or schedule a squad practice session.')
        .addSubcommand((s) => s.setName('start').setDescription('Start a practice session right now'))
        .addSubcommand((s) => s.setName('schedule').setDescription('Schedule a practice with member RSVPs')
            .addStringOption((o) => o.setName('in').setDescription('How far out: 45m, 2h, 1h30m, 1d (max 14d)').setRequired(true).setMaxLength(10)))
        .addSubcommand((s) => s.setName('cancel').setDescription('Cancel your next scheduled practice')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.user.id;

        try {
            const ownedSquads = await squadDb.fetchSquadsByOwner(userId);
            const { squad, error } = squadDb.disambiguateOwnedSquad(ownedSquads, null);
            if (error) {
                return interaction.editReply(notice('Not a Squad Leader', 'You cannot manage practice sessions because you do not own a squad.'));
            }
            const sub = interaction.options.getSubcommand();
            const members = await squadDb.fetchSquadMembers(squad.id);

            if (sub === 'cancel') {
                const next = await squadDb.fetchNextScheduledPractice(squad.id);
                if (!next) {
                    return interaction.editReply(notice('Nothing Scheduled', 'Your squad has no scheduled practice to cancel.'));
                }
                const cancelled = await squadDb.claimPracticeCancel(next.id);
                if (!cancelled) {
                    return interaction.editReply(notice('Too Late', 'That practice already started or was cancelled.'));
                }
                if (cancelled.thread_id) {
                    const thread = await interaction.client.channels.fetch(cancelled.thread_id).catch(() => null);
                    if (thread) {
                        await thread.send({
                            ...notice('Practice Cancelled', `The scheduled practice was cancelled by <@${userId}>.`),
                            ephemeral: undefined,
                        }).catch(() => {});
                        await thread.setArchived(true).catch(() => {});
                    }
                }
                return interaction.editReply(notice('Practice Cancelled', 'Your scheduled practice was cancelled and the thread archived.'));
            }

            if (sub === 'schedule') {
                const durationMs = parseDuration(interaction.options.getString('in'));
                if (durationMs === null) {
                    return interaction.editReply(notice('Invalid Time', 'Use a duration like `45m`, `2h`, `1h30m`, or `1d` (minimum 10m, maximum 14d).'));
                }
                const existing = await squadDb.fetchNextScheduledPractice(squad.id);
                if (existing) {
                    return interaction.editReply(notice('Already Scheduled', 'Your squad already has a scheduled practice. Cancel it first with `/squad practice cancel`.'));
                }
                const scheduledAt = new Date(Date.now() + durationMs);
                const practice = await squadDb.insertPractice({ squadId: squad.id, scheduledAt, createdBy: userId });
                const created = await createPracticeThread(interaction.client, squad, members, { scheduled: true, practice });
                if (!created) {
                    await squadDb.claimPracticeCancel(practice.id).catch(() => {});
                    return interaction.editReply(notice('Channel Missing', 'Could not create the practice thread. Please contact an admin.'));
                }
                await squadDb.setPracticeThread(practice.id, created.thread.id, created.card.id);
                const ts = Math.floor(scheduledAt.getTime() / 1000);
                logger.info(`[Practice] Scheduled practice ${practice.id} for ${squad.name} at ${scheduledAt.toISOString()}`);
                return interaction.editReply(notice('Practice Scheduled', [
                    `Practice for **${squad.name}** is set for <t:${ts}:F> (<t:${ts}:R>).`,
                    `Your squad has been invited to ${created.thread} to RSVP.`,
                    'Yes-RSVPs get a reminder DM 15 minutes before start.',
                ]));
            }

            // start (immediate)
            const practice = await squadDb.insertPractice({ squadId: squad.id, scheduledAt: new Date(), createdBy: userId });
            await squadDb.setPracticeStatus(practice.id, 'Started');
            const created = await createPracticeThread(interaction.client, squad, members, { scheduled: false, practice });
            if (!created) {
                await squadDb.setPracticeStatus(practice.id, 'Cancelled');
                return interaction.editReply(notice('Channel Missing', 'Could not create the practice thread. Please contact an admin.'));
            }
            await squadDb.setPracticeThread(practice.id, created.thread.id, created.card.id);

            const logChannel = await interaction.client.channels.fetch(SQUAD_PRACTICE_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                await logChannel.send({
                    ...notice('Practice Started', `**${squad.name}** started a practice session (${members.length + 1} invited).`),
                    ephemeral: undefined,
                }).catch(() => {});
            }
            logger.info(`[Practice] Immediate practice ${practice.id} started for ${squad.name}`);
            return interaction.editReply(notice('Practice Started', [
                `Practice thread created for **${squad.name}**: ${created.thread}`,
                'The thread cleans itself up 24 hours after start.',
            ]));
        } catch (error) {
            logger.error(`[Practice] Error for ${userId}:`, error);
            return interaction.editReply(notice('Practice Failed', `An error occurred: ${error.message || 'Please try again later.'}`)).catch(() => {});
        }
    },
};
