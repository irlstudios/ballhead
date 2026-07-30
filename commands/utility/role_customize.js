'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { noticePayload } = require('../../utils/ui');
const logger = require('../../utils/logger');
const {
    OFFICIAL_ROLE_IDS,
    FF_OFFICIAL_ROLE_ID,
    COMMUNITY_BUG_SQUASHER_ROLE_ID,
    HOST_ROLE_ID,
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
    SPONSORED_LEAGUE_ROLE_ID,
    LEAGUE_OWNER_ROLE_ID,
    LEAGUE_CO_OWNER_ROLE_ID,
    LEVEL_5_ROLE_ID,
    HIGHER_LEVEL_ROLES,
    SQUAD_OWNER_ROLES,
    TOP_COMP_SQUAD_ROLE_ID,
    BOOSTER_ROLE_ID,
    MODERATOR_ROLES,
    PROGRAM_ROLE_IDS,
} = require('../../config/constants');
const { compSquadLevelRoles, mascotSquads } = require('../../config/squads');
const { RANK_ROLE_IDS } = require('../../jobs/rank-role-sync');

const SUBTITLE = 'Role Customization';

// Roles another system owns: squad and league records in the sheets, program
// membership tracking, moderation, and the nightly level sync. Self-removal
// would either desync those records or be undone by the next sync run, so they
// stay off the menu and only staff tooling can change them.
const PROTECTED_ROLE_IDS = new Set([
    ...OFFICIAL_ROLE_IDS,
    ...PROGRAM_ROLE_IDS,
    ...MODERATOR_ROLES,
    ...HIGHER_LEVEL_ROLES,
    ...SQUAD_OWNER_ROLES,
    ...compSquadLevelRoles,
    ...mascotSquads.map(squad => squad.roleId),
    ...RANK_ROLE_IDS,
    FF_OFFICIAL_ROLE_ID,
    COMMUNITY_BUG_SQUASHER_ROLE_ID,
    HOST_ROLE_ID,
    BASE_LEAGUE_ROLE_ID,
    ACTIVE_LEAGUE_ROLE_ID,
    SPONSORED_LEAGUE_ROLE_ID,
    LEAGUE_OWNER_ROLE_ID,
    LEAGUE_CO_OWNER_ROLE_ID,
    LEVEL_5_ROLE_ID,
    TOP_COMP_SQUAD_ROLE_ID,
    BOOSTER_ROLE_ID,
]);

// A role is self-removable when the member holds it, it is not @everyone, not
// owned by an integration (bot or boost roles), not system-owned, and sits below
// the bot in the hierarchy so the API will actually accept the removal.
function isRemovable(role, member, botHighestPosition) {
    return role.id !== member.guild.id
        && !role.managed
        && !PROTECTED_ROLE_IDS.has(role.id)
        && role.position < botHighestPosition;
}

function removableRoles(member, botHighestPosition) {
    return [...member.roles.cache.values()]
        .filter(role => isRemovable(role, member, botHighestPosition))
        .sort((a, b) => b.position - a.position);
}

async function botHighestPosition(guild) {
    const me = guild.members.me || await guild.members.fetchMe();
    return me.roles.highest.position;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-customize')
        .setDescription('Manage the optional roles on your own account.')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('What to do with the role')
                .setRequired(true)
                .addChoices({ name: 'remove', value: 'remove' }))
        .addStringOption(option =>
            option.setName('role')
                .setDescription('One of your own roles')
                .setRequired(true)
                .setAutocomplete(true)),

    async autocomplete(interaction) {
        try {
            const query = interaction.options.getFocused().toLowerCase();
            const choices = removableRoles(interaction.member, await botHighestPosition(interaction.guild))
                .filter(role => role.name.toLowerCase().includes(query))
                .slice(0, 25)
                .map(role => ({ name: role.name.slice(0, 100), value: role.id }));
            await interaction.respond(choices);
        } catch (error) {
            logger.error('[Role Customize] Autocomplete error:', error);
            await interaction.respond([]).catch(() => {});
        }
    },

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                ...noticePayload('Use this command in the server.', { title: 'Server Only', subtitle: SUBTITLE }),
                ephemeral: true,
            });
        }

        const roleId = interaction.options.getString('role');

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const role = member.roles.cache.get(roleId);

            if (!role) {
                return interaction.reply({
                    ...noticePayload('You do not have that role. Pick one from the list the command suggests.', { title: 'Role Not on Your Account', subtitle: SUBTITLE }),
                    ephemeral: true,
                });
            }

            if (!isRemovable(role, member, await botHighestPosition(interaction.guild))) {
                return interaction.reply({
                    ...noticePayload(`**${role.name}** is managed by staff or another Ballhead system, so it cannot be removed here.`, { title: 'Role Protected', subtitle: SUBTITLE }),
                    ephemeral: true,
                });
            }

            await member.roles.remove(role, `Self-removed via /role-customize by ${interaction.user.tag}`);
            logger.info(`[Role Customize] ${interaction.user.tag} (${interaction.user.id}) removed role ${role.name} (${role.id})`);

            return interaction.reply({
                ...noticePayload(`Removed **${role.name}** from your account.`, { title: 'Role Removed', subtitle: SUBTITLE }),
                ephemeral: true,
            });
        } catch (error) {
            logger.error(`[Role Customize] Failed to remove role ${roleId} for ${interaction.user.id}:`, error);
            return interaction.reply({
                ...noticePayload('Could not update your roles. Please try again later.', { title: 'Request Failed', subtitle: SUBTITLE }),
                ephemeral: true,
            }).catch(() => {});
        }
    },

    PROTECTED_ROLE_IDS,
    isRemovable,
    removableRoles,
};
