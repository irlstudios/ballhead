'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const {
    GYM_CLASS_GUILD_ID,
    BOT_BUGS_CHANNEL_ID,
    SQUAD_LEADER_ROLE_ID,
    COMPETITIVE_SQUAD_OWNER_ROLE_ID,
    LEVEL_5_ROLE_ID,
} = require('../../config/constants');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

// Pure registration gate over squad_db rows so every rule is unit-testable.
// Rules preserved from the sheet era: one Casual + one Competitive per owner
// and they must share a name; members must leave before creating; a name
// held by a different owner is taken. New: B-team creation is retired (its
// level-50 gate died with the wins scrap).
function registrationGate({ userId, squadName, squadType, ownedSquads, membership, nameHolders }) {
    if (!/^[A-Z0-9]{1,4}$/.test(squadName)) {
        return { ok: false, code: 'BAD_NAME' };
    }
    const ownsCasual = ownedSquads.find((s) => s.squad_type === 'Casual');
    const ownsComp = ownedSquads.find((s) => s.squad_type === 'Competitive');
    if (squadType === 'Casual' && ownsCasual) {
        return { ok: false, code: 'HAS_CASUAL' };
    }
    if (squadType === 'Casual' && ownsComp && ownsComp.name !== squadName) {
        return { ok: false, code: 'NAME_MISMATCH', expected: ownsComp.name };
    }
    if (squadType === 'Competitive' && ownsComp) {
        return { ok: false, code: 'BTEAM_CLOSED' };
    }
    if (squadType === 'Competitive' && ownsCasual && ownsCasual.name !== squadName) {
        return { ok: false, code: 'NAME_MISMATCH', expected: ownsCasual.name };
    }
    if (membership && ownedSquads.length === 0) {
        return { ok: false, code: 'IN_A_SQUAD' };
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
        new TextDisplayBuilder().setContent(lines)
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true };
}

const GATE_COPY = {
    BAD_NAME: ['Invalid Squad Name', 'Squad names must be 1 to 4 letters (A-Z) or numbers (0-9).'],
    HAS_CASUAL: ['Already Own a Casual Squad', 'You already own a Casual squad.'],
    BTEAM_CLOSED: ['B Teams Closed', 'You already own a Competitive squad. Creating a second one (B team) is currently closed.'],
    IN_A_SQUAD: ['Leave Your Squad First', 'You must leave your current squad before creating one.'],
    NAME_TAKEN: ['Squad Tag Taken', 'That squad tag is already taken.'],
};

module.exports = {
    cooldown: 604800,
    data: new SlashCommandBuilder()
        .setName('squad-register')
        .setDescription('Register a new Squad.')
        .addStringOption(option =>
            option.setName('squadname')
                .setDescription('The desired name/tag for your Squad (1-4 alphanumeric chars).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('squadtype')
                .setDescription('Select the intended type for your Squad.')
                .setRequired(true)
                .addChoices(
                    { name: 'Casual', value: 'Casual' },
                    { name: 'Competitive', value: 'Competitive' },
                )),

    registrationGate,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const hasRequiredRole = interaction.member.roles.cache.has(LEVEL_5_ROLE_ID);
        if (!hasRequiredRole) {
            return interaction.editReply(notice('Role Required', `You must have the <@&${LEVEL_5_ROLE_ID}> role to register a squad.`));
        }

        const squadName = interaction.options.getString('squadname').toUpperCase();
        const squadType = interaction.options.getString('squadtype');
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userTag = interaction.user.tag;

        try {
            const ownedSquads = await squadDb.fetchSquadsByOwner(userId);
            const membership = await squadDb.fetchMembership(userId);
            const nameHolders = await squadDb.fetchSquadsByName(squadName);

            const gate = registrationGate({ userId, squadName, squadType, ownedSquads, membership, nameHolders });
            if (!gate.ok) {
                if (gate.code === 'NAME_MISMATCH') {
                    return interaction.editReply(notice(
                        'Name Must Match',
                        `Your ${squadType} squad must share the same name as your other squad (${gate.expected}).`
                    ));
                }
                const [title, line] = GATE_COPY[gate.code];
                return interaction.editReply(notice(title, line));
            }

            const squadLeaderRole = interaction.guild.roles.cache.get(SQUAD_LEADER_ROLE_ID);
            const competitiveRole = interaction.guild.roles.cache.get(COMPETITIVE_SQUAD_OWNER_ROLE_ID);
            if (!squadLeaderRole || !competitiveRole) {
                return interaction.editReply(notice('Configuration Error', 'Required squad leader roles are missing.'));
            }

            let created;
            try {
                created = await squadDb.createSquad({ name: squadName, squadType, ownerId: userId, ownerUsername: username });
            } catch (err) {
                // Unique-index backstop: lost a name race to a concurrent registration.
                if (err.code === '23505') {
                    return interaction.editReply(notice('Squad Tag Taken', `The squad tag **${squadName}** is already taken.`));
                }
                throw err;
            }

            // The (name, type) unique index cannot stop a DIFFERENT owner
            // registering the same name under the other type concurrently.
            // Re-check after insert and compensate, so a name never splits
            // across owners.
            const holdersAfter = await squadDb.fetchSquadsByName(squadName);
            if (holdersAfter.some((s) => String(s.owner_id) !== String(userId))) {
                // Compensation must actually land: a swallowed failure here
                // would keep the row while telling the user it was rejected,
                // recreating the split-owner state this check exists to stop.
                // A throw falls through to the outer catch, which logs and
                // reports the error.
                await squadDb.disbandSquad(created.id, { ownerId: userId });
                return interaction.editReply(notice('Squad Tag Taken', `The squad tag **${squadName}** is already taken.`));
            }

            try {
                await interaction.member.roles.add(squadLeaderRole);
                if (squadType === 'Competitive') await interaction.member.roles.add(competitiveRole);
            } catch (roleError) {
                logger.warn(`Failed to add roles to ${username} (${userId}): ${roleError.message}`);
                await interaction.followUp(notice(
                    'Role Assignment Failed',
                    'Squad created, but some roles could not be assigned.\nPlease check permissions and assign manually.'
                ));
            }

            try {
                await interaction.member.setNickname(`[${squadName}] ${interaction.member.user.username}`);
            } catch (nickError) {
                logger.warn(`Failed to set nickname for ${username}: ${nickError.message}`);
                await interaction.followUp(notice('Nickname Update Failed', 'Squad created, but nickname could not be updated due to permissions.'));
            }

            try {
                const dmContainer = new ContainerBuilder();
                dmContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Squad Registered\n${squadName}`),
                    new TextDisplayBuilder().setContent(`Your squad **${squadName}** (${squadType}) has been registered.`)
                );
                await interaction.user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
            } catch (dmError) {
                logger.warn(`Failed to send registration DM to ${username}: ${dmError.message}`);
            }

            return interaction.editReply(notice(
                `Squad Registered\n${squadName}`,
                `Squad **${squadName}** (${squadType}) has been registered and configured.`
            ));
        } catch (error) {
            logger.error(`Error processing /squad register command for ${userTag} (${userId}):`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                errorContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Squad Registration Error\n${userTag}`),
                    new TextDisplayBuilder().setContent(`**User:** ${userTag} (${userId})\n**Error:** ${error.message}`)
                );
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error('Failed to log registration error to Discord:', logError);
            }
            return interaction.editReply(notice(
                'Registration Failed',
                `An error occurred while registering your squad: ${error.message || 'Please try again later or contact an admin.'}`
            )).catch(logger.error);
        }
    },
};
