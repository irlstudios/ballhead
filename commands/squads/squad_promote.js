'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, SPREADSHEET_COMP_WINS, MAX_SQUAD_MEMBERS } = require('../../config/constants');
const { findABTeams, findMemberRow, findAllDataRowIndex, SM_SQUAD_NAME } = require('../../utils/squad_queries');
const { withSquadLock } = require('../../utils/squad_lock');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-promote')
        .setDescription('Promote a member from B team to A team')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('The member to promote')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const userId = interaction.user.id;
            const targetUser = interaction.options.getUser('member');

            if (!targetUser || targetUser.bot) {
                return interaction.editReply({ content: 'Invalid target user.' });
            }
            if (targetUser.id === userId) {
                return interaction.editReply({ content: 'You cannot promote yourself.' });
            }

            const sheets = await getSheetsClient();
            const results = await getCachedValues({
                sheets,
                spreadsheetId: SPREADSHEET_SQUADS,
                ranges: ['Squad Leaders!A:G', 'Squad Members!A:E', 'All Data!A:H'],
                ttlMs: 30000,
            });
            const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);
            const squadMembers = (results.get('Squad Members!A:E') || []).slice(1);
            const allData = (results.get('All Data!A:H') || []).slice(1);

            const { aTeam, bTeam } = findABTeams(squadLeaders, userId);
            if (!aTeam || !bTeam) {
                return interaction.editReply({ content: 'You do not have both an A team and B team.' });
            }

            const aTeamName = aTeam[2];
            const bTeamName = bTeam[2];

            // Verify target is on B team
            const targetOnBTeam = findMemberRow(squadMembers, targetUser.id, bTeamName);
            if (!targetOnBTeam) {
                return interaction.editReply({ content: `**${targetUser.username}** is not on your B team (**${bTeamName}**).` });
            }

            // Check A team capacity
            const aTeamMembers = squadMembers.filter(row => row && row.length > SM_SQUAD_NAME && row[SM_SQUAD_NAME]?.toUpperCase() === aTeamName.toUpperCase());
            if (aTeamMembers.length + 1 >= MAX_SQUAD_MEMBERS) {
                return interaction.editReply({ content: `Your A team (**${aTeamName}**) is full.` });
            }

            // Always acquire locks in alphabetical order to prevent deadlocks
            const [firstLock, secondLock] = [bTeamName, aTeamName].sort((a, b) => a.localeCompare(b));
            await withSquadLock(firstLock, async () => {
                await withSquadLock(secondLock, async () => {
                    // Re-fetch for freshness
                    const fresh = await getCachedValues({
                        sheets,
                        spreadsheetId: SPREADSHEET_SQUADS,
                        ranges: ['Squad Members!A:E', 'All Data!A:H'],
                        ttlMs: 5000,
                    });
                    const freshMembers = (fresh.get('Squad Members!A:E') || []);
                    const freshAllData = (fresh.get('All Data!A:H') || []);
                    const freshMembersHeaderless = freshMembers.slice(1);
                    const freshAllDataHeaderless = freshAllData.slice(1);

                    // Update Squad Members: change squad name from B to A
                    const memberIndex = freshMembersHeaderless.findIndex(
                        row => row && row[1] === targetUser.id && row[SM_SQUAD_NAME]?.toUpperCase() === bTeamName.toUpperCase()
                    );
                    if (memberIndex !== -1) {
                        const updatedRow = [...freshMembersHeaderless[memberIndex]];
                        updatedRow[SM_SQUAD_NAME] = aTeamName;
                        const sheetRow = memberIndex + 2;
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: SPREADSHEET_SQUADS,
                            range: `Squad Members!A${sheetRow}:E${sheetRow}`,
                            valueInputOption: 'RAW',
                            resource: { values: [updatedRow] },
                        });
                    }

                    // Update All Data: change squad name from B to A
                    const adIndex = findAllDataRowIndex(freshAllDataHeaderless, targetUser.id, bTeamName);
                    if (adIndex !== -1) {
                        const updatedRow = [...freshAllDataHeaderless[adIndex]];
                        updatedRow[2] = aTeamName;
                        const sheetRow = adIndex + 2;
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: SPREADSHEET_SQUADS,
                            range: `All Data!A${sheetRow}:H${sheetRow}`,
                            valueInputOption: 'RAW',
                            resource: { values: [updatedRow] },
                        });
                    }

                    // Update COMP_WINS Squad Members if present
                    try {
                        const compResults = await getCachedValues({
                            sheets,
                            spreadsheetId: SPREADSHEET_COMP_WINS,
                            ranges: ["'Squad Members'!A:ZZ"],
                            ttlMs: 30000,
                        });
                        const compMembers = compResults.get("'Squad Members'!A:ZZ") || [];
                        const compMemberIndex = compMembers.findIndex(
                            (row, i) => i > 0 && row && row[1]?.toUpperCase() === bTeamName.toUpperCase() && row[0] === targetUser.id
                        );
                        if (compMemberIndex !== -1) {
                            const updatedCompRow = [...compMembers[compMemberIndex]];
                            updatedCompRow[1] = aTeamName;
                            const compSheetRow = compMemberIndex + 1;
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: SPREADSHEET_COMP_WINS,
                                range: `'Squad Members'!A${compSheetRow}`,
                                valueInputOption: 'RAW',
                                resource: { values: [updatedCompRow] },
                            });
                        }
                    } catch (e) {
                        logger.error('[Promote] Failed to update COMP_WINS:', e.message);
                    }
                });
            });

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Member Promoted'),
                new TextDisplayBuilder().setContent(`**${targetUser.username}** has been moved from **${bTeamName}** (B) to **${aTeamName}** (A).`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });

        } catch (error) {
            logger.error('[Squad Promote] Error:', error);
            await interaction.editReply({ content: 'An error occurred while promoting the member.' });
        }
    },
};
