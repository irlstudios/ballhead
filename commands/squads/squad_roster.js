'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

function isoDate(value) {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(time) ? 'unknown' : new Date(time).toISOString().slice(0, 10);
}

// Pure roster body: owner line, capacity, members with join dates. Wins and
// levels were scrapped 2026-08, so no per-member stats render here.
function buildRosterLines(squad, members) {
    const lines = [
        `**Type:** ${squad.squad_type}`,
        `**Owner:** <@${squad.owner_id}>${squad.owner_username ? ` (${squad.owner_username})` : ''}`,
        `**Formed:** ${isoDate(squad.created_at)}`,
        `**Members:** ${members.length + 1}/${squadDb.MAX_SQUAD_MEMBERS}`,
        '',
    ];
    if (members.length === 0) {
        lines.push('No members yet (just the owner).');
    } else {
        for (const m of members) {
            lines.push(`- ${m.username || `<@${m.user_id}>`} - joined ${isoDate(m.joined_at)}`);
        }
    }
    return lines;
}

module.exports = {
    buildRosterLines,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('squad-roster')
        .setDescription('View a squad\'s roster.')
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('Squad name (defaults to your own squad)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        const requestedName = interaction.options.getString('squad');
        const userId = interaction.user.id;

        try {
            let squad = null;
            if (requestedName) {
                const rows = await squadDb.fetchSquadsByName(requestedName);
                // A Casual+Competitive pair shares members on the Competitive
                // row (where the import attached them).
                squad = rows.find((s) => s.squad_type === 'Competitive') || rows[0] || null;
            } else {
                const owned = await squadDb.fetchSquadsByOwner(userId);
                if (owned.length > 0) {
                    squad = owned.find((s) => s.squad_type === 'Competitive') || owned[0];
                } else {
                    const membership = await squadDb.fetchMembership(userId);
                    squad = membership ? membership.squad : null;
                }
            }

            if (!squad) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Not Found'),
                    new TextDisplayBuilder().setContent(requestedName
                        ? `Could not find a squad named "**${requestedName}**".`
                        : 'You are not in a squad. Provide a squad name to look one up.')
                );
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
            }

            const members = await squadDb.fetchSquadMembers(squad.id);
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${squad.name} Roster`),
                new TextDisplayBuilder().setContent(buildRosterLines(squad, members).join('\n'))
            );
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        } catch (error) {
            logger.error(`Error fetching roster for ${requestedName || userId}:`, error);
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Roster Error\nSquad Roster'),
                new TextDisplayBuilder().setContent('An unexpected error occurred while trying to fetch the squad roster.\nPlease try again later or contact an admin.')
            );
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        }
    },
};
