'use strict';

const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;

// Returns the guild member, or null when they are no longer in the guild,
// so application decisions can complete after an applicant leaves.
// Anything other than a departed-member error is rethrown.
const fetchApplicant = async (guild, userId) => {
    try {
        // force skips the member cache, which can hold departed members when
        // the bot missed or lacks the guild member remove gateway event.
        return await guild.members.fetch({ user: userId, force: true });
    } catch (error) {
        if (error && (error.code === UNKNOWN_MEMBER || error.code === UNKNOWN_USER)) {
            return null;
        }
        throw error;
    }
};

module.exports = { fetchApplicant };
