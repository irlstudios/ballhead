const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { insertInvite, fetchInviteById, deleteInvite } = require('../../db');
const {
    GYM_CLASS_GUILD_ID,
    LOGGING_CHANNEL_ID,
    BOT_BUGS_CHANNEL_ID,
} = require('../../config/constants');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');
const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000;

// Pure invite gate so every refusal is unit-testable. Order matters: identity
// problems first, then the target's state, then capacity.
function inviteGate({ inviter, target, targetIsBot, targetInGuild, targetMembership, targetOwnedSquads, optIn, memberCount }) {
    if (target === inviter) {
        return { ok: false, code: 'SELF' };
    }
    if (targetIsBot) {
        return { ok: false, code: 'BOT' };
    }
    if (!targetInGuild) {
        return { ok: false, code: 'NOT_IN_GUILD' };
    }
    if (targetOwnedSquads.length > 0) {
        return { ok: false, code: 'TARGET_LEADS' };
    }
    if (targetMembership) {
        return { ok: false, code: 'TARGET_IN_SQUAD' };
    }
    if (!optIn) {
        return { ok: false, code: 'OPTED_OUT' };
    }
    if (memberCount >= squadDb.MAX_SQUAD_MEMBERS - 1) {
        return { ok: false, code: 'FULL' };
    }
    return { ok: true };
}
// Discord API error codes that all mean "the bot cannot deliver a DM to this user"
// 50007: user has DMs disabled / blocked the bot
// 50278: no mutual guilds (commonly the bot is blocked, even if they share a server)
const UNDELIVERABLE_DM_CODES = new Set([50007, 50278]);

