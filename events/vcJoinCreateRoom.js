const { ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        const specificVCID = '1321321682891178074';
        const MOD_ROLE_ID = '805833778064130104';
        const VC_BLACK_LIST_ID = '1125497495678615582';

        if (oldState.channelId !== specificVCID && newState.channelId === specificVCID) {
            const guild = newState.guild;

            try {
                const newChannel = await guild.channels.create({
                    name: `${newState.member.displayName}'s Room`,
                    type: ChannelType.GuildVoice,
                    parent: newState.channel.parent,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone,
                            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
                            deny: [PermissionFlagsBits.Stream, PermissionFlagsBits.UseEmbeddedActivities, PermissionFlagsBits.SendMessages, PermissionFlagsBits.UseSoundboard, PermissionFlagsBits.UseExternalSounds,],
                        },
                        {
                            id: newState.member.id,
                            allow: [
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.MoveMembers,
                                PermissionFlagsBits.Speak,
                            ],
                            deny: [
                                PermissionFlagsBits.Stream,
                                PermissionFlagsBits.UseEmbeddedActivities
                            ]
                        },
                        {
                            id: client.user.id,
                            allow: [
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.MoveMembers,
                            ],
                        },
                        {
                            id: MOD_ROLE_ID,
                            allow: [
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.Speak,
                                PermissionFlagsBits.Stream,
                                PermissionFlagsBits.UseEmbeddedActivities,
                            ],
                        },
                        {
                            id: VC_BLACK_LIST_ID,
                            deny: [
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.Speak,
                                PermissionFlagsBits.Stream,
                                PermissionFlagsBits.UseEmbeddedActivities,
                                PermissionFlagsBits.SendMessages,
                            ]
                        }
                    ],
                });

                await newState.setChannel(newChannel);

                client.vcHosts = client.vcHosts || new Map();
                client.vcHosts.set(newChannel.id, newState.member.id);

                console.log(`Created VC "${newChannel.name}" for ${newState.member.displayName}.`);
            } catch (error) {
                console.error('Error creating public VC:', error);
            }
        }

        if (oldState.channelId && oldState.channelId !== newState.channelId) {
            const guild = oldState.guild;
            const channelId = oldState.channelId;

            if (client.vcHosts?.has(channelId)) {
                const hostId = client.vcHosts.get(channelId);

                if (oldState.member.id === hostId) {
                    try {
                        const channel = guild.channels.cache.get(channelId);
                        if (channel) {
                            await channel.delete();
                            console.log(`Deleted VC "${channel.name}" as the host (${oldState.member.displayName}) left or switched.`);
                        }

                        client.vcHosts.delete(channelId);
                    } catch (error) {
                        console.error('Error deleting VC:', error);
                    }
                }
            }
        }
    },
};