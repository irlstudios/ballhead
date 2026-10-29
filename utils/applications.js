'use strict';

const { PermissionsBitField } = require('discord.js');
const logger = require('./logger');
const { noticePayload } = require('./ui');
const decisions = require('./application_decision_queries');

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

// Format-only check for links applicants paste into a form: a full http(s) URL
// with a real hostname. Reviewers open the link, so that is the real check.
const isHttpUrl = (value) => {
    let url;
    try {
        url = new URL(String(value ?? '').trim());
    } catch {
        return false;
    }
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
};

// Who may press Accept/Deny on a review card. Seeing the channel is not
// enough: staff with Manage Roles always can, plus a program's own leads
// (by user id or role) who review without server-wide permissions.
const canReviewApplications = (interaction, { userIds = [], roleIds = [] } = {}) => {
    const member = interaction.member;
    if (!member) return false;
    if (member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) return true;
    if (userIds.includes(interaction.user.id)) return true;
    return roleIds.some((roleId) => member.roles?.cache?.has(roleId));
};

// Every text block on a review card, top to bottom. Stored with the decision
// because the card is overwritten with the outcome once it is decided.
const cardText = (message) => {
    const texts = [];
    const walk = (components) => {
        for (const component of components || []) {
            const json = typeof component.toJSON === 'function' ? component.toJSON() : component;
            if (typeof json.content === 'string') texts.push(json.content);
            walk(json.components);
        }
    };
    walk(message?.components);
    return texts.join('\n');
};

// Atomically claims the review card for one decision. Returns the claim id,
// or null when another click already decided this card.
const claimApplicationDecision = (interaction, { program, applicantId, decision }) =>
    decisions.insertApplicationDecision({
        program,
        messageId: interaction.message.id,
        applicantId,
        decision,
        decidedBy: interaction.user.id,
        cardText: cardText(interaction.message),
    });

// Undoes a claim when the decision failed partway, so the reviewer can retry.
const releaseApplicationDecision = async (claimId) => {
    if (!claimId) return;
    try {
        await decisions.deleteApplicationDecision(claimId);
    } catch (error) {
        logger.error(`Failed to release application decision ${claimId}:`, error);
    }
};

// Handler glue for a deferred Accept/Deny click. Each replies to the reviewer
// itself when the click must stop, so the handler just returns.
const refuseUnlessReviewer = async (interaction, rule, subtitle) => {
    if (canReviewApplications(interaction, rule)) return false;
    await interaction.editReply(noticePayload(
        'You do not have permission to review these applications.',
        { title: 'Permission Denied', subtitle }
    ));
    return true;
};

const claimOrReport = async (interaction, claim, subtitle) => {
    const claimId = await claimApplicationDecision(interaction, claim);
    if (!claimId) {
        await interaction.editReply(noticePayload(
            'This application has already been reviewed.',
            { title: 'Already Handled', subtitle }
        ));
    }
    return claimId;
};

module.exports = {
    fetchApplicant,
    isHttpUrl,
    canReviewApplications,
    cardText,
    claimApplicationDecision,
    releaseApplicationDecision,
    refuseUnlessReviewer,
    claimOrReport,
};
