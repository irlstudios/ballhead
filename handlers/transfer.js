'use strict';

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { noticePayload } = require('../utils/ui');
const { fetchTransferRequestByMessageId, updateTransferRequestStatus } = require('../db');
const { getSheetsClient, getCachedValues } = require('../utils/sheets_cache');
const { withSquadLock } = require('../utils/squad_lock');
const {
    findLeaderRow, findMemberRow, findAllDataRow, findAllDataRowIndex,
    findUserAllDataRows, getRolesToRemove, AD_SQUAD_TYPE,
} = require('../utils/squad_queries');
const {
    SPREADSHEET_SQUADS,
    BALLHEAD_GUILD_ID,
    SQUAD_LEADER_ROLE_ID,
    COMPETITIVE_SQUAD_OWNER_ROLE_ID,
} = require('../config/constants');

const handleTransferButton = async (interaction, action) => {
    try {
        await interaction.deferReply({ ephemeral: true });

        const transfer = await fetchTransferRequestByMessageId(interaction.message.id);
        if (!transfer) {
            return interaction.editReply(
                noticePayload('This transfer request is no longer available.', { title: 'Transfer Expired', subtitle: 'Squad Transfer' })
            );
        }

        if (transfer.status !== 'Pending') {
            return interaction.editReply(
                noticePayload(`This transfer has already been processed (${transfer.status}).`, { title: 'Transfer Processed', subtitle: 'Squad Transfer' })
            );
        }

        if (transfer.expires_at && new Date(transfer.expires_at) <= new Date()) {
            await updateTransferRequestStatus(interaction.message.id, 'Expired');
            return interaction.editReply(
                noticePayload('This transfer request has expired.', { title: 'Transfer Expired', subtitle: 'Squad Transfer' })
            );
        }

        if (interaction.user.id !== transfer.target_id) {
            return interaction.editReply(
                noticePayload('Only the designated recipient can respond to this transfer.', { title: 'Not Authorized', subtitle: 'Squad Transfer' })
            );
        }

        if (action === 'accept') {
            await handleAccept(interaction, transfer);
        } else {
            await handleDecline(interaction, transfer);
        }
    } catch (error) {
        logger.error('[Transfer Handler] Error:', error);
        await interaction.editReply(
            noticePayload('An error occurred while processing the transfer.', { title: 'Transfer Error', subtitle: 'Squad Transfer' })
        ).catch(() => {});
    }
};

