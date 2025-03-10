const { SlashCommandBuilder } = require('discord.js');
const { Client } = require('pg');
const {createModal} = require("../modals/modalFactory");

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};  

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lfg-create')
        .setDescription('Create a LFG, LFS, or LFO post')
        .addStringOption(option =>
            option
                .setName('system')
                .setDescription('Select the system to create a post')
                .setRequired(true)
                .addChoices(
                    { name: 'Looking For Group', value: 'lfgSystem1' },
                    { name: 'Looking For Squad Members', value: 'lfgSystem2' },
                    { name: 'Looking For Officials', value: 'lfgSystem3'},
                )
        ),
    async execute(interaction) {
        const selectedSystem = interaction.options.getString('system');
        const pgClient = new Client(clientConfig);
        await pgClient.connect();

        try {
            const existingPost = await pgClient.query(
                'SELECT post_owner_discord_id FROM lfg_data WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                [interaction.user.id]
            );

            if (existingPost.rows.length > 0) {
                return interaction.reply({ content: 'You already have an active post. Please close it before creating a new one.', ephemeral: true });
            }

            if (selectedSystem === 'lfgSystem1') {
                let modal = createModal('LfgSystem1Create')
                await interaction.showModal(modal);
            } if (selectedSystem === 'lfgSystem2') {
                let modal = createModal('LfgSystem2Create');
                await interaction.showModal(modal);
            } if (selectedSystem === 'lfgSystem3') {
                let modal = createModal('LfgSystem3Create');
                await interaction.showModal(modal);
            }
        } catch (error) {
            console.error('Error creating post:', error);
            await interaction.reply({ content: 'An error occurred while creating your post.', ephemeral: true });
        } finally {
            await pgClient.end();
        }
    },
};
