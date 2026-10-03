'use strict';

// /emh: hosts book, move and cancel their own event slots for the current
// week; leads can move or cancel anyone's. Every rule lives in
// utils/emh_schedule.js and every query in utils/emh_schedule_queries.js; this
// file is only the Discord glue.

const { MessageFlags } = require('discord.js');
const { noticePayload } = require('../utils/ui');
const rules = require('../utils/emh_schedule');
const store = require('../utils/emh_schedule_queries');
const { renderMonthlyView } = require('../utils/emh_schedule_sheet');
const { HOST_ROLE_ID, EMH_LEAD_IDS } = require('../config/constants');
const logger = require('../utils/logger');

const SUBTITLE = 'EMH Schedule';

const reply = (interaction, title, lines) => interaction.reply({
    ...noticePayload(lines, { title, subtitle: SUBTITLE }),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
});

const isLead = (userId) => rules.isLead(userId, EMH_LEAD_IDS, process.env.BOT_OWNER_ID);

// Fire-and-forget: the booking is already saved, and renderMonthlyView logs its
// own failures, so the host's reply never waits on Google.
const redraw = () => {
    renderMonthlyView().catch((error) => logger.error('[EMH Schedule] Render failed:', error));
};

const conflictLines = (conflict) => [
    `${rules.rangeLabel(conflict)} on ${rules.dayLabel(conflict.startsAt)} is already booked by ${conflict.hostUsername}.`,
    'Run `/emh list` to see what is open this week.',
];

const handleSchedule = async (interaction) => {
    if (!interaction.member.roles.cache.has(HOST_ROLE_ID)) {
        return reply(interaction, 'Hosts Only', ['Only EMH hosts can book event slots.']);
    }
    const checked = rules.validateBooking({
        day: interaction.options.getString('day'),
        time: interaction.options.getString('time'),
        lengthMinutes: interaction.options.getInteger('length') ?? rules.DEFAULT_LENGTH,
    });
    if (!checked.ok) return reply(interaction, 'Cannot Book', [checked.reason]);

    const result = await store.createBooking({
        hostId: interaction.user.id,
        hostUsername: interaction.user.username,
        startsAt: checked.startsAt,
        endsAt: checked.endsAt,
        createdBy: interaction.user.id,
    });
    if (result.conflict) return reply(interaction, 'Time Taken', conflictLines(result.conflict));
    redraw();
    return reply(interaction, 'Slot Booked', [
        `You are booked for **${rules.slotLabel(result.booking)}** (Central time).`,
        'Need to move it? Use `/emh reschedule`. Can\'t make it? Use `/emh cancel`.',
    ]);
};

// The slot option is autocomplete, but the value is still free text, so the
// owner check here is the real gate.
const resolveSlot = async (interaction) => {
    const id = Number.parseInt(interaction.options.getString('slot'), 10);
    const booking = Number.isInteger(id) ? await store.getBooking(id) : null;
    if (!booking || booking.status !== 'scheduled') {
        await reply(interaction, 'Slot Not Found', ['That slot is not an upcoming booking. Pick one from the list.']);
        return null;
    }
    if (booking.hostId !== interaction.user.id && !isLead(interaction.user.id)) {
        await reply(interaction, 'Not Your Slot', ['You can only change your own bookings.']);
        return null;
    }
    return booking;
};

const handleReschedule = async (interaction) => {
    const booking = await resolveSlot(interaction);
    if (!booking) return null;
    const checked = rules.validateBooking({
        day: interaction.options.getString('day'),
        time: interaction.options.getString('time'),
        lengthMinutes: interaction.options.getInteger('length') ?? rules.slotMinutes(booking),
    });
    if (!checked.ok) return reply(interaction, 'Cannot Move', [checked.reason]);

    const result = await store.rescheduleBooking({ id: booking.id, startsAt: checked.startsAt, endsAt: checked.endsAt });
    if (result.missing) return reply(interaction, 'Slot Not Found', ['That slot was cancelled or already resolved.']);
    if (result.conflict) {
        return reply(interaction, 'Time Taken', [...conflictLines(result.conflict), `Your ${rules.slotLabel(booking)} booking is unchanged.`]);
    }
    redraw();
    return reply(interaction, 'Slot Moved', [`**${rules.slotLabel(booking)}** moved to **${rules.slotLabel(result.booking)}**.`]);
};

const handleCancel = async (interaction) => {
    const booking = await resolveSlot(interaction);
    if (!booking) return null;
    const cancelled = await store.cancelBooking({ id: booking.id, cancelledBy: interaction.user.id });
    if (!cancelled) return reply(interaction, 'Slot Not Found', ['That slot was cancelled or already resolved.']);
    redraw();
    return reply(interaction, 'Slot Cancelled', [`**${rules.slotLabel(booking)}** (${booking.hostUsername}) is cancelled and the time is open again.`]);
};

const handleList = async (interaction) => {
    const week = rules.weekBounds();
    const bookings = (await store.listBookingsBetween(week.startInstant, week.endInstant))
        .filter((booking) => booking.status !== 'cancelled');
    if (bookings.length === 0) {
        return reply(interaction, 'This Week', ['No slots are booked yet this week. Every time is open.']);
    }
    const lines = bookings.flatMap((booking, index) => {
        const day = rules.dayLabel(booking.startsAt);
        const heading = index === 0 || rules.dayLabel(bookings[index - 1].startsAt) !== day ? [`**${day}**`] : [];
        return [...heading, `- ${rules.rangeLabel(booking)} ${booking.hostUsername}`];
    });
    return reply(interaction, 'This Week', lines);
};

const HANDLERS = {
    schedule: handleSchedule,
    reschedule: handleReschedule,
    cancel: handleCancel,
    list: handleList,
};

const execute = async (interaction) => {
    const handler = HANDLERS[interaction.options.getSubcommand()];
    try {
        await handler(interaction);
    } catch (error) {
        logger.error('[EMH Schedule] Command failed:', error);
        if (!interaction.replied && !interaction.deferred) {
            await reply(interaction, 'Something Went Wrong', ['Your booking was not changed. Try again in a minute.']).catch(() => {});
        }
    }
};

const autocomplete = async (interaction) => {
    try {
        const focused = interaction.options.getFocused(true);
        const typed = String(focused.value || '').toLowerCase();
        if (focused.name === 'day') {
            const days = rules.bookableDays().filter((day) => day.label.toLowerCase().includes(typed));
            return interaction.respond(days.map((day) => ({ name: day.label, value: day.value })));
        }
        if (focused.name === 'slot') {
            const lead = isLead(interaction.user.id);
            const bookings = await store.listUpcomingBookings({ hostId: lead ? null : interaction.user.id });
            return interaction.respond(bookings.map((booking) => ({
                name: (lead ? `${rules.slotLabel(booking)} - ${booking.hostUsername}` : rules.slotLabel(booking)).slice(0, 100),
                value: String(booking.id),
            })));
        }
        return interaction.respond([]);
    } catch (error) {
        logger.error('[EMH Schedule] Autocomplete failed:', error);
        return null;
    }
};

module.exports = { execute, autocomplete };
