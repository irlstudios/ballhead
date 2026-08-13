'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID, MODERATOR_ROLES } = require('../../config/constants');
const { buildTextBlock } = require('../../utils/ui');
const squadDb = require('../../utils/squad_db');
const { renameGate, renameSquadRows } = require('./squad_change_name');
const logger = require('../../utils/logger');

function notice(title, lines) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${title}`),
        new TextDisplayBuilder().setContent(Array.isArray(lines) ? lines.join('\n') : lines)
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-force-name')
        .setDescription('Force-rename a squad (Mods only).')
        .addStringOption(option =>
            option.setName('current-name')
                .setDescription('The squad\'s current name.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('new-name')
                .setDescription('The new name (1-4 alphanumeric characters).')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const moderatorTag = interaction.user.tag;
        const currentName = interaction.options.getString('current-name').toUpperCase();
        const newName = interaction.options.getString('new-name').toUpperCase();
        const guild = interaction.guild;

        const isMod = MODERATOR_ROLES.some(roleId => interaction.member.roles.cache.has(roleId));
        if (!isMod) {
            return interaction.editReply(notice('Access Denied', 'You do not have permission to use this command.'));
        }

        try {
            const rows = await squadDb.fetchSquadsByName(currentName);
            if (rows.length === 0) {
                return interaction.editReply(notice('Squad Not Found', `Squad **${currentName}** does not exist.`));
            }

            const nameHolders = await squadDb.fetchSquadsByName(newName);
            const gate = renameGate({ userId: rows[0].owner_id, newName, targetSquad: rows[0], nameHolders });
            if (!gate.ok) {
                const copy = {
                    BAD_NAME: 'The name must be between 1 and 4 alphanumeric characters.',
                    SAME_NAME: 'That is already the squad\'s name.',
                    NAME_TAKEN: `The squad name **${newName}** is already taken.`,
                }[gate.code];
                return interaction.editReply(notice('Invalid Rename', copy));
            }

            let renamed;
            try {
                renamed = await renameSquadRows(interaction.client, guild, rows, newName, {
                    notifyLines: (from, to) => [`Your squad **${from}** has been renamed to **${to}** by a moderator.`],
                });
            } catch (renameErr) {
                if (renameErr.code === '23505') {
                    return interaction.editReply(notice('Name Taken', `The squad name **${newName}** was just taken.`));
                }
                throw renameErr;
            }
            if (!renamed) {
                return interaction.editReply(notice('Rename Failed', 'The squad could not be found. No changes were made.'));
            }

            try {
                const loggingGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const loggingChannel = await loggingGuild.channels.fetch(LOGGING_CHANNEL_ID);
                const logContainer = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Squad Force Renamed',
                    subtitle: 'Moderator Action',
                    lines: [`**${moderatorTag}** renamed squad **${currentName}** to **${newName}** (owner <@${rows[0].owner_id}>).`],
                });
                if (block) logContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
            } catch (logError) {
                logger.error('Failed to log force rename:', logError);
            }

            return interaction.editReply(notice('Squad Renamed', `Squad **${currentName}** is now **${newName}**. Members were notified and nicknames updated where possible.`));
        } catch (error) {
            logger.error(`Error during /squad force-name for ${moderatorTag}:`, error);
            return interaction.editReply(notice('Rename Failed', `An error occurred: ${error.message || 'Please try again later.'}`)).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
