'use strict';

// Interaction glue for /squad browse and squad applications (sub-project 2).
// customId scheme (split on ':'):
//   squadbrowse:page:<n>       (button)  re-render page n
//   squadbrowse:pick:<page>    (select)  join an Open squad / apply to an Apply squad
//   squadapp:modal:<squadId>   (modal)   application message submit
//   squadapp:accept:<id> / squadapp:deny:<id>   (owner DM buttons)
//   squadapp:withdraw:<id>     (applicant button)

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, MessageFlags, ContainerBuilder,
} = require('discord.js');
const logger = require('../utils/logger');
const { noticePayload, buildTextBlock } = require('../utils/ui');
const { GYM_CLASS_GUILD_ID } = require('../config/constants');
const { findMascotByName } = require('../config/squads');
const squadDb = require('../utils/squad_db');
const { buildBrowsePages, renderBrowsePage } = require('../commands/squads/squad_browse');

const SUBTITLE = 'Squad Recruiting';
const MAX_PENDING_APPLICATIONS = 3;

// Pure gate for applying to a squad.
function applyGate({ isLeader, membership, pendingCount, squad }) {
    if (!squad) {
        return { ok: false, code: 'NO_SQUAD' };
    }
    if (isLeader) {
        return { ok: false, code: 'LEADER' };
    }
    if (membership) {
        return { ok: false, code: 'IN_A_SQUAD' };
    }
    if (pendingCount >= MAX_PENDING_APPLICATIONS) {
        return { ok: false, code: 'TOO_MANY' };
    }
    if ((squad.recruiting || 'Invite-only') !== 'Apply') {
        return { ok: false, code: 'NOT_APPLY' };
    }
    return { ok: true };
}

// Pure owner-DM card body.
function buildApplicationCardLines(application, squad) {
    const lines = [
        `**Applicant:** <@${application.user_id}>${application.username ? ` (${application.username})` : ''}`,
        `**Squad:** ${squad.name} (${squad.squad_type})`,
    ];
    if (application.message) {
        lines.push(`**Message:** ${application.message}`);
    }
    return lines;
}

function editNotice(interaction, message, title) {
    return interaction.editReply(noticePayload(message, { title, subtitle: SUBTITLE }));
}

async function dmUser(client, userId, { title, subtitle, lines, components = [] }) {
    try {
        const user = await client.users.fetch(String(userId));
        const container = new ContainerBuilder();
        const block = buildTextBlock({ title, subtitle, lines });
        if (block) container.addTextDisplayComponents(block);
        return await user.send({ flags: MessageFlags.IsComponentsV2, components: [container, ...components] });
    } catch (error) {
        logger.error(`[Squad Discovery] Failed to DM ${userId}:`, error.message);
        return null;
    }
}

