'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const {
    GYM_CLASS_GUILD_ID, LOGGING_CHANNEL_ID, MODERATOR_ROLES,
} = require('../../config/constants');
const { buildTextBlock } = require('../../utils/ui');
const squadDb = require('../../utils/squad_db');
const { teardownDisbandedSquads } = require('./squad_disband');
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
        .setName('squad-force-disband')
        .setDescription('Force disband a squad by its name (Mods only).')
        .addStringOption(option =>
            option.setName('squad-name')
                .setDescription('The name of the squad to disband.')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const squadNameToDisband = interaction.options.getString('squad-name').toUpperCase();
        const moderatorUserId = interaction.user.id;
        const moderatorUserTag = interaction.user.tag;
        const guild = interaction.guild;

        const member = await guild.members.fetch(moderatorUserId);
        const isMod = MODERATOR_ROLES.some(roleId => member.roles.cache.has(roleId));
        if (!isMod) {
            return interaction.editReply(notice('Access Denied', 'You do not have permission to use this command.'));
        }

        try {
            // Every row holding the name (a Casual+Competitive pair shares one
            // owner by invariant) goes down together, as the sheet era did.
            const rows = await squadDb.fetchSquadsByName(squadNameToDisband);
            if (rows.length === 0) {
                return interaction.editReply(notice('Squad Not Found', `Squad **${squadNameToDisband}** does not exist.`));
            }

            const disbanded = [];
            for (const row of rows) {
                const result = await squadDb.disbandSquad(row.id);
                if (result) disbanded.push(result);
            }
            if (disbanded.length === 0) {
                return interaction.editReply(notice('Already Disbanded', `Squad **${squadNameToDisband}** no longer exists. No changes were made.`));
            }

            await teardownDisbandedSquads(interaction.client, guild, disbanded, { byModerator: true });

            // DM the leader about the moderator action.
            const ownerId = disbanded[0].squad.owner_id;
            try {
                const leaderUser = await interaction.client.users.fetch(ownerId);
                const leaderContainer = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Your Squad Was Disbanded',
                    subtitle: 'Moderator Action',
                    lines: [`Your squad **${squadNameToDisband}** has been forcefully disbanded by a moderator.`],
                });
                if (block) leaderContainer.addTextDisplayComponents(block);
                await leaderUser.send({ flags: MessageFlags.IsComponentsV2, components: [leaderContainer] }).catch(err => logger.info(`Failed to DM leader ${ownerId}: ${err.message}`));
            } catch (fetchError) {
                logger.info(`Could not fetch leader ${ownerId} to DM: ${fetchError.message}`);
            }

            const loggingChannel = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID)
                .then(g => g?.channels.fetch(LOGGING_CHANNEL_ID)).catch(() => null);
            if (loggingChannel) {
                const logContainer = new ContainerBuilder();
                const block = buildTextBlock({
                    title: 'Squad Force Disbanded',
                    subtitle: 'Moderator Action',
                    lines: [`Squad **${squadNameToDisband}** (owner <@${ownerId}>) was force disbanded by **${moderatorUserTag}** (${moderatorUserId}).`],
                });
                if (block) logContainer.addTextDisplayComponents(block);
                await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] }).catch(err => logger.error('Failed to post force-disband log:', err.message));
            }

            return interaction.editReply(notice('Squad Disbanded', [
                `Squad **${squadNameToDisband}** has been forcefully disbanded.`,
                'Members were notified, roles removed, and nicknames reset where possible.',
            ]));
        } catch (error) {
            logger.error(`Error during /squad force-disband for ${moderatorUserTag}:`, error);
            return interaction.editReply(notice('Force Disband Failed', `An error occurred: ${error.message || 'Please try again later.'}`)).catch(err => logger.error('Failed to edit reply:', err));
        }
    },
};