const handleAccept = async (interaction, transfer) => {
    const { leader_id: leaderId, target_id: targetId, squad_name: squadName, squad_type: squadType } = transfer;

    await withSquadLock(squadName, async () => {
        const sheets = await getSheetsClient();
        const results = await getCachedValues({
            sheets,
            spreadsheetId: SPREADSHEET_SQUADS,
            ranges: ['Squad Leaders!A:G', 'Squad Members!A:E', 'All Data!A:H'],
            ttlMs: 5000,
        });
        const squadLeaders = (results.get('Squad Leaders!A:G') || []);
        const squadMembers = (results.get('Squad Members!A:E') || []);
        const allData = (results.get('All Data!A:H') || []);

        const squadLeadersHeaderless = squadLeaders.slice(1);
        const squadMembersHeaderless = squadMembers.slice(1);
        const allDataHeaderless = allData.slice(1);

        // Re-validate: leader still owns the squad
        const leaderRow = findLeaderRow(squadLeadersHeaderless, leaderId, squadName);
        if (!leaderRow) {
            await updateTransferRequestStatus(interaction.message.id, 'Failed');
            return interaction.editReply(
                noticePayload('The original leader no longer owns this squad.', { title: 'Transfer Failed', subtitle: 'Squad Transfer' })
            );
        }

        // Re-validate: target still in squad
        const targetMemberRow = findMemberRow(squadMembersHeaderless, targetId, squadName);
        if (!targetMemberRow) {
            await updateTransferRequestStatus(interaction.message.id, 'Failed');
            return interaction.editReply(
                noticePayload('You are no longer a member of this squad.', { title: 'Transfer Failed', subtitle: 'Squad Transfer' })
            );
        }

        // Update Squad Leaders: swap target in, leader out
        const leaderIndex = squadLeadersHeaderless.findIndex(
            row => row && row.length > 2 && row[1] === leaderId && row[2]?.toUpperCase() === squadName.toUpperCase()
        );
        if (leaderIndex === -1) {
            await updateTransferRequestStatus(interaction.message.id, 'Failed');
            return interaction.editReply(
                noticePayload('Could not locate leader row in sheet.', { title: 'Transfer Failed', subtitle: 'Squad Transfer' })
            );
        }

        const guild = await interaction.client.guilds.fetch(BALLHEAD_GUILD_ID);
        const targetMember = await guild.members.fetch(targetId).catch(() => null);
        const leaderMember = await guild.members.fetch(leaderId).catch(() => null);

        // Preserve all 7 columns, swap username and ID
        const updatedLeaderRow = [...leaderRow];
        updatedLeaderRow[0] = targetMemberRow[0] || (targetMember ? targetMember.user.username : targetId);
        updatedLeaderRow[1] = targetId;

        const sheetRowIndex = leaderIndex + 2; // +1 for header, +1 for 1-based index
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_SQUADS,
            range: `Squad Leaders!A${sheetRowIndex}:G${sheetRowIndex}`,
            valueInputOption: 'RAW',
            resource: { values: [updatedLeaderRow] },
        });

        // Remove target from Squad Members (they're now leader)
        const targetMemberIndex = squadMembersHeaderless.findIndex(
            row => row && row.length > 2 && row[1] === targetId && row[2]?.toUpperCase() === squadName.toUpperCase()
        );
        if (targetMemberIndex !== -1) {
            const updatedMembers = squadMembersHeaderless.filter((_, i) => i !== targetMemberIndex);
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

        // Add old leader as regular member
        const currentDate = new Date();
        const dateString = `${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentDate.getDate().toString().padStart(2, '0')}/${currentDate.getFullYear().toString().slice(-2)}`;
        const leaderUsername = leaderMember ? leaderMember.user.username : leaderId;
        const newMemberRow = [leaderUsername, leaderId, squadName, leaderRow[3] || 'N/A', dateString];
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_SQUADS,
            range: 'Squad Members!A1',
            valueInputOption: 'RAW',
            resource: { values: [newMemberRow] },
        });

        // Update All Data: set old leader's Is Leader = No, new leader's Is Leader = Yes
        const leaderAllDataIndex = findAllDataRowIndex(allDataHeaderless, leaderId, squadName);
        if (leaderAllDataIndex !== -1) {
            const updatedRow = [...allDataHeaderless[leaderAllDataIndex]];
            updatedRow[6] = 'No';
            const adRowIndex = leaderAllDataIndex + 2;
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: `All Data!A${adRowIndex}:H${adRowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [updatedRow] },
            });
        }

        const targetAllDataIndex = findAllDataRowIndex(allDataHeaderless, targetId, squadName);
        if (targetAllDataIndex !== -1) {
            const updatedRow = [...allDataHeaderless[targetAllDataIndex]];
            updatedRow[6] = 'Yes';
            const adRowIndex = targetAllDataIndex + 2;
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: `All Data!A${adRowIndex}:H${adRowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [updatedRow] },
            });
        }

        // Role management
        // Give new leader the squad leader role
        if (targetMember) {
            await targetMember.roles.add(SQUAD_LEADER_ROLE_ID).catch(e =>
                logger.error(`[Transfer] Failed to add leader role to ${targetId}:`, e.message)
            );
            if (squadType === 'Competitive') {
                await targetMember.roles.add(COMPETITIVE_SQUAD_OWNER_ROLE_ID).catch(e =>
                    logger.error(`[Transfer] Failed to add comp owner role to ${targetId}:`, e.message)
                );
            }
        }

        // Remove roles from old leader only if they don't need them anymore
        if (leaderMember) {
            const rolesToRemove = getRolesToRemove(allDataHeaderless, squadLeadersHeaderless, leaderId, squadType, squadName);
            for (const roleId of rolesToRemove) {
                await leaderMember.roles.remove(roleId).catch(e =>
                    logger.error(`[Transfer] Failed to remove role ${roleId} from ${leaderId}:`, e.message)
                );
            }
        }

        await updateTransferRequestStatus(interaction.message.id, 'Accepted');

        // Update the DM message
        const acceptedContainer = new ContainerBuilder()
            .setAccentColor(0x2ECC71)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Transfer Complete'),
                new TextDisplayBuilder().setContent(`You are now the owner of **${squadName}** (${squadType}).`)
            );
        await interaction.message.edit({
            flags: MessageFlags.IsComponentsV2,
            components: [acceptedContainer],
        }).catch(() => {});

        await interaction.editReply(
            noticePayload(`You are now the owner of **${squadName}**.`, { title: 'Transfer Complete', subtitle: 'Squad Transfer' })
        );

        // Notify old leader
        const leader = await interaction.client.users.fetch(leaderId).catch(() => null);
        if (leader) {
            const notifyContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Transfer Accepted'),
                    new TextDisplayBuilder().setContent(
                        `**${interaction.user.username}** accepted ownership of **${squadName}**. You are now a regular member.`
                    )
                );
            await leader.send({
                flags: MessageFlags.IsComponentsV2,
                components: [notifyContainer],
            }).catch(e => logger.error(`[Transfer] Failed to DM old leader ${leaderId}:`, e.message));
        }
    });
};

const handleDecline = async (interaction, transfer) => {
    const { leader_id: leaderId, squad_name: squadName } = transfer;

    await updateTransferRequestStatus(interaction.message.id, 'Declined');

    // Update the DM message
    const declinedContainer = new ContainerBuilder()
        .setAccentColor(0x95A5A6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Transfer Declined'),
            new TextDisplayBuilder().setContent(`You declined ownership of **${squadName}**.`)
        );
    await interaction.message.edit({
        flags: MessageFlags.IsComponentsV2,
        components: [declinedContainer],
    }).catch(() => {});

    await interaction.editReply(
        noticePayload('You have declined the transfer.', { title: 'Transfer Declined', subtitle: 'Squad Transfer' })
    );

    // Notify old leader
    const leader = await interaction.client.users.fetch(leaderId).catch(() => null);
    if (leader) {
        const notifyContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Transfer Declined'),
                new TextDisplayBuilder().setContent(
                    `**${interaction.user.username}** declined ownership of **${squadName}**.`
                )
            );
        await leader.send({
            flags: MessageFlags.IsComponentsV2,
            components: [notifyContainer],
        }).catch(e => logger.error(`[Transfer] Failed to DM leader ${leaderId}:`, e.message));
    }
};

module.exports = {
    handleTransferButton,
};
