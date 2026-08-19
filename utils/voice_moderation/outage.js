'use strict';

// Watches PC transcriber health and enforces the no-public-rooms-while-down
// rule: on the down transition every monitored public room is locked and
// recorded; on recovery those rooms are unlocked. Health facts arrive from
// room monitor cycles, or from a direct probe while no rooms are active.

const { PermissionFlagsBits } = require('discord.js');
const logger = require('../logger');
const { pool } = require('../../db');
const { createHealth, recordSuccess, recordFailure } = require('./pc_health');
const { probeServer } = require('./whisper_client');
const { addSystemLock, removeSystemLock, listSystemLocks } = require('./system_locks');
const { activeMonitorCount } = require('./room_monitor');
const { onRoomLocked, makeRoomMonitored } = require('./room_glue');
const { WHISPER_FAILURE_THRESHOLD } = require('../../config/constants');

const PROBE_INTERVAL_MS = 60000;

// Pure transition wrapper over pc_health: adds a one-shot transition marker.
const createOutageState = ({ failureThreshold = WHISPER_FAILURE_THRESHOLD } = {}) => ({
    health: createHealth({ failureThreshold }), transition: null,
});

const applyOutcome = (state, ok) => {
    const health = ok ? recordSuccess(state.health) : recordFailure(state.health);
    const transition = health.healthy === state.health.healthy
        ? null
        : (health.healthy ? 'up' : 'down');
    return { health, transition };
};

let state = createOutageState({});
let clientRef = null;
let probeTimer = null;

const isHealthy = () => state.health.healthy;

const lockAllPublicRooms = async (client) => {
    const { rows } = await pool.query('SELECT channel_id, host_id FROM vc_hosts');
    for (const row of rows) {
        const channel = client.channels.cache.get(row.channel_id);
        if (!channel) continue;
        const overwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
        const isPublic = !overwrite || !overwrite.deny.has(PermissionFlagsBits.Connect);
        if (!isPublic) continue;
        try {
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: false });
            await addSystemLock(channel.id);
            // Locked rooms are private: the capture bot leaves with the lock.
            onRoomLocked(channel.id);
            await channel.send({
                content: 'Voice moderation is temporarily offline, so this room is now invite only. It will reopen automatically.',
                allowedMentions: { parse: [] },
            }).catch(() => {});
        } catch (error) {
            logger.error(`[Voice Mod] Could not system-lock ${channel.id}:`, error);
        }
    }
};

const unlockSystemLockedRooms = async (client) => {
    for (const channelId of await listSystemLocks()) {
        const channel = client.channels.cache.get(channelId);
        try {
            if (channel) {
                await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: null });
                await makeRoomMonitored(channelId);
                await channel.send({
                    content: 'Voice moderation is back. This room is public again.',
                    allowedMentions: { parse: [] },
                }).catch(() => {});
            }
            await removeSystemLock(channelId);
        } catch (error) {
            logger.error(`[Voice Mod] Could not unlock ${channelId}:`, error);
        }
    }
};

const onCycleOutcome = (ok) => {
    state = applyOutcome(state, ok);
    if (!clientRef || !state.transition) return;
    if (state.transition === 'down') {
        logger.warn('[Voice Mod] PC transcriber is down; locking public rooms.');
        void lockAllPublicRooms(clientRef);
    } else {
        logger.info('[Voice Mod] PC transcriber recovered; unlocking system-locked rooms.');
        void unlockSystemLockedRooms(clientRef);
    }
};

// While no monitors run, cycles produce no health facts; probe instead so
// the gate and recovery still see fresh state.
const initOutageWatch = (client) => {
    clientRef = client;
    if (probeTimer) return;
    probeTimer = setInterval(async () => {
        if (activeMonitorCount() > 0) return;
        onCycleOutcome(await probeServer({}));
    }, PROBE_INTERVAL_MS);
    if (typeof probeTimer.unref === 'function') probeTimer.unref();
};

module.exports = {
    createOutageState, applyOutcome, onCycleOutcome, isHealthy, initOutageWatch,
    lockAllPublicRooms, unlockSystemLockedRooms,
};
