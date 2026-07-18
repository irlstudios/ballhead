'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const {
    fetchLeaguesByOwner,
    fetchLeagueById,
    insertStrike,
    countActiveStrikes,
    fetchActiveStrikes,
    fetchStrikeById,
    resolveStrike,
    setLeagueHealthStatus,
} = require('../../db');
const { deriveHealthStatus } = require('../../utils/league_enforcement');

const SUB = 'League Strikes';

async function refreshHealth(leagueId) {
    const count = await countActiveStrikes(leagueId);
    await setLeagueHealthStatus(leagueId, deriveHealthStatus(count));
}

async function dmOwner(client, userId, lines) {
    try {
        const { ContainerBuilder, MessageFlags } = require('discord.js');
        const { buildTextBlock } = require('../../utils/ui');
        const user = await client.users.fetch(String(userId));
        const container = new ContainerBuilder();
        const block = buildTextBlock({ title: 'League Strike', subtitle: SUB, lines });
        if (block) container.addTextDisplayComponents(block);
        await user.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    } catch (error) {
        logger.info(`[Strikes] Could not DM owner ${userId}: ${error.message}`);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('league-strike')
        .setDescription('Manage league strikes (staff)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand((s) => s
            .setName('add')
            .setDescription('Issue a strike against a league')
            .addUserOption((o) => o.setName('owner').setDescription('The league owner').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Reason for the strike').setRequired(true).setMaxLength(400)))
        .addSubcommand((s) => s
            .setName('list')
            .setDescription('List a league\'s active strikes')
            .addUserOption((o) => o.setName('owner').setDescription('The league owner').setRequired(true)))
        .addSubcommand((s) => s
            .setName('resolve')
            .setDescription('Resolve (lift) a strike by id')
            .addIntegerOption((o) => o.setName('id').setDescription('Strike id').setRequired(true))),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return interaction.reply({
                ...noticePayload('You do not have permission to manage strikes.', { title: 'Permission Denied', subtitle: SUB }),
                ephemeral: true,
            });
        }
        await interaction.deferReply({ ephemeral: true });

        try {
            const sub = interaction.options.getSubcommand();

            if (sub === 'add') {
                const owner = interaction.options.getUser('owner');
                const reason = interaction.options.getString('reason');
                const league = (await fetchLeaguesByOwner(owner.id))[0] || null;
                if (!league) {
                    return interaction.editReply(noticePayload(`<@${owner.id}> does not own a registered league.`, { title: 'No League Found', subtitle: SUB }));
                }
                const strike = await insertStrike({ leagueId: league.league_id, reason, issuedBy: interaction.user.id });
                await refreshHealth(league.league_id);
                const active = await countActiveStrikes(league.league_id);
                await dmOwner(interaction.client, owner.id, [
                    `Your league **${league.league_name}** received a strike.`,
                    `**Reason:** ${reason}`,
                    `You now have **${active}** active strike(s). You may appeal with \`/league-appeal\`.`,
                ]);
                return interaction.editReply(noticePayload(
                    [`Strike **#${strike.id}** issued against **${league.league_name}**.`, `Active strikes: **${active}**.`],
                    { title: 'Strike Issued', subtitle: SUB }
                ));
            }

            if (sub === 'list') {
                const owner = interaction.options.getUser('owner');
                const league = (await fetchLeaguesByOwner(owner.id))[0] || null;
                if (!league) {
                    return interaction.editReply(noticePayload(`<@${owner.id}> does not own a registered league.`, { title: 'No League Found', subtitle: SUB }));
                }
                const strikes = await fetchActiveStrikes(league.league_id);
                if (strikes.length === 0) {
                    return interaction.editReply(noticePayload('No active strikes.', { title: league.league_name, subtitle: SUB }));
                }
                const lines = strikes.map((s) => `- **#${s.id}** — ${s.reason}`);
                return interaction.editReply(noticePayload(lines, { title: `${league.league_name} — active strikes`, subtitle: SUB }));
            }

            // resolve
            const strikeId = interaction.options.getInteger('id');
            const existing = await fetchStrikeById(strikeId);
            if (!existing) {
                return interaction.editReply(noticePayload('No strike with that id.', { title: 'Not Found', subtitle: SUB }));
            }
            const resolved = await resolveStrike(strikeId, interaction.user.id);
            if (!resolved) {
                return interaction.editReply(noticePayload('That strike is already resolved.', { title: 'Already Resolved', subtitle: SUB }));
            }
            await refreshHealth(resolved.league_id);
            const league = await fetchLeagueById(resolved.league_id);
            return interaction.editReply(noticePayload(
                `Strike #${strikeId} resolved for **${league?.league_name || `league ${resolved.league_id}`}**.`,
                { title: 'Strike Resolved', subtitle: SUB }
            ));
        } catch (error) {
            logger.error('[Strikes] league-strike failed:', error);
            return interaction.editReply(noticePayload('An error occurred while managing strikes.', { title: 'Strike Error', subtitle: SUB }));
        }
    },
};