// Edit the owner's DM application card into a terminal state (buttons gone).
async function finalizeApplicationCard(client, application, squad, statusLine) {
    if (!application.dm_message_id) return;
    try {
        const owner = await client.users.fetch(String(squad.owner_id));
        const dm = await owner.createDM();
        const message = await dm.messages.fetch(application.dm_message_id);
        const container = new ContainerBuilder();
        const block = buildTextBlock({
            title: `Squad Application #${application.id}`,
            subtitle: SUBTITLE,
            lines: [...buildApplicationCardLines(application, squad), statusLine],
        });
        if (block) container.addTextDisplayComponents(block);
        await message.edit({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (error) {
        logger.error(`[Squad Discovery] Failed to finalize card for application ${application.id}:`, error.message);
    }
}

// Join side effects shared with the accept path: nickname, mascot role,
// owner DM. The membership row itself is already written by addSquadMember.
async function applyJoinSideEffects(client, squad, userId, { notifyOwner = true } = {}) {
    try {
        const guild = await client.guilds.fetch(GYM_CLASS_GUILD_ID);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            await member.setNickname(`[${squad.name}] ${member.user.username}`).catch(() => {});
            const mascot = squad.event_squad ? findMascotByName(squad.event_squad) : null;
            if (mascot) {
                await member.roles.add(mascot.roleId).catch(() => {});
            }
        }
    } catch (error) {
        logger.error(`[Squad Discovery] Join side effects failed for ${userId}:`, error.message);
    }
    if (notifyOwner) {
        await dmUser(client, squad.owner_id, {
            title: 'New Member Joined',
            subtitle: squad.name,
            lines: [`<@${userId}> joined your squad **${squad.name}** through the squad browser.`],
        });
    }
}

// --- browse -----------------------------------------------------------------

async function handleBrowseButton(interaction) {
    const [, action, pageStr] = interaction.customId.split(':');
    if (action !== 'page') {
        return;
    }
    await interaction.deferUpdate();
    const pages = buildBrowsePages(await squadDb.fetchBrowseSquads());
    const pageIndex = Math.max(0, Math.min(parseInt(pageStr, 10) || 0, pages.length - 1));
    if (pages.length === 0) {
        return;
    }
    await interaction.editReply(renderBrowsePage(pages, pageIndex));
}

async function handleBrowseSelect(interaction) {
    const squadId = parseInt(interaction.values[0], 10);
    const squad = await squadDb.fetchSquadById(squadId);
    const recruiting = squad ? (squad.recruiting || 'Invite-only') : 'Invite-only';

    if (squad && recruiting === 'Apply') {
        // Modal must be the FIRST response; gates re-run at submit.
        const modal = new ModalBuilder().setCustomId(`squadapp:modal:${squad.id}`).setTitle(`Apply to ${squad.name}`);
        const message = new TextInputBuilder()
            .setCustomId('message').setLabel('Why do you want to join? (optional)')
            .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300);
        modal.addComponents(new ActionRowBuilder().addComponents(message));
        return interaction.showModal(modal);
    }

    await interaction.deferReply({ ephemeral: true });
    if (!squad) {
        return editNotice(interaction, 'That squad no longer exists.', 'Squad Not Found');
    }
    if (recruiting !== 'Open') {
        return editNotice(interaction, `**${squad.name}** is not open for instant joining anymore.`, 'Not Open');
    }

    const userId = interaction.user.id;
    if ((await squadDb.fetchSquadsByOwner(userId)).length > 0) {
        return editNotice(interaction, 'You are a squad leader and cannot join another squad.', 'Already a Leader');
    }
    const result = await squadDb.addSquadMember(squad.id, userId, interaction.user.username);
    if (!result.ok && result.code === 'ALREADY_MEMBER') {
        return editNotice(interaction, 'You are already in a squad. Leave it first with `/squad leave`.', 'Already in a Squad');
    }
    if (!result.ok) {
        return editNotice(interaction, `**${squad.name}** filled up just now. Try another squad.`, 'Squad Full');
    }

    await applyJoinSideEffects(interaction.client, squad, userId);
    logger.info(`[Squad Discovery] ${userId} joined ${squad.name} (${squad.id}) via browse`);
    return editNotice(interaction, `Welcome to **${squad.name}**! The squad owner has been notified.`, 'Joined Squad');
}

// --- application modal -------------------------------------------------------

async function handleApplicationModal(interaction) {
    const [, action, squadIdStr] = interaction.customId.split(':');
    if (action !== 'modal') {
        return;
    }
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const squad = await squadDb.fetchSquadById(parseInt(squadIdStr, 10));
    const gate = applyGate({
        isLeader: (await squadDb.fetchSquadsByOwner(userId)).length > 0,
        membership: await squadDb.fetchMembership(userId),
        pendingCount: await squadDb.countPendingApplicationsByUser(userId),
        squad,
    });
    if (!gate.ok) {
        const copy = {
            NO_SQUAD: 'That squad no longer exists.',
            LEADER: 'You are a squad leader and cannot apply to another squad.',
            IN_A_SQUAD: 'You are already in a squad. Leave it first with `/squad leave`.',
            TOO_MANY: `You already have ${MAX_PENDING_APPLICATIONS} pending applications. Withdraw one first.`,
            NOT_APPLY: 'That squad is not taking applications anymore.',
        }[gate.code];
        return editNotice(interaction, copy, 'Cannot Apply');
    }

    const message = (interaction.fields.getTextInputValue('message') || '').trim() || null;
    const result = await squadDb.insertApplication({ squadId: squad.id, userId, username: interaction.user.username, message });
    if (!result.ok) {
        return editNotice(interaction, `You already have a pending application to **${squad.name}**.`, 'Already Applied');
    }
    const application = result.application;

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`squadapp:accept:${application.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`squadapp:deny:${application.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    );
    const dmMessage = await dmUser(interaction.client, squad.owner_id, {
        title: `Squad Application #${application.id}`,
        subtitle: SUBTITLE,
        lines: buildApplicationCardLines(application, squad),
        components: [buttons],
    });
    if (!dmMessage) {
        // Owner unreachable: compensate so the slot is not consumed invisibly.
        await squadDb.claimApplication(application.id, 'Expired', 'system').catch(() => {});
        return editNotice(interaction, `Could not reach the owner of **${squad.name}**. Try again later.`, 'Owner Unreachable');
    }
    await squadDb.setApplicationDmMessage(application.id, dmMessage.id);

    logger.info(`[Squad Discovery] Application ${application.id}: ${userId} -> ${squad.name} (${squad.id})`);
    const withdrawRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`squadapp:withdraw:${application.id}`).setLabel('Withdraw Application').setStyle(ButtonStyle.Secondary),
    );
    const confirmation = noticePayload(
        [
            `Your application to **${squad.name}** was sent to the squad owner.`,
            'You will be DMed when they respond. Applications expire after 7 days.',
        ],
        { title: 'Application Sent', subtitle: SUBTITLE }
    );
    return interaction.editReply({ ...confirmation, components: [...confirmation.components, withdrawRow] });
}

// --- application buttons -----------------------------------------------------

