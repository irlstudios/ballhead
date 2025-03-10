const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const roomChannel = interaction.member.voice.channel;
        const client = interaction.client;
        const MOD_ROLE_ID = '805833778064130104';

        if (!roomChannel) {
            return interaction.reply({ content: 'You are not in a voice channel.', ephemeral: true });
        }

        const hostId = client.vcHosts?.get(roomChannel.id);
        const isHost = interaction.user.id === hostId;

        if (!hostId) {
            return interaction.reply({ content: 'This channel is not managed by the bot.', ephemeral: true });
        }

        if (!isHost && !interaction.member.roles.cache.has(MOD_ROLE_ID)) {
            return interaction.reply({ content: 'Only the room host or moderators can execute this command.', ephemeral: true });
        }

        switch (subcommand) {
            case 'view':
                const members = roomChannel.members.map(member => ({
                    id: member.id,
                    displayName: member.displayName,
                    isMuted: member.voice.serverMute || !roomChannel.permissionsFor(member).has('Speak'),
                }));

                const invited = Array.from(roomChannel.permissionOverwrites.cache.values())
                    .filter(overwrite => overwrite.allow.has('Connect') && !overwrite.deny.has('Connect'))
                    .map(overwrite => `<@${overwrite.id}>`);

                const mutedMembers = members.filter(member => member.isMuted).map(member => `<@${member.id}>`);
                const nonMutedMembers = members.filter(member => !member.isMuted).map(member => `<@${member.id}>`);

                const embed = new EmbedBuilder()
                    .setTitle(`Room Details: ${roomChannel.name}`)
                    .setDescription(`Host: <@${hostId}>`)
                    .addFields(
                        { name: 'Members in Room', value: members.map(m => `<@${m.id}>`).join('\n') || 'None', inline: true },
                        { name: 'Muted Members', value: mutedMembers.join('\n') || 'None', inline: true },
                        { name: 'Non-Muted Members', value: nonMutedMembers.join('\n') || 'None', inline: true },
                        { name: 'Invited Members', value: invited.join('\n') || 'None', inline: false }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });

            case 'rename':
                const newName = interaction.options.getString('name');
                const badWords = ['nigger', 'nigga', 'niqqer', 'faggot', 'fag', 'blackie', 'chink', 'jigaboo', 'nig', 'Jigaboo', 'jiggabo', 'jigarooni', 'jijjiboo', 'zigabo', 'Abbie', 'jig' , 'Abe', 'jigg', 'Jungle bunny' , 'border bunny', 'jigger', 'Abie', 'Ape', 'Annamite', 'mites', 'Arabush','Bimbo', 'Chankoro', 'Chinky',
                    'Chonky', 'Christ-killer', 'Choc-ice', 'Coon', 'Cotton picker', 'Curry-muncher', 'kyke', 'Kike', 'Moon Cricket', 'Niglet', 'Negrito', 'Nig-nog', 'Nignog', 'neeger ', 'neeger', 'niger', 'nigor', 'nigra','nigre','nigar','niggur','niggah','niggar','nigguh','niggress','nigette','negro','neger','Niggeritis','Negroitis','Prairie nigger','Sheboon', 'Shitskin', 'Towel head', 'Wetback', 'retard', 'sped', 'fuck', 'shit', 'bitch', 'gay', 'homo'];
                const badWordRegex = new RegExp(badWords.join('|'), 'i');
                const logChannelId = '1322247458897793054';
                const logChannel = interaction.guild.channels.cache.get(logChannelId);

                let logEmbed = new EmbedBuilder()
                    .setTitle('Room Rename Attempt')
                    .setDescription(`Room: **${roomChannel.name}**`)
                    .setColor(0xFFCC00)
                    .setTimestamp()
                    .setFooter({ text: `Channel ID: ${roomChannel.id}` });

                if (!logChannel) {
                    console.error(`Log channel with ID ${logChannelId} not found.`);
                    return interaction.reply({ content: 'Error: Unable to log the rename. Please contact an administrator.', ephemeral: true });
                }

                if (badWordRegex.test(newName)) {
                    logEmbed.addFields(
                        { name: 'Renamed By', value: `<@${interaction.user.id}>` },
                        { name: 'New Name Attempt', value: newName },
                        { name: 'Status', value: 'Blocked - Contains Prohibited Words' }
                    );
                    await logChannel.send({ embeds: [logEmbed] });
                    return interaction.reply({ content: 'The provided name contains prohibited words. Please choose a different name.', ephemeral: true });
                }

                if (!/^[a-zA-Z0-9 _-]+$/.test(newName)) {
                    logEmbed.addFields(
                        { name: 'Renamed By', value: `<@${interaction.user.id}>` },
                        { name: 'New Name Attempt', value: newName },
                        { name: 'Status', value: 'Blocked - Contains Invalid Characters' }
                    );
                    await logChannel.send({ embeds: [logEmbed] });
                    return interaction.reply({ content: 'The provided name contains invalid characters. Please use only letters, numbers, spaces, underscores, or dashes.', ephemeral: true });
                }

                if (newName.length > 100) {
                    logEmbed.addFields(
                        { name: 'Renamed By', value: `<@${interaction.user.id}>` },
                        { name: 'New Name Attempt', value: newName },
                        { name: 'Status', value: 'Blocked - Name Too Long' }
                    );
                    await logChannel.send({ embeds: [logEmbed] });
                    return interaction.reply({ content: 'The room name is too long. Please keep it under 100 characters.', ephemeral: true });
                }

                await roomChannel.setName(newName);

                logEmbed
                    .setColor(0x00FF00)
                    .addFields(
                        { name: 'Renamed By', value: `<@${interaction.user.id}>` },
                        { name: 'New Name', value: newName },
                        { name: 'Status', value: 'Successful' }
                    );
                await logChannel.send({ embeds: [logEmbed] });

                return interaction.reply({ content: `The room name has been changed to **${newName}**.`, ephemeral: true });
            case 'invite':
                const inviteUser = interaction.options.getUser('user');
                if (inviteUser) {
                    await roomChannel.permissionOverwrites.create(inviteUser.id, { Connect: true });
                    return interaction.reply({ content: `<@${inviteUser.id}> has been invited to the room.`, ephemeral: true });
                }
                return interaction.reply({ content: 'No user specified to invite.', ephemeral: true });

            case 'uninvite':
                const uninviteUser = interaction.options.getUser('user');
                if (uninviteUser) {
                    await roomChannel.permissionOverwrites.delete(uninviteUser.id);
                    return interaction.reply({ content: `<@${uninviteUser.id}> has been uninvited from the room.`, ephemeral: true });
                }
                return interaction.reply({ content: 'No user specified to uninvite.', ephemeral: true });

            case 'host':
                const newHost = interaction.options.getUser('user');
                if (newHost.id === hostId) {
                    return interaction.reply({ content: 'This user is already the host.', ephemeral: true });
                }
                client.vcHosts.set(roomChannel.id, newHost.id);
                return interaction.reply({ content: `<@${newHost.id}> is now the host.`, ephemeral: true });

            case 'mute':
                const muteUser = interaction.options.getUser('user');
                if (muteUser) {
                    await roomChannel.permissionOverwrites.edit(muteUser.id, { Speak: false });
                    return interaction.reply({ content: `<@${muteUser.id}> has been muted.`, ephemeral: true });
                } else {
                    await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Speak: false });
                    return interaction.reply({ content: 'All users in the room have been muted.', ephemeral: true });
                }

            case 'unmute':
                const unmuteUser = interaction.options.getUser('user');
                if (unmuteUser) {
                    await roomChannel.permissionOverwrites.edit(unmuteUser.id, { Speak: true });
                    return interaction.reply({ content: `<@${unmuteUser.id}> has been unmuted.`, ephemeral: true });
                } else {
                    await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Speak: true });
                    return interaction.reply({ content: 'All users in the room have been unmuted.', ephemeral: true });
                }

            case 'lock':
                await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Connect: false });
                return interaction.reply({ content: 'The room has been locked.', ephemeral: true });

            case 'unlock':
                await roomChannel.permissionOverwrites.edit(roomChannel.guild.roles.everyone, { Connect: true });
                return interaction.reply({ content: 'The room has been unlocked.', ephemeral: true });

            case 'kick':
                const kickUser = interaction.options.getUser('user');
                const kickMember = roomChannel.members.get(kickUser.id);
                if (kickMember) {
                    await kickMember.voice.disconnect();
                    return interaction.reply({ content: `<@${kickUser.id}> has been kicked from the room.`, ephemeral: true });
                }
                return interaction.reply({ content: 'The user is not in the room.', ephemeral: true });

            case 'block':
                const blockUser = interaction.options.getUser('user');

                if (!blockUser) {
                    return interaction.reply({ content: 'You must specify a user to block.', ephemeral: true });
                }

                if (blockUser.id === interaction.user.id) {
                    return interaction.reply({ content: 'You cannot block yourself from your own room.', ephemeral: true });
                }

                const blockPermission = roomChannel.permissionOverwrites.cache.get(blockUser.id);
                if (blockPermission && blockPermission.deny.has('Connect')) {
                    return interaction.reply({ content: `<@${blockUser.id}> is already blocked from joining the room.`, ephemeral: true });
                }

                try {
                    await roomChannel.permissionOverwrites.edit(blockUser.id, { Connect: false });
                    return interaction.reply({ content: `<@${blockUser.id}> has been blocked from joining the room.`, ephemeral: true });
                } catch (error) {
                    console.error('Error blocking user:', error);
                    return interaction.reply({ content: 'An error occurred while trying to block the user. Please try again later.', ephemeral: true });
                }

            case 'unblock':
                const unblockUser = interaction.options.getUser('user');

                if (!unblockUser) {
                    return interaction.reply({ content: 'You must specify a user to unblock.', ephemeral: true });
                }

                const unblockPermission = roomChannel.permissionOverwrites.cache.get(unblockUser.id);

                if (!unblockPermission || !unblockPermission.deny.has('Connect')) {
                    return interaction.reply({ content: `<@${unblockUser.id}> is not currently blocked from joining the room.`, ephemeral: true });
                }

                try {
                    await roomChannel.permissionOverwrites.edit(unblockUser.id, { Connect: null });
                    return interaction.reply({ content: `<@${unblockUser.id}> has been unblocked from joining the room.`, ephemeral: true });
                } catch (error) {
                    console.error('Error unblocking user:', error);
                    return interaction.reply({ content: 'An error occurred while trying to unblock the user. Please try again later.', ephemeral: true });
                }
            default:
                return interaction.reply({ content: 'Invalid command.', ephemeral: true });
        }
    },
};