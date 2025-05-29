const { ChannelType, PermissionFlagsBits } = require('discord.js');
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
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        if (!client.vcHosts) {
            client.vcHosts = new Map();
            const res = await pool.query('SELECT channel_id, host_id FROM vc_hosts');
            for (const row of res.rows) {
                client.vcHosts.set(row.channel_id, row.host_id);
            }
        }

        const specificVCID = '1321321682891178074';
        const MOD_ROLE_ID = '805833778064130104';
        const VC_BLACK_LIST_ID = '1125497495678615582';
        const ADMIN_ID = '781397829808553994';

        if (oldState.channelId !== specificVCID && newState.channelId === specificVCID) {
            const guild = newState.guild;
            const newChannel = await guild.channels.create({
                name: `${newState.member.displayName}'s Room`,
                type: ChannelType.GuildVoice,
                parent: newState.channel.parent,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone,
                        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
                        deny: [PermissionFlagsBits.Stream, PermissionFlagsBits.UseEmbeddedActivities, PermissionFlagsBits.SendMessages, PermissionFlagsBits.UseSoundboard, PermissionFlagsBits.UseExternalSounds]
                    },
                    {
                        id: newState.member.id,
                        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Speak],
                        deny: [PermissionFlagsBits.Stream, PermissionFlagsBits.UseEmbeddedActivities]
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers]
                    },
                    {
                        id: MOD_ROLE_ID,
                        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream, PermissionFlagsBits.UseEmbeddedActivities]
                    },
                    {
                        id: ADMIN_ID,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.Speak,
                            PermissionFlagsBits.Stream,
                            PermissionFlagsBits.UseEmbeddedActivities,
                            PermissionFlagsBits.UseSoundboard,
                            PermissionFlagsBits.UseExternalSounds,
                            PermissionFlagsBits.MoveMembers,
                            PermissionFlagsBits.ManageChannels
                        ]
                    },
                    {
                        id: VC_BLACK_LIST_ID,
                        deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream, PermissionFlagsBits.UseEmbeddedActivities, PermissionFlagsBits.SendMessages]
                    }
                ]
            });

            await newState.setChannel(newChannel);
            client.vcHosts.set(newChannel.id, newState.member.id);
            await pool.query('INSERT INTO vc_hosts(channel_id, host_id) VALUES($1, $2)', [newChannel.id, newState.member.id]);
        }

        if (oldState.channelId && oldState.channelId !== newState.channelId) {
            const guild = oldState.guild;
            const channel = guild.channels.cache.get(oldState.channelId);
            const hostId = client.vcHosts.get(channel.id);
            if (channel && oldState.member.id === hostId) {
                await channel.delete();
                client.vcHosts.delete(channel.id);
                await pool.query('DELETE FROM vc_hosts WHERE channel_id = $1', [channel.id]);
            } else if (channel && client.vcHosts.has(channel.id) && channel.members.size === 0) {
                await channel.delete();
                client.vcHosts.delete(channel.id);
                await pool.query('DELETE FROM vc_hosts WHERE channel_id = $1', [channel.id]);
            }
        }
    }
};