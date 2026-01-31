const { SlashCommandBuilder, MessageFlags, ContainerBuilder, ModalBuilder, LabelBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle, TextDisplayBuilder } = require('discord.js');

function buildTextBlock({ title, subtitle, lines } = {}) {
    const parts = [];
    if (title) {
        parts.push(`## ${title}`);
    }
    if (subtitle) {
        parts.push(subtitle);
    }
    if (Array.isArray(lines) && lines.length > 0) {
        if (parts.length > 0) {
            parts.push('');
        }
        parts.push(...lines.filter(Boolean));
    }
    if (parts.length === 0) {
        return null;
    }
    return new TextDisplayBuilder().setContent(parts.join('\n'));
}

const RANKED_COACH_ROLES = [
    '1273704152777883698',
    '1419458741006499961',
    '1312965840974643320',
    '1378911501712363701',
    '981933984453890059',
    '1317633044286406729',
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('log-ranked-session')
        .setDescription('Log a ranked coaching session'),
    async execute(interaction) {
        const hasRole = interaction.member?.roles?.cache?.some(role => RANKED_COACH_ROLES.includes(role.id));
        if (!hasRole) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Access Denied', subtitle: 'Ranked Coaching Only', lines: ['You do not have permission to log ranked sessions.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            return;
        }

        const coachInput = new TextInputBuilder()
            .setCustomId('coachName')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Coach in-game name');

        const participantsInput = new TextInputBuilder()
            .setCustomId('participantsName')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Participants: name1, name2, name3');

        const attemptsInput = new TextInputBuilder()
            .setCustomId('madeAttempts')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Enter a number between 0 and 10');

        const skillSelect = new StringSelectMenuBuilder()
            .setCustomId('rankSkill')
            .setPlaceholder('Select Rank Skill')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Midrange One Dribble Jump Shot (Freethrow)')
                    .setValue('midrange_one_dribble_jump_shot_freethrow'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Midrange Catch and Shoot Jumpshot (Freethrow)')
                    .setValue('midrange_catch_and_shoot_jumpshot_freethrow'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Midrange One Dribble Jump Shot (Right Elbow)')
                    .setValue('midrange_one_dribble_jump_shot_right_elbow'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Midrange One Dribble Jump shot (Left Elbow)')
                    .setValue('midrange_one_dribble_jump_shot_left_elbow'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Perimeter Catch and Shoot (Top of The key)')
                    .setValue('perimeter_catch_and_shoot_top_key'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Perimeter One Dribble Jump Shot (Top of The key)')
                    .setValue('perimeter_one_dribble_jump_shot_top_key')
            );

        const passFailSelect = new StringSelectMenuBuilder()
            .setCustomId('passFail')
            .setPlaceholder('Select Pass/Fail')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Pass')
                    .setValue('pass'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Fail')
                    .setValue('fail')
            );

        const modal = new ModalBuilder()
            .setCustomId('rankedSessionModal')
            .setTitle('Log Ranked Session')
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel('Coach In-game Name')
                    .setDescription('Use the coach in-game name.')
                    .setTextInputComponent(coachInput),
                new LabelBuilder()
                    .setLabel('Participants In-game Name(s)')
                    .setDescription('List all participants in the session.')
                    .setTextInputComponent(participantsInput),
                new LabelBuilder()
                    .setLabel('Made Attempts (out of 10)')
                    .setDescription('Enter the number of makes.')
                    .setTextInputComponent(attemptsInput),
                new LabelBuilder()
                    .setLabel('Rank Skill')
                    .setDescription('Select the skill evaluated.')
                    .setStringSelectMenuComponent(skillSelect),
                new LabelBuilder()
                    .setLabel('Pass/Fail')
                    .setDescription('Did the participant pass? (5+ makes = Pass)')
                    .setStringSelectMenuComponent(passFailSelect)
            );

        await interaction.showModal(modal);
    }
};
