'use strict';

const {
    SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const squadDb = require('../../utils/squad_db');
const logger = require('../../utils/logger');

const PAGE_SIZE = 5;

// Pure: turn browse rows into pages of entries. An entry is joinable when the
// squad recruits (Open or Apply) and has room; NULL recruiting is legacy data
// and reads Invite-only.
function buildBrowsePages(squads) {
    const entries = (squads || []).map((squad) => {
        const recruiting = squad.recruiting || 'Invite-only';
        const capacity = `${squad.member_count + 1}/${squadDb.MAX_SQUAD_MEMBERS}`;
        const hasRoom = squad.member_count < squadDb.MAX_SQUAD_MEMBERS - 1;
        const joinable = (recruiting === 'Open' || recruiting === 'Apply') && hasRoom;
        const tagBits = [squad.playstyle, squad.region].filter(Boolean).join(' · ');
        const lines = [
            `**${squad.name}** (${squad.squad_type}) — ${capacity} members · ${recruiting}${tagBits ? ` · ${tagBits}` : ''}`,
        ];
        if (squad.description) {
            lines.push(`-# ${squad.description}`);
        }
        return { squad, joinable, recruiting, lines };
    });

    const pages = [];
    for (let i = 0; i < entries.length; i += PAGE_SIZE) {
        pages.push({ entries: entries.slice(i, i + PAGE_SIZE) });
    }
    return pages;
}

// Shared renderer, also used by the pagination/select handler.
function renderBrowsePage(pages, pageIndex) {
    const page = pages[pageIndex];
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## Squad Browser'),
        new TextDisplayBuilder().setContent(page.entries.flatMap((e) => e.lines).join('\n')),
        new TextDisplayBuilder().setContent(`-# Page ${pageIndex + 1} of ${pages.length} · Open squads join instantly, Apply squads review your application`)
    );

    const components = [container];
    const joinable = page.entries.filter((e) => e.joinable);
    if (joinable.length > 0) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`squadbrowse:pick:${pageIndex}`)
            .setPlaceholder('Join or apply to a squad on this page')
            .addOptions(joinable.map((e) => ({
                label: `${e.squad.name} — ${e.recruiting === 'Open' ? 'Join now' : 'Apply'}`.slice(0, 100),
                description: `${e.squad.squad_type} · ${e.squad.member_count + 1}/${squadDb.MAX_SQUAD_MEMBERS} members`.slice(0, 100),
                value: String(e.squad.id),
            })));
        components.push(new ActionRowBuilder().addComponents(menu));
    }
    if (pages.length > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`squadbrowse:page:${pageIndex - 1}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(pageIndex === 0),
            new ButtonBuilder().setCustomId(`squadbrowse:page:${pageIndex + 1}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(pageIndex >= pages.length - 1),
        ));
    }
    return { flags: MessageFlags.IsComponentsV2, components, ephemeral: true };
}

module.exports = {
    PAGE_SIZE,
    buildBrowsePages,
    renderBrowsePage,
    data: new SlashCommandBuilder()
        .setName('squad-browse')
        .setDescription('Browse squads that are recruiting and join or apply.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const pages = buildBrowsePages(await squadDb.fetchBrowseSquads());
            if (pages.length === 0) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Browser'),
                    new TextDisplayBuilder().setContent('No squads registered yet. Start one with `/squad register`.')
                );
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            }
            return interaction.editReply(renderBrowsePage(pages, 0));
        } catch (error) {
            logger.error('[Squad Browse] Error:', error);
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Browse Failed'),
                new TextDisplayBuilder().setContent('An error occurred while loading squads. Please try again later.')
            );
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true }).catch(() => {});
        }
    },
};
