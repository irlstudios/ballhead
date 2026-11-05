'use strict';

// Mirrors EMH bookings as Discord server events, and builds the daily
// "EMH sessions today" post. The point is to get people into the GC Activity:
// Paul's goal for EMH is as many players in GC Activity games as possible.
//
// Every change goes through reconcileBookingEvent, which re-reads the booking
// and makes Discord match it: a scheduled slot has exactly one event on its
// times, anything else has none. Calls for the same booking run one at a time,
// so a book followed by a quick cancel or reschedule cannot orphan an event.
// The bot runs as a single process, so an in-memory lock is enough.
// Discord work is best effort and never throws: a booking is already saved
// before any of this runs.

const { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, RESTJSONErrorCodes } = require('discord.js');
const store = require('./emh_schedule_queries');
const { formatTime } = require('./emh_schedule');
const { GYM_CLASS_GUILD_ID } = require('../config/constants');
const logger = require('./logger');

const NAME_LIMIT = 100;
// Keeps the noon post under Discord's 2000 character message limit.
const POST_SLOT_LIMIT = 12;
const LOCATION = 'The host\'s EMH voice room - GC Activity';
const DESCRIPTION = [
    'An EMH host is running Gym Class games for everyone in the GC Activity.',
    'When it starts, join the host\'s voice room, open Activities and pick Gym Class.',
    'Games include Doodle Judge, Chess Club and more.',
].join('\n');

const eventName = (hostUsername) => `${hostUsername} hosts GC games`.slice(0, NAME_LIMIT);

const eventPayload = (booking) => ({
    name: eventName(booking.hostUsername),
    scheduledStartTime: new Date(booking.startsAt),
    scheduledEndTime: new Date(booking.endsAt),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location: LOCATION },
    description: DESCRIPTION,
});

const eventUrl = (eventId) => `https://discord.com/events/${GYM_CLASS_GUILD_ID}/${eventId}`;

const slotLine = (booking) => {
    const link = booking.eventId ? ` - [event](${eventUrl(booking.eventId)})` : '';
    return `- ${formatTime(booking.startsAt)} <@${booking.hostId}>${link}`;
};

// Returns the message text, or null when there is nothing to announce.
const todayPost = (bookings) => {
    if (bookings.length === 0) return null;
    const ordered = [...bookings].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    const shown = ordered.slice(0, POST_SLOT_LIMIT);
    const more = ordered.length - shown.length;
    return [
        '**EMH sessions today** - come play Gym Class games together in the GC Activity.',
        ...shown.map(slotLine),
        ...(more > 0 ? [`- and ${more} more. Run \`/emh list\` to see them all.`] : []),
        'Times are Central. When a session starts, join the host\'s voice room, open Activities and pick Gym Class.',
    ].join('\n');
};

const isUnknownEvent = (error) => error?.code === RESTJSONErrorCodes.UnknownGuildScheduledEvent;

// One promise chain per booking id; each call waits for the one before it.
const chains = new Map();
const withBookingLock = (id, task) => {
    const previous = chains.get(id) || Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => {});
    chains.set(id, tail);
    tail.then(() => {
        if (chains.get(id) === tail) chains.delete(id);
    });
    return run;
};

// Returns true when the event is gone (deleted now or already missing).
const deleteEvent = async (guild, booking) => {
    try {
        await guild.scheduledEvents.delete(booking.eventId);
        return true;
    } catch (error) {
        if (isUnknownEvent(error)) return true;
        logger.warn(`[EMH Events] Could not delete event ${booking.eventId} for slot ${booking.id}:`, error.message);
        return false;
    }
};

const createEvent = async (guild, booking) => {
    const created = await guild.scheduledEvents.create(eventPayload(booking));
    try {
        await store.setBookingEventId(booking.id, created.id);
        return created.id;
    } catch (error) {
        // Without a stored id nothing could ever remove this event.
        await guild.scheduledEvents.delete(created.id).catch(() => {});
        throw error;
    }
};

// Returns true when the event exists on the slot's times. Only a missing event
// is recreated; any other failure keeps the id so the next sync can retry
// instead of leaving the old event behind as a duplicate.
const moveEvent = async (guild, booking) => {
    try {
        const { scheduledStartTime, scheduledEndTime } = eventPayload(booking);
        await guild.scheduledEvents.edit(booking.eventId, { scheduledStartTime, scheduledEndTime });
        return true;
    } catch (error) {
        if (isUnknownEvent(error)) return false;
        logger.warn(`[EMH Events] Could not move event ${booking.eventId} for slot ${booking.id}:`, error.message);
        return true;
    }
};

const reconcile = async (client, bookingId) => {
    const booking = await store.getBooking(bookingId);
    if (!booking) return null;
    const guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);

    if (booking.status !== 'scheduled') {
        if (booking.eventId && (await deleteEvent(guild, booking))) {
            await store.setBookingEventId(booking.id, null);
        }
        return null;
    }
    if (booking.eventId && (await moveEvent(guild, booking))) return booking.eventId;
    return createEvent(guild, booking);
};

const reconcileBookingEvent = (client, bookingId) => withBookingLock(bookingId, async () => {
    try {
        return await reconcile(client, bookingId);
    } catch (error) {
        logger.error(`[EMH Events] Could not sync the event for slot ${bookingId}:`, error.message);
        return null;
    }
});

module.exports = { eventPayload, eventUrl, todayPost, reconcileBookingEvent, POST_SLOT_LIMIT };
