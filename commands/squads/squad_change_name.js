'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID } = require('../../config/constants');
const { buildTextBlock } = require('../../utils/ui');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

// Pure rename gate. nameHolders = squads already holding the new name; a
// holder with a different owner blocks the rename (same-owner holders are the
// caller's own pair, which renames together).
function renameGate({ userId, newName, targetSquad, nameHolders }) {
    if (!/^[A-Z0-9]{1,4}$/.test(newName)) {
        return { ok: false, code: 'BAD_NAME' };
    }
    if (newName === targetSquad.name) {
        return { ok: false, code: 'SAME_NAME' };
    }
    if (nameHolders.some((s) => String(s.owner_id) !== String(userId))) {
        return { ok: false, code: 'NAME_TAKEN' };
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

// Shared by /squad rename and /squad force-name: rename every row holding the
// old name (a Casual+Competitive pair renames together), then sweep member
// and leader nicknames and DM members.
async function renameSquadRows(client, guild, rows, newName, { notifyLines }) {
    // One statement for the whole pair: a failure can never leave the Casual
    // and Competitive rows under different names.
    const renamed = await squadDb.renameSquads(rows.map((r) => r.id), newName);
    if (renamed.length === 0) {
        return null;
    }

    const oldName = rows[0].name;
    const affectedIds = new Set([rows[0].owner_id]);
    for (const row of rows) {
        for (const m of await squadDb.fetchSquadMembers(row.id)) {
            affectedIds.add(m.user_id);
        }
    }

    for (const memberId of affectedIds) {
        try {
            const member = await guild.members.fetch(memberId);
            if (memberId !== rows[0].owner_id) {
                const dmContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Squad Renamed', subtitle: 'Squad Update', lines: notifyLines(oldName, newName) });
                if (block) dmContainer.addTextDisplayComponents(block);
                await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(() => {});
            }
            if (member.nickname && member.nickname.toUpperCase().startsWith(`[${oldName}]`)) {
                await member.setNickname(`[${newName}] ${member.user.username}`).catch(nickError => {
                    if (nickError.code !== 50013) logger.info(`Could not update nickname for ${member.user.tag}: ${nickError.message}`);
                });
            } else if (memberId === rows[0].owner_id) {
                await member.setNickname(`[${newName}] ${member.user.username}`).catch(() => {});
            }
        } catch (fetchError) {
            if (fetchError.code !== 10007) logger.info(`Could not fetch ${memberId} for rename cleanup: ${fetchError.message}`);
        }
    }
    return renamed;
}

module.exports = {
    renameGate,
    renameSquadRows,
    data: new SlashCommandBuilder()
        .setName('squad-rename')
        .setDescription('Change the name of your squad if you are the squad leader.')
        .addStringOption(option =>
            option.setName('new-name')
                .setDescription('The new name for your squad. (1-4 alphanumeric characters)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('Current squad name (required if you own multiple)')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        const newSquadName = interaction.options.getString('new-name').toUpperCase();
        const guild = interaction.guild;

        try {
            const ownedSquads = await squadDb.fetchSquadsByOwner(userId);
            const { squad, error } = squadDb.disambiguateOwnedSquad(ownedSquads, interaction.options.getString('squad'));
            if (error) {
                return interaction.editReply(notice('No Squad Owned', error));
            }

            const nameHolders = await squadDb.fetchSquadsByName(newSquadName);
            const gate = renameGate({ userId, newName: newSquadName, targetSquad: squad, nameHolders });
            if (!gate.ok) {
                const copy = {
                    BAD_NAME: 'The name must be between 1 and 4 alphanumeric characters.',
                    SAME_NAME: 'That is already your squad name.',
                    NAME_TAKEN: `The squad name **${newSquadName}** is already taken.`,
                }[gate.code];
                return interaction.editReply(notice('Invalid Squad Name', copy));
            }

            const rowsToRename = ownedSquads.filter((s) => s.name === squad.name);
            const oldName = squad.name;
            let renamed;
            try {
                renamed = await renameSquadRows(interaction.client, guild, rowsToRename, newSquadName, {
                    notifyLines: (from, to) => [`Your squad **${from}** has been renamed to **${to}** by the squad leader.`],
                });
            } catch (renameErr) {
                if (renameErr.code === '23505') {
                    return interaction.editReply(notice('Name Taken', `The squad name **${newSquadName}** was just taken. Pick another.`));
                }
                throw renameErr;
            }
            if (!renamed) {
                return interaction.editReply(notice('Rename Failed', 'Your squad could not be found. No changes were made.'));
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Squad Renamed',
                    subtitle: 'Squad Activity',
                    lines: [`**${userTag}** (<@${userId}>) renamed squad **${oldName}** to **${newSquadName}**.`],
                });
                if (block) logContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                logger.error('Failed to log squad rename:', logError);
            }

            return interaction.editReply(notice('Squad Renamed', `Your squad **${oldName}** is now **${newSquadName}**. Members were notified and nicknames updated where possible.`));
        } catch (error) {
            logger.error(`Error during /squad rename for ${userTag}:`, error);
            return interaction.editReply(notice('Rename Failed', `An error occurred: ${error.message || 'Please try again later.'}`)).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
