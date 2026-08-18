'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID, BOT_BUGS_CHANNEL_ID } = require('../../config/constants');
const { findMascotByName } = require('../../config/squads');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

function parseDiscordUserId(value) {
    const normalized = String(value ?? '').trim();
    const match = normalized.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
    return match ? match[1] || match[2] : null;
}

// Pure removal gate: owners cannot remove themselves, and the target must be
// a member of the resolved squad (membership is unique per user).
function removalGate({ ownerId, targetId, targetMembership, squadId }) {
    if (ownerId === targetId) {
        return { ok: false, code: 'SELF' };
    }
    if (!targetMembership || targetMembership.squad.id !== squadId) {
        return { ok: false, code: 'NOT_IN_SQUAD' };
    }
    return { ok: true };
}

function notice(title, lines) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${title}`),
        new TextDisplayBuilder().setContent(Array.isArray(lines) ? lines.join('\n') : lines)
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true };
}

module.exports = {
    removalGate,
    data: new SlashCommandBuilder()
        .setName('squad-remove-member')
        .setDescription('Remove a member from your squad (Squad Leaders only).')
        .addStringOption(option =>
            option.setName('member')
                .setDescription('Select a stored squad member, or paste their Discord ID.')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('Only needed if you own multiple squads.')
                .setRequired(false)),

    async autocomplete(interaction) {
        try {
            const specifiedSquad = interaction.options.getString('squad');
            const ownedSquads = await squadDb.fetchSquadsByOwner(interaction.user.id);
            const targets = specifiedSquad
                ? ownedSquads.filter((s) => s.name === squadDb.normalizeSquadName(specifiedSquad))
                : ownedSquads;
            const focused = String(interaction.options.getFocused() ?? '').trim().toLowerCase();

            const seen = new Set();
            const choices = [];
            for (const squad of targets) {
                for (const m of await squadDb.fetchSquadMembers(squad.id)) {
                    if (seen.has(m.user_id)) continue;
                    const username = m.username || `Discord user ${m.user_id}`;
                    const searchable = `${username} ${m.user_id} ${squad.name}`.toLowerCase();
                    if (focused && !searchable.includes(focused)) continue;
                    seen.add(m.user_id);
                    choices.push({ name: `${username} - ${squad.name}`.slice(0, 100), value: m.user_id });
                    if (choices.length >= 25) break;
                }
                if (choices.length >= 25) break;
            }
            await interaction.respond(choices);
        } catch (error) {
            logger.error('[Remove From Squad] Autocomplete error:', error);
            await interaction.respond([]).catch(() => {});
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const commandUserID = interaction.user.id;
        const commandUserTag = interaction.user.tag;
        const targetUserID = parseDiscordUserId(interaction.options.getString('member'));
        let targetUserTag = targetUserID || 'unknown user';
        const guild = interaction.guild;

        if (!targetUserID) {
            return interaction.editReply(notice('Invalid Discord ID', 'Select a member from the roster results, or paste a valid Discord user ID.'));
        }

        try {
            const specifiedSquad = interaction.options.getString('squad');
            const ownedSquads = await squadDb.fetchSquadsByOwner(commandUserID);
            const targetMembership = await squadDb.fetchMembership(targetUserID);

            // Resolve which owned squad this removal targets: the explicit
            // option wins; otherwise the target's own (unique) squad, when the
            // caller owns it; otherwise the usual disambiguation.
            let squad = null;
            if (specifiedSquad) {
                const { squad: resolved, error } = squadDb.disambiguateOwnedSquad(ownedSquads, specifiedSquad);
                if (error) {
                    return interaction.editReply(notice('Access Denied', error));
                }
                squad = resolved;
            } else if (targetMembership && ownedSquads.some((s) => s.id === targetMembership.squad.id)) {
                squad = targetMembership.squad;
            } else {
                const { squad: resolved, error } = squadDb.disambiguateOwnedSquad(ownedSquads, null);
                if (error) {
                    return interaction.editReply(notice('Access Denied', error));
                }
                squad = resolved;
            }

            const gate = removalGate({ ownerId: commandUserID, targetId: targetUserID, targetMembership, squadId: squad.id });
            if (!gate.ok) {
                if (gate.code === 'SELF') {
                    return interaction.editReply(notice('Invalid Target', 'You cannot remove yourself from your own squad.\nUse `/squad leave` or `/squad disband`.'));
                }
                return interaction.editReply(notice('Member Not Found', `<@${targetUserID}> is not currently a member of your squad **${squad.name}**.`));
            }

            targetUserTag = targetMembership.member.username || targetUserID;
            const removed = await squadDb.removeSquadMember(squad.id, targetUserID);
            if (!removed) {
                return interaction.editReply(notice('Member Not Found', `<@${targetUserID}> is not currently a member of your squad **${squad.name}**.`));
            }
            logger.info(`Removed ${targetUserTag} from ${squad.name}`);

            let discordCleanupStatus = 'not-in-server';
            try {
                const memberToRemove = await guild.members.fetch(targetUserID);
                discordCleanupStatus = 'completed';
                if (memberToRemove.nickname && memberToRemove.nickname.toUpperCase().startsWith(`[${squad.name}]`)) {
                    await memberToRemove.setNickname(null).catch(nickErr => {
                        if (nickErr.code !== 50013) logger.error(`Could not reset nickname for ${targetUserTag}: ${nickErr.message}`);
                    });
                }
                const mascot = squad.event_squad ? findMascotByName(squad.event_squad) : null;
                if (mascot && memberToRemove.roles.cache.has(mascot.roleId)) {
                    await memberToRemove.roles.remove(mascot.roleId).catch(roleErr => {
                        if (roleErr.code !== 50013 && roleErr.code !== 10011) {
                            logger.error(`Failed to remove mascot role from ${targetUserTag}: ${roleErr.message}`);
                        }
                    });
                }
            } catch (discordError) {
                if (discordError.code === 10007 || discordError.code === 10013) {
                    logger.info(`Member ${targetUserTag} (${targetUserID}) is no longer in the server; stored squad membership was removed.`);
                } else {
                    discordCleanupStatus = 'failed';
                    logger.error(`Error updating Discord member ${targetUserTag}: ${discordError.message}`);
                }
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                logContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Member Removed'),
                    new TextDisplayBuilder().setContent(`**${commandUserTag}** (<@${commandUserID}>) removed **${targetUserTag}** (<@${targetUserID}>) from squad **${squad.name}**.`)
                );
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                logger.error('Failed to send removal log message:', logError);
            }

            const cleanupMessage = discordCleanupStatus === 'completed'
                ? 'Their squad roles and nickname were reset where applicable.'
                : discordCleanupStatus === 'not-in-server'
                    ? 'They are no longer in the server, so only their stored squad record needed to be removed.'
                    : 'Their stored squad record was removed, but Discord role or nickname cleanup could not be completed.';
            return interaction.editReply(notice('Member Removed', [
                `<@${targetUserID}> has been successfully removed from **${squad.name}**.`,
                cleanupMessage,
            ]));
        } catch (error) {
            logger.error(`Error during /squad remove-member for ${commandUserTag} removing ${targetUserTag}:`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                errorContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Remove From Squad Error'),
                    new TextDisplayBuilder().setContent(`**User:** ${commandUserTag} (${commandUserID})\n**Target:** ${targetUserTag} (${targetUserID})\n**Error:** ${error.message}`)
                );
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error('Failed to log removal command error:', logError);
            }
            return interaction.editReply(notice('Request Failed', `An error occurred: ${error.message || 'Please try again later.'}`)).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
