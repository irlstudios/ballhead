'use strict';

// A restart between channel creation and the vc_hosts insert leaves an
// orphan: a real room channel the system does not know about, which would
// otherwise never be auto-deleted. Adopt occupied orphans (host is the first
// human present) so the normal leave flow cleans them up.

const { ChannelType } = require('discord.js');
const logger = require('./logger');
const { pool } = require('../db');
const { VC_CREATE_CHANNEL_ID } = require('../config/constants');

const adoptOrphanRooms = async (client) => {
    const createChannel = client.channels.cache.get(VC_CREATE_CHANNEL_ID);
    if (!createChannel?.guild) return;
    const { rows } = await pool.query('SELECT channel_id FROM vc_hosts');
    const managed = new Set(rows.map((row) => row.channel_id));
    // Personal rooms are identified by the name the create flow gives them,
    // not by category: permanent voice channels share categories with rooms.
    const orphans = createChannel.guild.channels.cache.filter((channel) =>
        channel.type === ChannelType.GuildVoice
        && channel.id !== VC_CREATE_CHANNEL_ID
        && !managed.has(channel.id)
        && /'s Room$/.test(channel.name));
    for (const [, channel] of orphans) {
        try {
            // NEVER delete anything here: an empty unmanaged channel might be
            // a permanent channel or a renamed room; deletion is not our call.
            // Occupied orphans get adopted; empty ones are left alone.
            const firstHuman = channel.members.find((member) => !member.user.bot);
            if (!firstHuman) continue;
            // host_id is UNIQUE; clear any stale row for this host first or
            // the adoption insert dies on the constraint.
            await pool.query(
                'DELETE FROM vc_hosts WHERE host_id = $2 AND channel_id <> $1',
                [channel.id, firstHuman.id]
            );
            await pool.query(
                `INSERT INTO vc_hosts(channel_id, host_id, created_at) VALUES($1, $2, now())
                 ON CONFLICT (channel_id) DO NOTHING`,
                [channel.id, firstHuman.id]
            );
            if (client.vcHosts) client.vcHosts.set(channel.id, firstHuman.id);
            logger.info(`[Rooms] Adopted orphan room ${channel.id} with host ${firstHuman.id}.`);
        } catch (error) {
            logger.error(`[Rooms] Orphan adoption failed for ${channel.id}: ${error?.message || error}`);
        }
    }
};

module.exports = { adoptOrphanRooms };
