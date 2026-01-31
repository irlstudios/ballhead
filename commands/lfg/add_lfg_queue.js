const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { Client } = require('pg');

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

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add_lfg_queue')
        .setDescription('Add a new LFG queue definition')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('key').setDescription('Unique key, e.g., comp_1v1').setRequired(true))
        .addStringOption(o => o.setName('name').setDescription('Visible name').setRequired(true))
        .addStringOption(o => o.setName('lobby_display_name').setDescription('Lobby display name').setRequired(true))
        .addStringOption(o => o.setName('lobby_id').setDescription('Lobby channel ID').setRequired(true))
        .addIntegerOption(o => o.setName('size').setDescription('Players per match').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Queue description').setRequired(true))
        .addStringOption(o => o.setName('play_type').setDescription('Play type').setRequired(true))
        .addStringOption(o => o.setName('play_rules').setDescription('Play rules').setRequired(true))
        .addStringOption(o => o.setName('region').setDescription('Region').setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString('key', true).trim();
        const name = interaction.options.getString('name', true).trim();
        const lobby_display_name = interaction.options.getString('lobby_display_name', true).trim();
        const lobby_id = interaction.options.getString('lobby_id', true).trim();
        const size = interaction.options.getInteger('size', true);
        const description = interaction.options.getString('description', true).trim();
        const play_type = interaction.options.getString('play_type', true).trim();
        const play_rules = interaction.options.getString('play_rules', true).trim();
        const region = interaction.options.getString('region', true).trim();
        if (!/^[a-z0-9_-]+$/.test(key)) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Invalid Key', subtitle: 'LFG Queue Setup', lines: ['Keys must use lowercase letters, numbers, underscores, or dashes.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            return;
        }
        if (size < 2 || size > 16) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Invalid Size', subtitle: 'LFG Queue Setup', lines: ['Size must be between 2 and 16 players.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            return;
        }
        const pgClient = new Client(clientConfig);
        try {
            await pgClient.connect();
            await pgClient.query(`CREATE TABLE IF NOT EXISTS lfg_queues (
                thread_id TEXT PRIMARY KEY,
                queue_key TEXT NOT NULL,
                queue_name TEXT NOT NULL,
                size INTEGER NOT NULL,
                status TEXT NOT NULL,
                participants TEXT[] NOT NULL,
                lobby_display_name TEXT,
                lobby_id TEXT,
                description TEXT,
                play_type TEXT,
                play_rules TEXT,
                region TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`);
            const pendingThreadId = `pending:${key}`;
            const emptyParticipants = [];
            const updateRes = await pgClient.query(
                `UPDATE lfg_queues SET
           queue_name = $2,
           size = $3,
           status = 'waiting',
           participants = COALESCE($4::text[], ARRAY[]::text[]),
           lobby_display_name = $5,
           lobby_id = $6,
           description = $7,
           play_type = $8,
           play_rules = $9,
           region = $10,
           updated_at = NOW()
         WHERE queue_key = $1
         RETURNING thread_id, queue_key, queue_name, size, lobby_display_name, lobby_id, region`,
                [key, name, size, emptyParticipants,
                    lobby_display_name, lobby_id, description, play_type, play_rules, region]
            );
            let row = updateRes.rows[0];
            if (!row) {
                const insertRes = await pgClient.query(
                    `INSERT INTO lfg_queues(
           thread_id, queue_key, queue_name, size, status, participants,
           lobby_display_name, lobby_id, description, play_type, play_rules, region, updated_at)
         VALUES($1,$2,$3,$4,'waiting',COALESCE($5::text[], ARRAY[]::text[]),
                $6,$7,$8,$9,$10,$11,NOW())
         RETURNING thread_id, queue_key, queue_name, size, lobby_display_name, lobby_id, region`,
                    [pendingThreadId, key, name, size, emptyParticipants,
                        lobby_display_name, lobby_id, description, play_type, play_rules, region]
                );
                row = insertRes.rows[0];
            }
            await pgClient.end();
            const successContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Queue Saved', subtitle: 'LFG Queue Setup', lines: [
                `**Queue:** ${row.queue_name} (${row.queue_key })`,
                `**Thread ID:** ${row.thread_id}`,
                `**Region:** ${row.region || 'N/A'}`
            ] });
            if (block) successContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer] });
            interaction.client.emit('lfg:refresh');
        } catch (e) {
            try {
                await pgClient.end();
            } catch (closeError) {
                console.error('Failed to close PG client:', closeError);
            }
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Save Failed', subtitle: 'LFG Queue Setup', lines: [`Error saving queue: ${e.message}`] });
            if (block) errorContainer.addTextDisplayComponents(block);
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
        }
    }
};
