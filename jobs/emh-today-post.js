'use strict';

// Daily at noon Chicago: one post in general chat listing the EMH sessions
// still to come today, each linked to its Discord event. Slots booked after
// the post still get the live invite the session manager posts once they start.

const moment = require('moment-timezone');
const store = require('../utils/emh_schedule_queries');
const { todayPost } = require('../utils/emh_events');
const { TIMEZONE } = require('../utils/emh_schedule');
const { GYM_CLASS_GENERAL_CHANNEL_ID } = require('../config/constants');
const logger = require('../utils/logger');

// ponytail: no record of having posted, so a restart inside the noon minute
// could post twice. Store a posted-on date if that ever happens.
const runEmhTodayPost = async (client, now = new Date()) => {
    try {
        const endOfDay = moment.tz(now, TIMEZONE).endOf('day').add(1, 'ms').toDate();
        const upcoming = (await store.listBookingsBetween(now, endOfDay))
            .filter((booking) => booking.status === 'scheduled');
        const content = todayPost(upcoming);
        if (!content) return 0;

        const general = await client.channels.fetch(GYM_CLASS_GENERAL_CHANNEL_ID);
        if (!general?.isTextBased?.()) return 0;
        // Hosts are shown, not pinged.
        await general.send({ content, allowedMentions: { parse: [] } });
        logger.info(`[EMH Today] Announced ${upcoming.length} session(s).`);
        return upcoming.length;
    } catch (error) {
        logger.error('[EMH Today] Could not post today\'s sessions:', error.message);
        return null;
    }
};

module.exports = { runEmhTodayPost };
