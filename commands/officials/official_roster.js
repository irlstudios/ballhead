'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, MessageFlags, ContainerBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload, buildTextBlock } = require('../../utils/ui');
const {
    upsertRosterOfficial,
    removeRosterOfficial,
    fetchAllRosterOfficials,
} = require('../../db');
const { resolveOfficialTier } = require('../../utils/league_officials');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('official-roster')
        .setDescription('Manage the officials roster the bot assigns from (staff only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand((sub) =>
            sub.setName('add')
                .setDescription('Add or update an official on the roster')
                .addUserOption((o) => o.setName('user').setDescription('The official').setRequired(true))
                .addStringOption((o) => o.setName('sports').setDescription('Sports they cover, or "Any"').setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('remove')
                .setDescription('Remove an official from the roster')
                .addUserOption((o) => o.setName('user').setDescription('The official').setRequired(true)))
        .addSubcommand((sub) =>
            sub.setName('list')
                .setDescription('List all roster officials')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // setDefaultMemberPermissions is an overridable UI hint, not a guarantee.
        // Enforce the real gate here.
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return interaction.editReply(
                noticePayload('You do not have permission to manage the officials roster.', { title: 'Permission Denied', subtitle: 'Officials Roster' })
            );
        }

        try {
            const sub = interaction.options.getSubcommand();

            if (sub === 'list') {
                const roster = await fetchAllRosterOfficials();
                if (roster.length === 0) {
                    return interaction.editReply(
                        noticePayload('The officials roster is empty. Add one with `/official-roster add`.', { title: 'Roster Empty', subtitle: 'Officials Roster' })
                    );
                }
                const lines = roster.map((o) =>
                    `- <@${o.official_id}> - ${o.tier || 'Unlisted'} - ${o.sports || 'Any'}${o.is_available ? '' : ' (unavailable)'}`
                );
                const container = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Officials Roster', subtitle: `${roster.length} official(s)`, lines });
                if (block) container.addTextDisplayComponents(block);
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
            }

            const target = interaction.options.getUser('user');

            if (sub === 'remove') {
                const removed = await removeRosterOfficial(target.id);
                return interaction.editReply(
                    noticePayload(
                        removed ? `Removed <@${target.id}> from the roster.` : `<@${target.id}> was not on the roster.`,
                        { title: removed ? 'Official Removed' : 'Not Found', subtitle: 'Officials Roster' }
                    )
                );
            }

            // add
            const sports = interaction.options.getString('sports') || 'Any';
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            const tier = member ? resolveOfficialTier(member.roles.cache) : null;

            await upsertRosterOfficial({
                officialId: target.id,
                username: target.username,
                sports,
                tier,
                addedBy: interaction.user.id,
            });

            return interaction.editReply(
                noticePayload(
                    `Added <@${target.id}> to the roster (${tier || 'Unlisted'}, ${sports}).${tier ? '' : '\n-# Note: this user holds no officials-program role.'}`,
                    { title: 'Official Added', subtitle: 'Officials Roster' }
                )
            );
        } catch (error) {
            logger.error('[Officials Roster] Error:', error);
            return interaction.editReply(
                noticePayload('An error occurred while updating the roster.', { title: 'Roster Update Failed', subtitle: 'Officials Roster' })
            );
        }
    },
};
