const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const db = require('../../db');
const logger = require('../../utils/logger');

// Application rows are deleted when a lead decides, so "a row exists" means
// pending review and "no row" means either never applied or already answered
// by DM. The reply wording reflects exactly that.
const PROGRAMS = [
    { name: 'Official', find: db.findOfficialApplication },
    { name: 'FF Official', find: db.findFfOfficialApplication },
    { name: 'Community Bug Squasher', find: db.findBugSquasherApplication },
    { name: 'Extra Modes Host (EMH)', find: db.findEmhApplication },
    { name: 'Community Design Team', find: db.findCdtApplication },
];

const buildStatusLines = (entries) => {
    if (entries.length === 0) {
        return [
            'You have no applications waiting for review.',
            'If you applied before, a decision has been made — check your DMs, or ask a lead if you never got one.',
            'Browse the programs under **/apply** to get started.',
        ];
    }
    const lines = entries.map((entry) => {
        if (entry.state === 'unavailable') {
            return `**${entry.name}**: could not be checked right now — try again in a bit`;
        }
        const timestamp = entry.submittedAt
            ? ` — submitted <t:${Math.floor(entry.submittedAt.getTime() / 1000)}:R>`
            : '';
        return `**${entry.name}**: pending review${timestamp}`;
    });
    return [...lines, '', 'Decisions are sent by DM once a lead reviews — keep your DMs open.'];
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-status')
        .setDescription('Check the status of your program applications'),
    buildStatusLines,
    PROGRAMS,
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const results = await Promise.all(PROGRAMS.map(async (program) => {
            try {
                const rows = await program.find(interaction.user.id);
                if (!rows || rows.length === 0) return null;
                const submittedAt = rows[0].submitted_at instanceof Date ? rows[0].submitted_at : null;
                return { name: program.name, state: 'pending', submittedAt };
            } catch (error) {
                logger.error(`[Apply Status] Failed to check ${program.name}:`, error);
                return { name: program.name, state: 'unavailable' };
            }
        }));

        const pending = results.filter(Boolean);
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Your Applications'));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(buildStatusLines(pending).join('\n')));
        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
    },
};
