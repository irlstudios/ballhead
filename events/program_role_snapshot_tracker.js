'use strict';

const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { upsertProgramRoleSnapshot } = require('../db');
const { matchProgramRoles } = require('../utils/program_moderation_alert');
const { PROGRAM_ROLE_IDS } = require('../config/constants');

// Durably records the program roles a member holds whenever their roles change.
// This is the "roles they had" snapshot consumed by the Dyno moderation alert:
// after a ban or leave the member is gone from cache, but the last snapshot
// taken while they held a program role survives. Only members who currently
// hold at least one program role are written, keeping the table small.
//
// Limitation: this only captures membership going forward (from the first role
// change observed while the bot is running); it does not backfill existing
// members.
module.exports = {
    name: Events.GuildMemberUpdate,
    once: false,
    async execute(_oldMember, newMember) {
        try {
            const member = newMember;
            if (!member?.user?.id || !member.roles?.cache) {
                return;
            }

            const matched = matchProgramRoles([...member.roles.cache.keys()], PROGRAM_ROLE_IDS);
            if (matched.length === 0) {
                return;
            }

            await upsertProgramRoleSnapshot(member.user.id, matched);
        } catch (error) {
            logger.error('[ProgramRoleSnapshot] Failed to record snapshot:', error);
        }
    },
};
