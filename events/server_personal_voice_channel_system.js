const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { Pool } = require('pg');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const retryAction = async (action, check, retries = 3, delayMs = 500) => {
    for (let i = 0; i < retries; i++) {
        await action();
        if (await check()) {
            return;
        }
        await delay(delayMs);
    }
    throw new Error('Action failed after retries');
};
const BLACKLIST_USER_IDS = new Set();

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};
const pool = new Pool(clientConfig);
const COOLDOWN_MS = Number(process.env.VC_CREATE_COOLDOWN_SECONDS || '60') * 1000;

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
        if (!client.vcCooldowns) {
            client.vcCooldowns = new Map();
        }
        if (!client.vcCreated) {
            client.vcCreated = new Set();
        }

        const specificVCID = '1321321682891178074';
        const MOD_ROLE_ID = '805833778064130104';
        const VC_BLACK_LIST_ID = '1125497495678615582';
        const ADMIN_ID = '781397829808553994';

        if (oldState.channelId !== specificVCID && newState.channelId === specificVCID && BLACKLIST_USER_IDS.has(newState.member.id)) {
            await newState.setChannel(null);
            return;
        }

        if (newState.channelId && client.vcHosts && client.vcHosts.has(newState.channelId) && BLACKLIST_USER_IDS.has(newState.member.id)) {
            await newState.setChannel(null);
            return;
        }

        if (oldState.channelId !== specificVCID && newState.channelId === specificVCID) {
            const now = Date.now();
            const last = client.vcCooldowns.get(newState.member.id) || 0;
            if (now - last < COOLDOWN_MS) {
                const remaining = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
                await newState.member.send(`You are on cooldown for creating a voice channel. Please wait ${remaining}s and try again.`).catch(() => {});
                await newState.setChannel(null);
                return;
            }
            const guild = newState.guild;
            const newChannel = await guild.channels.create({
                name: `${newState.member.displayName}'s Room`,
                type: ChannelType.GuildVoice,
                parent: newState.channel.parent,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
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
            client.vcCreated.add(newChannel.id);
            for (const id of BLACKLIST_USER_IDS) {
                const member = await newChannel.guild.members.fetch(id).catch(() => null);
                if (!member) continue;
                try {
                    await newChannel.permissionOverwrites.edit(member, {
                        Connect: false,
                        Speak: false,
                        Stream: false,
                        UseEmbeddedActivities: false,
                        SendMessages: false
                    });
                } catch (error) {
                    if (error?.code !== 10003) throw error;
                }
            }

            try {
                await retryAction(
                    () => newState.setChannel(newChannel),
                    async () => newState.member.voice.channelId === newChannel.id,
                    3,
                    500
                );
            } catch (e) {
                await newChannel.delete().catch(() => {});
                client.vcCreated.delete(newChannel.id);
                return;
            }
            await delay(200);
            if (newState.member.voice.channelId !== newChannel.id) {
                await newChannel.delete().catch(() => {});
                client.vcCreated.delete(newChannel.id);
                return;
            }
            client.vcCooldowns.set(newState.member.id, Date.now());
            client.vcHosts.set(newChannel.id, newState.member.id);
            await pool.query(
              `INSERT INTO vc_hosts(channel_id, host_id, created_at)
               VALUES($1, $2, now())
               ON CONFLICT (channel_id)
                 DO UPDATE SET host_id = EXCLUDED.host_id, created_at = now()`,
              [newChannel.id, newState.member.id]
            );
        }

        if (oldState.channelId && oldState.channelId !== newState.channelId) {
            const guild = oldState.guild;
            const channel = guild.channels.cache.get(oldState.channelId);
            const hostId = channel ? client.vcHosts.get(channel.id) : undefined;

            if (!channel) {
                if (client.vcHosts.has(oldState.channelId)) {
                    client.vcHosts.delete(oldState.channelId);
                    await pool.query('DELETE FROM vc_hosts WHERE channel_id = $1', [oldState.channelId]);
                }
                return;
            }

            const safeDelete = async (ch) => {
                try {
                    await retryAction(
                        () => ch.delete(),
                        async () => {
                            try {
                                await ch.guild.channels.fetch(ch.id);
                                return false;
                            } catch {
                                return true;
                            }
                        },
                        3,
                        500
                    );
                } catch (error) {
                    if (error?.code !== 10003) throw error;
                }
            };

            if (oldState.member.id === hostId) {
                await safeDelete(channel);
                client.vcHosts.delete(channel.id);
                await pool.query('DELETE FROM vc_hosts WHERE channel_id = $1', [channel.id]);
                if (client.vcCreated) client.vcCreated.delete(channel.id);
            } else if ((client.vcHosts.has(channel.id) || (client.vcCreated && client.vcCreated.has(channel.id))) && channel.members.size === 0) {
                await safeDelete(channel);
                client.vcHosts.delete(channel.id);
                if (client.vcCreated) client.vcCreated.delete(channel.id);
                await pool.query('DELETE FROM vc_hosts WHERE channel_id = $1', [channel.id]);
            }
        }
    }
};
