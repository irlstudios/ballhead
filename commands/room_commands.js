const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { Pool } = require('pg');
const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};
const pool = new Pool(clientConfig);

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
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const members = Array.from(roomChannel.members.values()).map(member => ({
                    id: member.id,
                    isMuted: member.voice.serverMute || !roomChannel.permissionsFor(member).has('Speak'),
                }));
                const invited = Array.from(roomChannel.permissionOverwrites.cache.values())
                    .filter(overwrite => overwrite.allow.has('Connect') && !overwrite.deny.has('Connect'))
                    .map(overwrite => `<@${overwrite.id}>`);
                const mutedMembers = members.filter(m => m.isMuted).map(m => `<@${m.id}>`);
                const nonMutedMembers = members.filter(m => !m.isMuted).map(m => `<@${m.id}>`);
                const embed = new EmbedBuilder()
                    .setTitle(`Room Details: ${roomChannel.name}`)
                    .setDescription(`Host: <@${hostId}>`)
                    .addFields(
                        { name: 'Members', value: members.map(m => `<@${m.id}>`).join('\n') || 'None', inline: true },
                        { name: 'Muted', value: mutedMembers.join('\n') || 'None', inline: true },
                        { name: 'Unmuted', value: nonMutedMembers.join('\n') || 'None', inline: true },
                        { name: 'Invited', value: invited.join('\n') || 'None', inline: false }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            case 'rename': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const newName = interaction.options.getString('name');
                await roomChannel.setName(newName);
                return interaction.reply({ content: `Room renamed to **${newName}**.`, ephemeral: true });
            }
            case 'invite': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const inviteUser = interaction.options.getUser('user');
                if (inviteUser) {
                    await roomChannel.permissionOverwrites.edit(inviteUser.id, { Connect: true });
                    return interaction.reply({ content: `<@${inviteUser.id}> invited.`, ephemeral: true });
                }
                return interaction.reply({ content: 'No user specified.', ephemeral: true });
            }
            case 'uninvite': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const uninviteUser = interaction.options.getUser('user');
                if (uninviteUser) {
                    await roomChannel.permissionOverwrites.delete(uninviteUser.id);
                    return interaction.reply({ content: `<@${uninviteUser.id}> uninvited.`, ephemeral: true });
                }
                return interaction.reply({ content: 'No user specified.', ephemeral: true });
            }
            case 'host': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const newHost = interaction.options.getUser('user');
                await pool.query(
                    'UPDATE vc_hosts SET host_id = $2 WHERE channel_id = $1',
                    [roomChannel.id, newHost.id]
                );
                return interaction.reply({ content: `<@${newHost.id}> is now host.`, ephemeral: true });
            }
            case 'mute': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const muteUser = interaction.options.getUser('user');
                if (muteUser) {
                    await roomChannel.permissionOverwrites.edit(muteUser.id, { Speak: false });
                    return interaction.reply({ content: `<@${muteUser.id}> muted.`, ephemeral: true });
                }
                await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Speak: false });
                return interaction.reply({ content: 'Everyone muted.', ephemeral: true });
            }
            case 'unmute': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const unmuteUser = interaction.options.getUser('user');
                if (unmuteUser) {
                    await roomChannel.permissionOverwrites.edit(unmuteUser.id, { Speak: true });
                    return interaction.reply({ content: `<@${unmuteUser.id}> unmuted.`, ephemeral: true });
                }
                await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Speak: true });
                return interaction.reply({ content: 'Everyone unmuted.', ephemeral: true });
            }
            case 'lock': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Connect: false });
                return interaction.reply({ content: 'Room locked.', ephemeral: true });
            }
            case 'unlock': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Connect: true });
                return interaction.reply({ content: 'Room unlocked.', ephemeral: true });
            }
            case 'kick': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const kickUser = interaction.options.getUser('user');
                const kickMember = roomChannel.members.get(kickUser.id);
                if (kickMember) {
                    await kickMember.voice.disconnect();
                    return interaction.reply({ content: `<@${kickUser.id}> kicked.`, ephemeral: true });
                }
                return interaction.reply({ content: 'User not in room.', ephemeral: true });
            }
            case 'block': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const blockUser = interaction.options.getUser('user');
                if (blockUser) {
                    await roomChannel.permissionOverwrites.edit(blockUser.id, { Connect: false });
                    return interaction.reply({ content: `<@${blockUser.id}> blocked.`, ephemeral: true });
                }
                return interaction.reply({ content: 'No user specified.', ephemeral: true });
            }
            case 'unblock': {
                const roomChannel = interaction.member.voice.channel;
                if (!roomChannel) {
                    return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
                }
                const { rows } = await pool.query(
                    'SELECT host_id FROM vc_hosts WHERE channel_id = $1',
                    [roomChannel.id]
                );
                const hostId = rows[0]?.host_id;
                const isHost = interaction.user.id === hostId;
                if (!hostId) {
                    return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
                }
                if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
                }
                const unblockUser = interaction.options.getUser('user');
                if (unblockUser) {
                    await roomChannel.permissionOverwrites.edit(unblockUser.id, { Connect: true });
                    return interaction.reply({ content: `<@${unblockUser.id}> unblocked.`, ephemeral: true });
                }
                return interaction.reply({ content: 'No user specified.', ephemeral: true });
            }
            case 'list': {
                if (!interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only moderators can use this command.', ephemeral: true });
                }
                const { rows } = await pool.query('SELECT channel_id, host_id FROM vc_hosts');
                const channels = rows
                    .map(({ channel_id }) => interaction.guild.channels.cache.get(channel_id))
                    .filter(ch => ch);
                if (!channels.length) {
                    return interaction.reply({ content: 'No managed rooms found.', ephemeral: true });
                }
                const list = channels.map(ch => `• ${ch.name} (<#${ch.id}>)`).join('\n');
                return interaction.reply({ content: `Managed rooms:\n${list}`, ephemeral: true });
            }
            case 'clean': {
                if (!interaction.member.roles.cache.has(MOD_ROLE_ID)) {
                    return interaction.reply({ content: 'Only moderators can use this command.', ephemeral: true });
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
                return interaction.reply({ content: `Cleanup complete. Deleted ${deleted} empty room(s) in the category.`, ephemeral: true });
            }
        }
    }
};