async function handleApplicationButton(interaction) {
    const [, action, idStr] = interaction.customId.split(':');
    const applicationId = parseInt(idStr, 10);
    if (action === 'accept' || action === 'deny') {
        return handleOwnerDecision(interaction, applicationId, action);
    }
    if (action === 'withdraw') {
        return handleWithdraw(interaction, applicationId);
    }
    logger.warn('[Squad Discovery] Unknown application action:', action);
}

async function handleOwnerDecision(interaction, applicationId, action) {
    await interaction.deferReply({ ephemeral: true });

    const application = await squadDb.fetchApplicationById(applicationId);
    if (!application || application.status !== 'Pending') {
        return editNotice(interaction, 'This application has already been handled.', 'Already Handled');
    }
    const squad = await squadDb.fetchSquadById(application.squad_id);
    if (!squad || String(squad.owner_id) !== String(interaction.user.id)) {
        return editNotice(interaction, 'Only the squad owner can respond to this application.', 'Not Authorized');
    }

    if (action === 'deny') {
        const denied = await squadDb.claimApplication(applicationId, 'Denied', interaction.user.id);
        if (!denied) {
            return editNotice(interaction, 'This application has already been handled.', 'Already Handled');
        }
        await finalizeApplicationCard(interaction.client, denied, squad, '**Status:** Denied');
        await dmUser(interaction.client, denied.user_id, {
            title: 'Application Denied',
            subtitle: squad.name,
            lines: [`Your application to **${squad.name}** was denied by the squad owner.`],
        });
        return editNotice(interaction, `Application #${applicationId} denied. The applicant was notified.`, 'Application Denied');
    }

    // Accept: membership write first (it is the contended resource), then the
    // Pending-only claim; a lost claim (concurrent withdraw) compensates by
    // removing the just-added member.
    const result = await squadDb.addSquadMember(squad.id, application.user_id, application.username);
    if (!result.ok && result.code === 'FULL') {
        return editNotice(interaction, `Your squad **${squad.name}** is full. Free a slot and accept again; the application stays pending.`, 'Squad Full');
    }
    if (!result.ok && result.code === 'ALREADY_MEMBER') {
        const membership = await squadDb.fetchMembership(application.user_id);
        const sameSquad = membership && membership.squad.id === squad.id;
        const claimed = await squadDb.claimApplication(applicationId, sameSquad ? 'Accepted' : 'Denied', interaction.user.id);
        if (claimed) {
            await finalizeApplicationCard(interaction.client, claimed, squad, `**Status:** ${sameSquad ? 'Accepted' : 'Denied (joined another squad)'}`);
        }
        return editNotice(interaction, sameSquad
            ? 'They are already in your squad; the application has been closed.'
            : 'The applicant joined another squad in the meantime; the application was closed.', 'Already Resolved');
    }
    if (!result.ok) {
        return editNotice(interaction, 'Your squad no longer exists.', 'Squad Missing');
    }

    const accepted = await squadDb.claimApplication(applicationId, 'Accepted', interaction.user.id);
    if (!accepted) {
        // Withdrawn mid-click: undo the membership we just wrote.
        await squadDb.removeSquadMember(squad.id, application.user_id);
        return editNotice(interaction, 'The applicant withdrew this application just now. No changes were made.', 'Withdrawn');
    }

    await applyJoinSideEffects(interaction.client, squad, accepted.user_id, { notifyOwner: false });
    await finalizeApplicationCard(interaction.client, accepted, squad, '**Status:** Accepted');
    await dmUser(interaction.client, accepted.user_id, {
        title: 'Application Accepted',
        subtitle: squad.name,
        lines: [`You are in! The owner of **${squad.name}** accepted your application.`],
    });
    logger.info(`[Squad Discovery] Application ${applicationId} accepted; ${accepted.user_id} joined ${squad.name}`);
    return editNotice(interaction, `Accepted <@${accepted.user_id}> into **${squad.name}**.`, 'Application Accepted');
}

async function handleWithdraw(interaction, applicationId) {
    await interaction.deferReply({ ephemeral: true });

    const application = await squadDb.fetchApplicationById(applicationId);
    if (!application || String(application.user_id) !== String(interaction.user.id)) {
        return editNotice(interaction, 'Only the applicant can withdraw this application.', 'Not Authorized');
    }
    const withdrawn = await squadDb.claimApplication(applicationId, 'Withdrawn', interaction.user.id);
    if (!withdrawn) {
        return editNotice(interaction, 'This application has already been handled.', 'Already Handled');
    }
    const squad = await squadDb.fetchSquadById(withdrawn.squad_id);
    if (squad) {
        await finalizeApplicationCard(interaction.client, withdrawn, squad, '**Status:** Withdrawn by applicant');
    }
    logger.info(`[Squad Discovery] Application ${applicationId} withdrawn by ${interaction.user.id}`);
    return editNotice(interaction, 'Your application has been withdrawn.', 'Application Withdrawn');
}

module.exports = {
    MAX_PENDING_APPLICATIONS,
    applyGate,
    buildApplicationCardLines,
    finalizeApplicationCard,
    dmUser,
    handleBrowseButton,
    handleBrowseSelect,
    handleApplicationModal,
    handleApplicationButton,
};
