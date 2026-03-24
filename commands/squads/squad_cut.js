'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const { SPREADSHEET_SQUADS, BALLHEAD_GUILD_ID, AD_PREFERENCE } = require('../../config/constants');
const { findABTeams, findMemberRow, findAllDataRowIndex, SM_SQUAD_NAME } = require('../../utils/squad_queries');
const { stripLevelRoles } = require('../../utils/squad_level_sync');
const { withSquadLock } = require('../../utils/squad_lock');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('squad-cut')
        .setDescription('Remove a member from your entire squad organization (A + B)')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('The member to cut')
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
                return interaction.editReply({ content: 'You cannot cut yourself. Use `/disband-squad` instead.' });
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
                return interaction.editReply({ content: 'You do not have both an A team and B team. Use `/remove-from-squad` instead.' });
            }

            const aTeamName = aTeam[2];
            const bTeamName = bTeam[2];

            // Find which team the target is on
            const onATeam = findMemberRow(squadMembers, targetUser.id, aTeamName);
            const onBTeam = findMemberRow(squadMembers, targetUser.id, bTeamName);

            if (!onATeam && !onBTeam) {
                return interaction.editReply({ content: `**${targetUser.username}** is not on your A team or B team.` });
            }

            const targetSquadName = onATeam ? aTeamName : bTeamName;

            await withSquadLock(targetSquadName, async () => {
                // Re-fetch fresh data
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

                // Remove from Squad Members
                const memberIndex = freshMembersHeaderless.findIndex(
                    row => row && row[1] === targetUser.id && row[SM_SQUAD_NAME]?.toUpperCase() === targetSquadName.toUpperCase()
                );
                if (memberIndex !== -1) {
                    const updatedMembers = freshMembersHeaderless.filter((_, i) => i !== memberIndex);
                    await sheets.spreadsheets.values.clear({
                        spreadsheetId: SPREADSHEET_SQUADS,
                        range: 'Squad Members!A2:E',
                    });
                    if (updatedMembers.length > 0) {
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: SPREADSHEET_SQUADS,
                            range: 'Squad Members!A2',
                            valueInputOption: 'RAW',
                            resource: { values: updatedMembers },
                        });
                    }
                }

                // Update All Data: clear squad info for this member's row
                const adIndex = findAllDataRowIndex(freshAllDataHeaderless, targetUser.id, targetSquadName);
                if (adIndex !== -1) {
                    const existingRow = freshAllDataHeaderless[adIndex];
                    const preference = existingRow.length > AD_PREFERENCE ? existingRow[AD_PREFERENCE] : 'TRUE';
                    const clearedRow = [existingRow[0], existingRow[1], 'N/A', 'N/A', 'N/A', 'FALSE', 'No', preference];
                    const sheetRow = adIndex + 2;
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SPREADSHEET_SQUADS,
                        range: `All Data!A${sheetRow}:H${sheetRow}`,
                        valueInputOption: 'RAW',
                        resource: { values: [clearedRow] },
                    });
                }
            });

            // Strip roles
            const guild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
            await stripLevelRoles(guild, targetUser.id);

            // Reset nickname
            try {
                const targetMember = await guild.members.fetch(targetUser.id);
                if (targetMember && targetMember.nickname && targetMember.nickname.toUpperCase().startsWith(`[${targetSquadName.toUpperCase()}]`)) {
                    await targetMember.setNickname(targetMember.user.username).catch(() => {});
                }
            } catch (e) {
                logger.info(`[Cut] Could not reset nickname for ${targetUser.id}: ${e.message}`);
            }

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Member Cut'),
                new TextDisplayBuilder().setContent(`**${targetUser.username}** has been removed from **${targetSquadName}** and all squad roles stripped.`)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });

        } catch (error) {
            logger.error('[Squad Cut] Error:', error);
            await interaction.editReply({ content: 'An error occurred while cutting the member.' });
        }
    },
};
