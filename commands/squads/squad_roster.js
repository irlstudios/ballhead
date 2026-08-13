const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS } = require('../../config/constants');
const logger = require('../../utils/logger');

async function fetchNonCompetitiveRoster(sheets, SPREADSHEET_SQUADS, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction, squadType) {
    try {
        const membersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_SQUADS,
            range: '\'Squad Members\'!A:E',
        });
        const membersData = (membersResponse.data.values || []).slice(1);
        const relevantMembers = membersData.filter(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);

        let memberList = 'No members found.';
        if (relevantMembers.length > 0) {
            memberList = relevantMembers
                .map(row => row[1]?.trim())
                .filter(id => id)
                .map(id => `<@${id}>`)
                .join('\n');
            if (!memberList) memberList = 'No valid member IDs found.';
        }

        const container = new ContainerBuilder()
            .setAccentColor(0x3498DB)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${squadNameInput.toUpperCase()}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**Leader**\n${leaderId ? `<@${leaderId}>` : 'Not found'}`),
                new TextDisplayBuilder().setContent(`**Members**\n${memberList}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# ${squadType || 'Unknown'} • Formed ${squadMade || 'Unknown'}`)
            );

        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });

    } catch (error) {
        logger.error(`Error in fetchNonCompetitiveRoster for ${squadNameInput}:`, error);
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Roster Error\nSquad Roster'),
            new TextDisplayBuilder().setContent('An error occurred while fetching the non-competitive squad roster.')
        );
        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
    }
}


module.exports = {
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('squad-roster')
        .setDescription('Gets the roster for a specific squad')
        .addStringOption(option =>
            option.setName('squad')
                .setDescription('The name of the squad')
                .setRequired(true)
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        const squadNameInput = interaction.options.getString('squad').trim();
        const squadNameNormalized = squadNameInput.toLowerCase();
        const sheets = await getSheetsClient();

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: '\'Squad Leaders\'!A:G',
            });

            const squadLeadersData = (squadLeadersResponse.data.values || []).slice(1);
            const leaderRow = squadLeadersData.find(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);
            if (!leaderRow) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Not Found\n' + squadNameInput),
                    new TextDisplayBuilder().setContent([
                        `Could not find a squad named "**${squadNameInput}**".`,
                        'Please ensure the spelling is correct (case-insensitive).'
                    ].join('\n'))
                );
                await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
                return;
            }

            const leaderId = leaderRow[1]?.trim();
            const squadMade = leaderRow[5]?.trim();

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: '\'All Data\'!A:H',
            });
            const allData = (allDataResponse.data.values || []).slice(1);
            const squadDataRow = allData.find(row => row && row.length > 2 && row[2]?.trim().toLowerCase() === squadNameNormalized);
            const squadType = squadDataRow ? squadDataRow[3]?.trim() : 'Unknown';

            // Wins/levels were scrapped 2026-08; every squad type renders the
            // plain members roster now.
            await fetchNonCompetitiveRoster(sheets, SPREADSHEET_SQUADS, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction, squadType);

        } catch (error) {
            logger.error(`Error fetching roster for ${squadNameInput}:`, error);
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Roster Error\nSquad Roster'),
                new TextDisplayBuilder().setContent('An unexpected error occurred while trying to fetch the squad roster.\nPlease try again later or contact an admin.')
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        }
    },
};