module.exports = {
    inviteGate,
    data: new SlashCommandBuilder()
        .setName('squad-invite')
        .setDescription('Invite a member to join your squad (Squad Leaders only).')
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member you want to invite.')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('Squad name (required if you own multiple)')
                .setRequired(false)
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const commandUserID = interaction.user.id;
        const commandUserTag = interaction.user.tag;
        const invitedMember = interaction.options.getMember('member');
        const invitedUser = interaction.options.getUser('member');

        if (!invitedMember && !invitedUser) {
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    new TextDisplayBuilder().setContent('## User Not Found'),
                    new TextDisplayBuilder().setContent('Could not find the specified member/user.')
                ],
                ephemeral: true
            });
            return;
        }
        const targetUser = invitedUser || invitedMember.user;
        const targetUserId = targetUser.id;
        const targetUserTag = targetUser.tag;

        if (targetUserId === commandUserID) {
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [new TextDisplayBuilder().setContent('You cannot invite yourself to your own squad.')],
                ephemeral: true
            });
            return;
        }
        if (targetUser.bot) {
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [new TextDisplayBuilder().setContent('You cannot invite bots to a squad.')],
                ephemeral: true
            });
            return;
        }

        const targetGuildMember = invitedMember
            || await interaction.guild?.members.fetch(targetUserId).catch(() => null);
        if (!targetGuildMember) {
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [new TextDisplayBuilder().setContent('That user is not currently in this server and cannot join a squad.')],
                ephemeral: true,
            });
            return;
        }

        try {
            const specifiedSquad = interaction.options.getString('squad');
            const ownedSquads = await squadDb.fetchSquadsByOwner(commandUserID);
            const { squad, error: disambigError } = squadDb.disambiguateOwnedSquad(ownedSquads, specifiedSquad);
            if (disambigError) {
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent(disambigError)],
                    ephemeral: true,
                });
                return;
            }
            const squadName = squad.name;
            const finalSquadType = squad.squad_type;

            const gate = inviteGate({
                inviter: commandUserID,
                target: targetUserId,
                targetIsBot: targetUser.bot,
                targetInGuild: Boolean(targetGuildMember),
                targetMembership: await squadDb.fetchMembership(targetUserId),
                targetOwnedSquads: await squadDb.fetchSquadsByOwner(targetUserId),
                optIn: await squadDb.getInvitesOptIn(targetUserId),
                memberCount: (await squadDb.fetchSquadMembers(squad.id)).length,
            });
            if (!gate.ok) {
                const copy = {
                    SELF: 'You cannot invite yourself to your own squad.',
                    BOT: 'You cannot invite bots to a squad.',
                    NOT_IN_GUILD: 'That user is not currently in this server and cannot join a squad.',
                    TARGET_LEADS: `<@${targetUserId}> is already a squad leader and cannot be invited.`,
                    TARGET_IN_SQUAD: `<@${targetUserId}> is already in another squad.`,
                    OPTED_OUT: `<@${targetUserId}> has opted out of receiving squad invitations.`,
                    FULL: `Your squad **${squadName}** is full (${squadDb.MAX_SQUAD_MEMBERS}/${squadDb.MAX_SQUAD_MEMBERS}).`,
                }[gate.code];
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [new TextDisplayBuilder().setContent(copy)],
                    ephemeral: true,
                });
                return;
            }


            const now = new Date();
            const futureTime = new Date(now.getTime() + INVITE_EXPIRY_MS);
            const futureTimestamp = Math.floor(futureTime.getTime() / 1000);

            const inviteContainer = new ContainerBuilder()
                .setAccentColor(0x14B8A6)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## You\'ve Been Invited!')
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**${squadName}** • ${finalSquadType}`),
                    new TextDisplayBuilder().setContent(`<@${commandUserID}> wants you to join their squad.`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Expires <t:${futureTimestamp}:R>`)
                );

            let inviteMessage;
            try {
                inviteMessage = await targetUser.send({ flags: MessageFlags.IsComponentsV2, components: [inviteContainer] });

            } catch (dmError) {
                if (UNDELIVERABLE_DM_CODES.has(dmError.code)) {
                    logger.info(`Cannot send DM to ${targetUserTag} (${targetUserId}) - DMs disabled or bot blocked (code ${dmError.code}).`);
                    const dmFailedContainer = new ContainerBuilder()
                        .setAccentColor(0xF1C40F)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('## Could Not Send Invite'),
                            new TextDisplayBuilder().setContent(`<@${targetUserId}> isn't accepting DMs from the bot. This usually means they have DMs disabled or have blocked the bot.`),
                            new TextDisplayBuilder().setContent('-# Ask them to enable server DMs (or unblock the bot) and try again')
                        );
                    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [dmFailedContainer], ephemeral: true });
                } else {
                    logger.error(`Failed to send invite DM to ${targetUserId}:`, dmError);
                    throw new Error('Failed to send the invite DM due to an unexpected error.');
                }
                return;
            }

            let trackingMessage;
            try {
                const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const trackingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const trackingContainer = new ContainerBuilder();
                trackingContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Invite Sent'),
                    new TextDisplayBuilder().setContent(`**${commandUserTag}** (<@${commandUserID}>) invited **${targetUserTag}** (<@${targetUserId}>) to squad **${squadName}**.`)
                );
                trackingMessage = await trackingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [trackingContainer] });
            } catch (logError) {
                logger.error(`Failed to send invite log message: ${logError.message}`);
            }

            const postData = {
                command_user_id: commandUserID,
                invited_member_id: targetUserId,
                squad_name: squadName,
                message_id: inviteMessage.id,
                tracking_message_id: trackingMessage ? trackingMessage.id : null,
                squad_type: finalSquadType,
            };
            const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);
            try {
                await insertInvite(
                    postData.command_user_id,
                    postData.invited_member_id,
                    postData.squad_name,
                    postData.message_id,
                    postData.tracking_message_id,
                    postData.squad_type,
                    expiresAt,
                    squad.id
                );
            } catch (databaseError) {
                const unavailableContainer = new ContainerBuilder()
                    .setAccentColor(0xE74C3C)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Invitation Unavailable'),
                        new TextDisplayBuilder().setContent('The bot could not save this invitation. Ask the squad owner to try again.')
                    );
                await inviteMessage.edit({
                    flags: MessageFlags.IsComponentsV2,
                    components: [unavailableContainer],
                }).catch(() => {});
                if (trackingMessage) {
                    const failedTrackingContainer = new ContainerBuilder()
                        .setAccentColor(0xE74C3C)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('## Invite Failed'),
                            new TextDisplayBuilder().setContent(`The invite to <@${targetUserId}> for **${squadName}** could not be saved.`)
                        );
                    await trackingMessage.edit({
                        flags: MessageFlags.IsComponentsV2,
                        components: [failedTrackingContainer],
                    }).catch(() => {});
                }
                throw new Error(`Failed to save invite before enabling buttons: ${databaseError.message}`);
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`invite_accept_${inviteMessage.id}`).setLabel('Accept Invite').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`invite_reject_${inviteMessage.id}`).setLabel('Reject Invite').setStyle(ButtonStyle.Danger),
                );
            try {
                await inviteMessage.edit({
                    flags: MessageFlags.IsComponentsV2,
                    components: [inviteContainer, row],
                });
            } catch (editError) {
                await deleteInvite(inviteMessage.id).catch(() => {});
                if (trackingMessage) {
                    const failedTrackingContainer = new ContainerBuilder()
                        .setAccentColor(0xE74C3C)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('## Invite Failed'),
                            new TextDisplayBuilder().setContent(`The invite to <@${targetUserId}> for **${squadName}** could not be delivered with working buttons.`)
                        );
                    await trackingMessage.edit({
                        flags: MessageFlags.IsComponentsV2,
                        components: [failedTrackingContainer],
                    }).catch(() => {});
                }
                throw new Error(`Failed to enable saved invite buttons: ${editError.message}`);
            }
            logger.info(`Saved and enabled invite ${inviteMessage.id}`);

            setTimeout(async () => {
                try {
                    const currentInviteData = await fetchInviteById(inviteMessage.id);
                    if (currentInviteData && currentInviteData.invite_status === 'Pending') {
                        logger.info(`Invite ${inviteMessage.id} expired.`);
                        const expiredContainer = new ContainerBuilder()
                            .setAccentColor(0x95A5A6)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('## Invitation Expired'),
                                new TextDisplayBuilder().setContent(`The invite from <@${commandUserID}> to join **${squadName}** has expired.`),
                                new TextDisplayBuilder().setContent('-# Ask them to send a new invite if you\'re still interested')
                            );
                        await inviteMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [expiredContainer] }).catch(editErr => logger.warn(`Could not edit expired invite DM ${inviteMessage.id}: ${editErr.message}`));
                        if (trackingMessage) {
                            const expiredTracking = new ContainerBuilder();
                            expiredTracking.addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('## Invite Expired'),
                                new TextDisplayBuilder().setContent(`Invite from **${commandUserTag}** (<@${commandUserID}>) to **${targetUserTag}** (<@${targetUserId}>) for squad **${squadName}**.`)
                            );
                            await trackingMessage.edit({ flags: MessageFlags.IsComponentsV2, components: [expiredTracking] }).catch(editErr => logger.warn(`Could not edit expired tracking message ${trackingMessage.id}: ${editErr.message}`));
                        }
                        await deleteInvite(inviteMessage.id);
                    }
                } catch (error) {
                    if (error.message && error.message.includes('404')) { logger.info(`Invite ${inviteMessage.id} likely already processed or deleted before expiry.`); }
                    else { logger.error(`Error during invite expiry check for ${inviteMessage.id}:`, error.message); }
                }
            }, INVITE_EXPIRY_MS);

            const successContainer = new ContainerBuilder()
                .setAccentColor(0x2ECC71)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Invite Sent'),
                    new TextDisplayBuilder().setContent(`<@${targetUserId}> has been invited to **${squadName}**.`),
                    new TextDisplayBuilder().setContent('-# They have 48 hours to respond')
                );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            logger.error(`Error during /squad invite for ${commandUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                errorContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Invite Command Error'),
                    new TextDisplayBuilder().setContent([
                        `**User:** ${commandUserTag} (${commandUserID})`,
                        `**Invitee:** ${targetUserTag} (${targetUserId})`,
                        `**Error:** ${error.message}`
                    ].join('\n'))
                );
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) { logger.error('Failed to log invite command error:', logError); }
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [new TextDisplayBuilder().setContent('Something went wrong. Please try again later.')],
                ephemeral: true
            }).catch(logger.error);
        }
    }
};
