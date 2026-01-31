const { SlashCommandBuilder, MessageFlags, ContainerBuilder, ChannelType, TextDisplayBuilder } = require('discord.js');
const { pool } = require('../../db');

const BLACKLIST_USER_IDS = new Set();
const BLACKLIST_ROLE_IDS = new Set(['847977550731149364']);
const BLACKLIST_DENY_OVERWRITE = {
    Connect: false,
    Speak: false,
    Stream: false,
    UseEmbeddedActivities: false,
    SendMessages: false
};

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

const applyBlacklistPermissions = async (channel) => {
    if (!channel?.permissionOverwrites) return;
    const targets = new Set([...BLACKLIST_USER_IDS, ...BLACKLIST_ROLE_IDS]);
    for (const targetId of targets) {
        try {
            await channel.permissionOverwrites.edit(targetId, BLACKLIST_DENY_OVERWRITE);
        } catch (error) {
            if (error?.code !== 10003) throw error;
        }
    }
};

const isUserBlacklisted = async (guild, userId) => {
    if (BLACKLIST_USER_IDS.has(userId)) return true;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    return member.roles.cache.some(role => BLACKLIST_ROLE_IDS.has(role.id));
};

function buildRoomNotice({ title, subtitle, lines } = {}) {
    const container = new ContainerBuilder();
    const block = buildTextBlock({ title, subtitle, lines });
    if (block) container.addTextDisplayComponents(block);
    return container;
}

