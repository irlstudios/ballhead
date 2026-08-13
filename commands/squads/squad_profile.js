'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

const DESCRIPTION_MAX = 150;

// Pure gate: at least one field, description within the cap. Choice validity
// is enforced by the slash-option choices upstream.
function profileGate({ description = null, playstyle = null, region = null, recruiting = null } = {}) {
    if (!description && !playstyle && !region && !recruiting) {
        return { ok: false, code: 'NOTHING' };
    }
    if (description && description.length > DESCRIPTION_MAX) {
        return { ok: false, code: 'TOO_LONG' };
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
    profileGate,
    DESCRIPTION_MAX,
    data: new SlashCommandBuilder()
        .setName('squad-profile')
        .setDescription('Set your squad\'s public profile shown in /squad browse.')
        .addStringOption((o) => o.setName('description').setDescription(`Short blurb about your squad (max ${DESCRIPTION_MAX} chars)`).setRequired(false).setMaxLength(DESCRIPTION_MAX))
        .addStringOption((o) => o.setName('playstyle').setDescription('How your squad plays').setRequired(false)
            .addChoices({ name: 'Chill', value: 'Chill' }, { name: 'Competitive', value: 'Competitive' }, { name: 'Grind', value: 'Grind' }))
        .addStringOption((o) => o.setName('region').setDescription('Where your squad mostly plays').setRequired(false)
            .addChoices({ name: 'NA', value: 'NA' }, { name: 'EU', value: 'EU' }, { name: 'OCE', value: 'OCE' }, { name: 'ASIA', value: 'ASIA' }))
        .addStringOption((o) => o.setName('recruiting').setDescription('How players can join').setRequired(false)
            .addChoices({ name: 'Open (anyone can join instantly)', value: 'Open' }, { name: 'Apply (you approve applications)', value: 'Apply' }, { name: 'Invite-only', value: 'Invite-only' }))
        .addStringOption((o) => o.setName('squad').setDescription('Squad name (required if you own multiple)').setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const fields = {
            description: interaction.options.getString('description'),
            playstyle: interaction.options.getString('playstyle'),
            region: interaction.options.getString('region'),
            recruiting: interaction.options.getString('recruiting'),
        };

        try {
            const gate = profileGate(fields);
            if (!gate.ok) {
                const copy = {
                    NOTHING: 'Provide at least one field to update (description, playstyle, region, or recruiting).',
                    TOO_LONG: `Description must be ${DESCRIPTION_MAX} characters or fewer.`,
                }[gate.code];
                return interaction.editReply(notice('Nothing Updated', copy));
            }

            const ownedSquads = await squadDb.fetchSquadsByOwner(userId);
            const { squad, error } = squadDb.disambiguateOwnedSquad(ownedSquads, interaction.options.getString('squad'));
            if (error) {
                return interaction.editReply(notice('No Squad Found', error));
            }

            const updated = await squadDb.updateSquadProfile(squad.name, userId, fields);
            if (updated.length === 0) {
                return interaction.editReply(notice('Update Failed', 'Your squad could not be found. No changes were made.'));
            }

            const lines = ['Profile updated.'];
            if (fields.description) lines.push(`**Description:** ${fields.description}`);
            if (fields.playstyle) lines.push(`**Playstyle:** ${fields.playstyle}`);
            if (fields.region) lines.push(`**Region:** ${fields.region}`);
            if (fields.recruiting) lines.push(`**Recruiting:** ${fields.recruiting}`);
            lines.push('', 'Players see this in `/squad browse`.');
            return interaction.editReply(notice(`${squad.name} Profile`, lines));
        } catch (error) {
            logger.error(`[Squad Profile] Error for ${userId}:`, error);
            return interaction.editReply(notice('Update Failed', 'An error occurred while updating your squad profile.')).catch(() => {});
        }
    },
};
