const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_COMP_WINS, SPREADSHEET_SQUADS } = require('../../config/constants');
const logger = require('../../utils/logger');

async function fetchCompetitiveRoster(sheets, SPREADSHEET_COMP_WINS, SPREADSHEET_SQUADS, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction) {
    try {
        const squadMembersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_COMP_WINS,
            range: '\'Squad Members\'!A:ZZ',
        });

        const squadMembersData = squadMembersResponse.data.values || [];
        if (squadMembersData.length < 1) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Competitive Roster Unavailable\n' + squadNameInput),
                new TextDisplayBuilder().setContent(`Could not read headers from the competitive members sheet for "${squadNameInput}".`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
            return;
        }
        const squadMembersHeaders = squadMembersData.shift() || [];
        const dateColumns = squadMembersHeaders.slice(3).map(dateStr => {
            try {
                return new Date(dateStr);
            } catch { return null; }
        }).filter(date => date !== null);

        const relevantMembers = squadMembersData.filter(row => row && row.length > 1 && row[1]?.trim().toLowerCase() === squadNameNormalized);

        if (relevantMembers.length === 0) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## No Competitive Members\n' + squadNameInput),
                new TextDisplayBuilder().setContent(`No members found listed in the competitive tracking sheet for squad "${squadNameInput}".`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
            return;
        }

        const membersWithWins = relevantMembers.map(memberRow => {
            const discordId = memberRow[0]?.trim();
            const joinedSquadStr = memberRow[2]?.trim();
            const joinedSquadDate = joinedSquadStr ? new Date(joinedSquadStr) : new Date(0);

            let totalWins = 0;
            for (let i = 3; i < squadMembersHeaders.length; i++) {
                const winStr = memberRow[i]?.trim();
                const wins = parseInt(winStr) || 0;
                if (i - 3 < dateColumns.length) {
                    const weekDate = dateColumns[i - 3];
                    if (weekDate && weekDate >= joinedSquadDate) {
                        totalWins += wins;
                    }
                }
            }

            return {
                discordId,
                totalWins,
                isLeader: discordId === leaderId,
            };
        }).filter(m => m.discordId);

        const totalSquadWins = membersWithWins.reduce((sum, member) => sum + member.totalWins, 0);
        const squadLevel = Math.floor(totalSquadWins / 50) + 1;

        membersWithWins.sort((a, b) => {
            if (a.isLeader && !b.isLeader) return -1;
            if (!a.isLeader && b.isLeader) return 1;
            return b.totalWins - a.totalWins;
        });

        const leader = membersWithWins.find(member => member.isLeader);
        const members = membersWithWins.filter(member => !member.isLeader);
        let memberContributions = 'No other members found in competitive tracking.';
        if (members.length > 0) {
            memberContributions = members
                .map(member => `<@${member.discordId}> (${member.totalWins} Wins)`)
                .join('\n');
        }

        const container = new ContainerBuilder()
            .setAccentColor(0x14B8A6)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${squadNameInput.toUpperCase()}`),
                new TextDisplayBuilder().setContent(`Level ${squadLevel} • ${totalSquadWins} Total Wins`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**Leader**\n${leaderId ? `<@${leaderId}> (${leader ? leader.totalWins + ' Wins' : 'N/A'})` : 'Not found'}`),
                new TextDisplayBuilder().setContent(`**Members**\n${memberContributions}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Competitive • Formed ${squadMade || 'Unknown'}`)
            );

        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });

    } catch (error) {
        logger.error(`Error in fetchCompetitiveRoster for ${squadNameInput}:`, error);
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Roster Error\nCompetitive Squad'),
            new TextDisplayBuilder().setContent('An error occurred while fetching the competitive squad roster.')
        );
        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
    }
}



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
        .setName('roster')
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

            if (squadType === 'Competitive') {
                await fetchCompetitiveRoster(sheets, SPREADSHEET_COMP_WINS, SPREADSHEET_SQUADS, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction);
            } else {
                await fetchNonCompetitiveRoster(sheets, SPREADSHEET_SQUADS, squadNameInput, squadNameNormalized, squadMade, leaderId, interaction, squadType);
            }

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
