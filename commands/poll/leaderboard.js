'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { getLeaderboard } = require('../../db');
const { BOARD_LABEL } = require('../../utils/poll_view');

const BOARD_CHOICES = [
    { name: 'Gameplay', value: 'gameplay' },
    { name: 'Skins', value: 'skins' },
    { name: 'Bugs', value: 'bugs' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Live community top ideas and bugs')
        .addStringOption((o) => o.setName('board').setDescription('Which board').setRequired(true).addChoices(...BOARD_CHOICES)),

    async execute(interaction) {
        const board = interaction.options.getString('board');
        await interaction.deferReply();

        const rows = await getLeaderboard(board, 10);
        const lines = rows.length
            ? rows.map((r, i) => {
                const voters = Number(r.voters);
                return `**${i + 1}.** [${r.title || 'Untitled'}](${r.url}) - **${r.points}** pts (${voters} voter${voters === 1 ? '' : 's'})`;
            })
            : ['_No votes yet. Be the first with_ `/myideas add`.'];

        const container = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [`## Community Top 10 - ${BOARD_LABEL[board] || board}`, '', ...lines].join('\n')
            )
        );
        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
    },
};
