const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { Client } = require('pg');

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
    await interaction.deferReply({ flags: 64 });
    const key = interaction.options.getString('key', true).trim();
    const name = interaction.options.getString('name', true).trim();
    const lobby_display_name = interaction.options.getString('lobby_display_name', true).trim();
    const lobby_id = interaction.options.getString('lobby_id', true).trim();
    const size = interaction.options.getInteger('size', true);
    const description = interaction.options.getString('description', true).trim();
    const play_type = interaction.options.getString('play_type', true).trim();
    const play_rules = interaction.options.getString('play_rules', true).trim();
    const region = interaction.options.getString('region', true).trim();
    if (!/^[a-z0-9_\-]+$/.test(key)) {
      await interaction.editReply({ content: 'Invalid key.' });
      return;
    }
    if (size < 2 || size > 16) {
      await interaction.editReply({ content: 'Invalid size.' });
      return;
    }
    const pgClient = new Client(clientConfig);
    try {
      await pgClient.connect();
      const pendingThreadId = `pending:${key}`;
      const emptyParticipants = [];
      const upsertRes = await pgClient.query(
        `INSERT INTO lfg_queues(
           thread_id, queue_key, queue_name, size, status, participants,
           lobby_display_name, lobby_id, description, play_type, play_rules, region, updated_at)
         VALUES($1,$2,$3,$4,'waiting',COALESCE($5::text[], ARRAY[]::text[]),
                $6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (queue_key) DO UPDATE SET
           queue_name=EXCLUDED.queue_name,
           size=EXCLUDED.size,
           status=EXCLUDED.status,
           participants=EXCLUDED.participants,
           lobby_display_name=EXCLUDED.lobby_display_name,
           lobby_id=EXCLUDED.lobby_id,
           description=EXCLUDED.description,
           play_type=EXCLUDED.play_type,
           play_rules=EXCLUDED.play_rules,
           region=EXCLUDED.region,
           updated_at=NOW()
         RETURNING thread_id, queue_key, queue_name, size, lobby_display_name, lobby_id, region`,
        [pendingThreadId, key, name, size, emptyParticipants,
         lobby_display_name, lobby_id, description, play_type, play_rules, region]
      );
      await pgClient.end();
      const row = upsertRes.rows[0];
      await interaction.editReply({ content: `Saved queue ${row.queue_name} (${row.queue_key}). thread_id=${row.thread_id}` });
      interaction.client.emit('lfg:refresh');
    } catch (e) {
      try { await pgClient.end(); } catch {}
      await interaction.editReply({ content: `Error saving queue: ${e.message}` });
    }
  }
};