function replyRoomNotice(interaction, notice) {
    const container = buildRoomNotice(notice);
    return interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('room')
        .setDescription('Manage your private room')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View room details.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('rename')
                .setDescription('Rename your room.')
                .addStringOption(option => option.setName('name').setDescription('New name for your room').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('invite')
                .setDescription('Invite users to the room.')
                .addUserOption(option => option.setName('user').setDescription('User to invite'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('uninvite')
                .setDescription('Uninvite users from the room.')
                .addUserOption(option => option.setName('user').setDescription('User to uninvite'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('host')
                .setDescription('Transfer host privileges.')
                .addUserOption(option => option.setName('user').setDescription('User to make host').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('mute')
                .setDescription('Mute everyone or a specific user in the room.')
                .addUserOption(option => option.setName('user').setDescription('User to mute'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unmute')
                .setDescription('Unmute everyone or a specific user in the room.')
                .addUserOption(option => option.setName('user').setDescription('User to unmute'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('lock')
                .setDescription('Lock the room.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unlock')
                .setDescription('Unlock the room.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('kick')
                .setDescription('Kick a user from the room.')
                .addUserOption(option => option.setName('user').setDescription('User to kick').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('block')
                .setDescription('Block a user from joining your room.')
                .addUserOption(option => option.setName('user').setDescription('User to block from joining').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unblock')
                .setDescription('Unblock a user from joining your room.')
                .addUserOption(option => option.setName('user').setDescription('User to unblock from joining').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all rooms managed by the bot.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clean')
                .setDescription('Clean up orphaned rooms stored in the database.')
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const MOD_ROLE_ID = '805833778064130104';
        switch (subcommand) {
        case 'view': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Room View',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Room View',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Room View',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const members = Array.from(roomChannel.members.values()).map(member => ({
                id: member.id,
                isMuted: member.voice.serverMute || !roomChannel.permissionsFor(member).has('Speak') }));
            const invited = Array.from(roomChannel.permissionOverwrites.cache.values())
                .filter(overwrite => overwrite.allow.has('Connect') && !overwrite.deny.has('Connect'))
                .map(overwrite => `<@${overwrite.id}>`);
            const mutedMembers = members.filter(m => m.isMuted).map(m => `<@${m.id}>`);
            const nonMutedMembers = members.filter(m => !m.isMuted).map(m => `<@${m.id}>`);
            const membersList = members.map(m => `<@${m.id}>`).join('\n') || 'None';
            const mutedList = mutedMembers.join('\n') || 'None';
            const unmutedList = nonMutedMembers.join('\n') || 'None';
            const invitedList = invited.join('\n') || 'None';

            const roomContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Room Details',
                subtitle: `Room: ${roomChannel.name}`, lines: [
                `**Host:** <@${hostId}>`,
                `**Members:**\n${membersList}`,
                `**Muted:**\n${mutedList}`,
                `**Unmuted:**\n${unmutedList}`,
                `**Invited:**\n${invitedList}`
            ] });
            if (block) roomContainer.addTextDisplayComponents(block);

            return interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [roomContainer]
            });
        }
        case 'rename': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Room Rename',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Room Rename',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Room Rename',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const newName = interaction.options.getString('name');
            await roomChannel.setName(newName);
            return replyRoomNotice(interaction, {
                title: 'Room Renamed',
                subtitle: newName,
                lines: [`Room renamed to **${newName}**.`]
            });
        }
        case 'invite': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Room Invite',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Room Invite',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Room Invite',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const inviteUser = interaction.options.getUser('user');
            if (inviteUser) {
                if (await isUserBlacklisted(interaction.guild, inviteUser.id)) {
                    await enforceBlacklistForUser(roomChannel, inviteUser.id);
                    return replyRoomNotice(interaction, {
                        title: 'Invite Blocked',
                        subtitle: 'Room Invite',
                        lines: ['That user is blacklisted from joining rooms.']
                    });
                }
                await roomChannel.permissionOverwrites.edit(inviteUser.id, { Connect: true });
                await applyBlacklistPermissions(roomChannel);
                return replyRoomNotice(interaction, {
                    title: 'Invite Sent',
                    subtitle: 'Room Invite',
                    lines: [`<@${inviteUser.id}> invited.`]
                });
            }
            return replyRoomNotice(interaction, {
                title: 'User Missing',
                subtitle: 'Room Invite',
                lines: ['No user specified.']
            });
        }
        case 'uninvite': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Room Uninvite',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Room Uninvite',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Room Uninvite',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const uninviteUser = interaction.options.getUser('user');
            if (uninviteUser) {
                await roomChannel.permissionOverwrites.delete(uninviteUser.id);
                await applyBlacklistPermissions(roomChannel);
                return replyRoomNotice(interaction, {
                    title: 'Invite Removed',
                    subtitle: 'Room Uninvite',
                    lines: [`<@${uninviteUser.id}> uninvited.`]
                });
            }
            return replyRoomNotice(interaction, {
                title: 'User Missing',
                subtitle: 'Room Uninvite',
                lines: ['No user specified.']
            });
        }
        case 'host': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Transfer Host',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Transfer Host',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Transfer Host',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const newHost = interaction.options.getUser('user');
            await pool.query(
                'UPDATE vc_hosts SET host_id = $2 WHERE channel_id = $1',
                [roomChannel.id, newHost.id]
            );
            return replyRoomNotice(interaction, {
                title: 'Host Updated',
                subtitle: 'Transfer Host',
                lines: [`<@${newHost.id}> is now host.`]
            });
        }
        case 'mute': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Mute Room',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Mute Room',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Mute Room',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const muteUser = interaction.options.getUser('user');
            if (muteUser) {
                await roomChannel.permissionOverwrites.edit(muteUser.id, { Speak: false });
                return replyRoomNotice(interaction, {
                    title: 'User Muted',
                    subtitle: 'Mute Room',
                    lines: [`<@${muteUser.id}> muted.`]
                });
            }
            await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Speak: false });
            return replyRoomNotice(interaction, {
                title: 'Room Muted',
                subtitle: 'Mute Room',
                lines: ['Everyone muted.']
            });
        }
        case 'unmute': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Unmute Room',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Unmute Room',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Unmute Room',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const unmuteUser = interaction.options.getUser('user');
            if (unmuteUser) {
                await roomChannel.permissionOverwrites.edit(unmuteUser.id, { Speak: true });
                return replyRoomNotice(interaction, {
                    title: 'User Unmuted',
                    subtitle: 'Unmute Room',
                    lines: [`<@${unmuteUser.id}> unmuted.`]
                });
            }
            await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Speak: true });
            return replyRoomNotice(interaction, {
                title: 'Room Unmuted',
                subtitle: 'Unmute Room',
                lines: ['Everyone unmuted.']
            });
        }
        case 'lock': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Lock Room',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Lock Room',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Lock Room',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Connect: false });
            await applyBlacklistPermissions(roomChannel);
            return replyRoomNotice(interaction, {
                title: 'Room Locked',
                subtitle: 'Lock Room',
                lines: ['Room locked.']
            });
        }
        case 'unlock': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Unlock Room',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Unlock Room',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Unlock Room',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Connect: true });
            await applyBlacklistPermissions(roomChannel);
            return replyRoomNotice(interaction, {
                title: 'Room Unlocked',
                subtitle: 'Unlock Room',
                lines: ['Room unlocked.']
            });
        }
        case 'kick': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Kick User',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Kick User',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Kick User',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const kickUser = interaction.options.getUser('user');
            const kickMember = roomChannel.members.get(kickUser.id);
            if (kickMember) {
                await kickMember.voice.disconnect();
                return replyRoomNotice(interaction, {
                    title: 'User Kicked',
                    subtitle: 'Kick User',
                    lines: [`<@${kickUser.id}> kicked.`]
                });
            }
            return replyRoomNotice(interaction, {
                title: 'User Not In Room',
                subtitle: 'Kick User',
                lines: ['User not in room.']
            });
        }
        case 'block': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Block User',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Block User',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Block User',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const blockUser = interaction.options.getUser('user');
            if (blockUser) {
                if (await isUserBlacklisted(interaction.guild, blockUser.id)) {
                    await enforceBlacklistForUser(roomChannel, blockUser.id);
                    return replyRoomNotice(interaction, {
                        title: 'Block Enforced',
                        subtitle: 'Block User',
                        lines: ['That user is blacklisted from joining rooms.']
                    });
                }
                await roomChannel.permissionOverwrites.edit(blockUser.id, { Connect: false });
                await applyBlacklistPermissions(roomChannel);
                return replyRoomNotice(interaction, {
                    title: 'User Blocked',
                    subtitle: 'Block User',
                    lines: [`<@${blockUser.id}> blocked.`]
                });
            }
            return replyRoomNotice(interaction, {
                title: 'User Missing',
                subtitle: 'Block User',
                lines: ['No user specified.']
            });
        }
        case 'unblock': {
            const roomChannel = interaction.member.voice.channel;
            if (!roomChannel) {
                return replyRoomNotice(interaction, {
                    title: 'Room Required',
                    subtitle: 'Unblock User',
                    lines: ['You are not in a voice channel.']
                });
            }
            const { rows } = await pool.query(
                'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                [roomChannel.id]
            );
            const hostId = rows[0]?.host_id;
            const isHost = interaction.user.id === hostId;
            if (!hostId) {
                return replyRoomNotice(interaction, {
                    title: 'Unmanaged Room',
                    subtitle: 'Unblock User',
                    lines: ['This channel is not managed by the bot.']
                });
            }
            if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Unblock User',
                    lines: ['Only the room host or moderators can execute this command.']
                });
            }
            await applyBlacklistPermissions(roomChannel);
            const unblockUser = interaction.options.getUser('user');
            if (unblockUser) {
                if (await isUserBlacklisted(interaction.guild, unblockUser.id)) {
                    await enforceBlacklistForUser(roomChannel, unblockUser.id);
                    return replyRoomNotice(interaction, {
                        title: 'Unblock Not Allowed',
                        subtitle: 'Unblock User',
                        lines: ['That user is blacklisted from joining rooms and cannot be unblocked.']
                    });
                }
                await roomChannel.permissionOverwrites.edit(unblockUser.id, { Connect: true });
                await applyBlacklistPermissions(roomChannel);
                return replyRoomNotice(interaction, {
                    title: 'User Unblocked',
                    subtitle: 'Unblock User',
                    lines: [`<@${unblockUser.id}> unblocked.`]
                });
            }
            return replyRoomNotice(interaction, {
                title: 'User Missing',
                subtitle: 'Unblock User',
                lines: ['No user specified.']
            });
        }
        case 'list': {
            if (!interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Room List',
                    lines: ['Only moderators can use this command.']
                });
            }
            const { rows } = await pool.query('SELECT channel_id, host_id FROM vc_hosts');
            const channels = rows
                .map(({ channel_id }) => interaction.guild.channels.cache.get(channel_id))
                .filter(ch => ch);
            if (!channels.length) {
                return replyRoomNotice(interaction, {
                    title: 'No Managed Rooms',
                    subtitle: 'Room List',
                    lines: ['No managed rooms found.']
                });
            }
            const list = channels.map(ch => `• ${ch.name} (<#${ch.id}>)`).join('\n');
            return replyRoomNotice(interaction, {
                title: 'Managed Rooms',
                subtitle: `Total: ${channels.length}`,
                lines: [`Managed rooms:\n${list}`]
            });
        }
        case 'clean': {
            if (!interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                return replyRoomNotice(interaction, {
                    title: 'Access Denied',
                    subtitle: 'Room Cleanup',
                    lines: ['Only moderators can use this command.']
                });
            }
            const VC_CATEGORY_ID = '752216589792706623';
            const IGNORE_CHANNEL_IDS = new Set([
                '1322247458897793054',
                '1321321286299025418',
                '1274148177754194054',
                '1095472333256405143',
                '1321321682891178074',
                '1368393500470542449'
            ]);
            let deleted = 0;
            const targets = interaction.guild.channels.cache.filter(ch => ch.parentId === VC_CATEGORY_ID && ch.type === ChannelType.GuildVoice && !IGNORE_CHANNEL_IDS.has(ch.id) && ch.members.size === 0);
            for (const [, ch] of targets) {
                if (!ch.deletable) {
                    continue;
                }
                await ch.delete();
                await pool.query('DELETE FROM vc_hosts WHERE channel_id = $1', [ch.id]);
                deleted++;
            }
            return replyRoomNotice(interaction, {
                title: 'Cleanup Complete',
                subtitle: 'Room Cleanup',
                lines: [`Deleted ${deleted} empty room(s) in the category.`]
            });
        }
        }
    }
};
