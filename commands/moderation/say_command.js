'use strict';

const { SlashCommandBuilder, ContainerBuilder, MessageFlags } = require('discord.js');
const { buildTextBlock } = require('../../utils/ui');
const { isModerator } = require('../../handlers/room_event_voice');
const { speak } = require('../../utils/voice_tts');

const reply = (interaction, body) => {
    const container = new ContainerBuilder();
    const block = buildTextBlock(body);
    if (block) container.addTextDisplayComponents(block);
    return interaction.deferred
        ? interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] })
        : interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
        });
};

const FAILURE_LINES = {
    unconfigured: 'Text-to-speech is not configured on the host (PIPER_BIN / PIPER_MODEL).',
    busy: 'The bot is already speaking; try again in a moment.',
    'capturing-elsewhere': 'The bot is capturing a live event in another channel and cannot leave it.',
    failed: 'Speech synthesis failed; check the bot log.',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Make the bot speak in your voice channel (moderators only).')
        .addStringOption((option) =>
            option.setName('text').setDescription('What to say').setRequired(true).setMaxLength(300)),
    async execute(interaction) {
        const subtitle = 'Bot Voice';
        if (!isModerator([...interaction.member.roles.cache.keys()])) {
            return reply(interaction, {
                title: 'Access Denied', subtitle,
                lines: ['Only moderators can use this command.'],
            });
        }
        const channel = interaction.member.voice.channel;
        if (!channel) {
            return reply(interaction, {
                title: 'Voice Channel Required', subtitle,
                lines: ['Join the voice channel you want the bot to speak in first.'],
            });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await speak({ channel, text: interaction.options.getString('text') });
        if (!result.ok) {
            return reply(interaction, { title: 'Cannot Speak', subtitle, lines: [FAILURE_LINES[result.reason]] });
        }
        return reply(interaction, { title: 'Spoken', subtitle, lines: [`Said it in **${channel.name}**.`] });
    },
};
