'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../utils/logger');
const { noticePayload } = require('../../utils/ui');
const { getSheetsClient } = require('../../utils/sheets_cache');
const { SPREADSHEET_CONTENT_CREATORS, BOT_ADMIN_USER_ID } = require('../../config/constants');
const { CC_ROLE_IDS, PLATFORM_CC_ROLE_IDS, parseCreatorRows, buildSyncPlan } = require('../../utils/cc_role_sync');

const SUB = 'CC Role Sync';
const CREATORS_RANGE = 'Creators!A:E';

const ROLE_LABELS = {
    [CC_ROLE_IDS.CONTENT_CREATORS]: 'Content Creators',
    [CC_ROLE_IDS.CONTENT_CREATORS_REELS]: 'Content Creators (Reels)',
    [CC_ROLE_IDS.ACTIVE_REELS]: 'Active Reels',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cc-sync-roles')
        .setDescription('Sync Content Creator roles to exactly match the CC Master sheet')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        // Locked to one account rather than a permission: this bulk-edits
        // roles across the whole server and should not be reachable by every
        // moderator who happens to hold Manage Roles.
        if (interaction.user.id !== BOT_ADMIN_USER_ID) {
            return interaction.reply({
                ...noticePayload('This command is restricted to the bot administrator.', { title: 'Permission Denied', subtitle: SUB }),
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Always read the sheet fresh: syncing roles from a stale cache
            // could re-grant a role someone was just removed from.
            const sheets = await getSheetsClient();
            const resp = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_CONTENT_CREATORS,
                range: CREATORS_RANGE,
            });
            const creators = parseCreatorRows(resp.data.values);
            if (creators.length === 0) {
                await interaction.editReply(noticePayload(
                    'No creators with a Discord ID found in the sheet; nothing was changed.',
                    { title: 'Sync Aborted', subtitle: SUB }
                ));
                return;
            }

            // Full member fetch so role.members reflects everyone, not just
            // cached members.
            await interaction.guild.members.fetch();

            const roles = {};
            for (const roleId of Object.keys(ROLE_LABELS)) {
                roles[roleId] = interaction.guild.roles.cache.get(roleId);
                if (!roles[roleId]) {
                    await interaction.editReply(noticePayload(
                        `Role ${ROLE_LABELS[roleId]} (${roleId}) was not found in this server.`,
                        { title: 'Sync Aborted', subtitle: SUB }
                    ));
                    return;
                }
            }

            const currentMembersByRole = {};
            for (const [roleId, role] of Object.entries(roles)) {
                currentMembersByRole[roleId] = [...role.members.keys()];
            }

            // TikTok/YouTube creators are not in the Reels sheet but keep the
            // umbrella Content Creators role through their platform role.
            const platformMemberIds = PLATFORM_CC_ROLE_IDS.flatMap(roleId =>
                [...(interaction.guild.roles.cache.get(roleId)?.members.keys() ?? [])]
            );

            const plan = buildSyncPlan(creators, currentMembersByRole, platformMemberIds);

            const summary = [];
            const notInGuild = new Set();
            let failures = 0;
            for (const [action, changes] of [['remove', plan.remove], ['add', plan.add]]) {
                for (const [roleId, memberIds] of Object.entries(changes)) {
                    let done = 0;
                    for (const memberId of memberIds) {
                        const member = interaction.guild.members.cache.get(memberId);
                        if (!member) {
                            notInGuild.add(memberId);
                            continue;
                        }
                        try {
                            await member.roles[action](roleId, 'CC role sync from CC Master sheet');
                            done += 1;
                        } catch (error) {
                            failures += 1;
                            logger.error(`[CC Role Sync] Failed to ${action} ${ROLE_LABELS[roleId]} for ${memberId}: ${error.message}`);
                        }
                    }
                    if (memberIds.length > 0) {
                        summary.push(`**${ROLE_LABELS[roleId]}:** ${action === 'add' ? 'added' : 'removed'} ${done}/${memberIds.length}`);
                    }
                }
            }

            await interaction.editReply(noticePayload([
                `Synced roles for ${creators.length} creators from the sheet.`,
                '',
                ...(summary.length > 0 ? summary : ['Everything already matched; no changes made.']),
                notInGuild.size > 0 ? `\n_${notInGuild.size} creator(s) in the sheet are not in this server and were skipped._` : null,
                failures > 0 ? `_${failures} role change(s) failed; see the bot logs._` : null,
            ], { title: 'Sync Complete', subtitle: SUB }));
        } catch (error) {
            logger.error('Error running /cc-sync-roles:', error);
            await interaction.editReply(noticePayload(
                'There was an error while syncing creator roles. Please try again later.',
                { title: 'Sync Failed', subtitle: SUB }
            )).catch(() => {});
        }
    },
};
