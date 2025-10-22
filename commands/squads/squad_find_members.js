const { SlashCommandBuilder } = require('discord.js');
const { Client } = require('pg');
const {createModal} = require('../../modals/modalFactory');

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};  

module.exports = {
    data: new SlashCommandBuilder()
        .setName('find-squad-members')
        .setDescription('Create a post to find members for your squad'),
    async execute(interaction) {
        const squadLeaderRoleId = '1218468103382499400';

        if (!interaction.member.roles.cache.has(squadLeaderRoleId)) {
            return interaction.reply({content: 'You must be a Squad Leader to use this command.', ephemeral: true});
        }

        const client = new Client(clientConfig);
        await client.connect();

        try {
            const result = await client.query(
                'SELECT post_owner_discord_id FROM "lfm_data" WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                [interaction.user.id]
            );

            if (result.rows.length > 0) {
                return interaction.reply({
                    content: 'You already have an active recruitment post. Please close it before creating a new one.',
                    ephemeral: true
                });
            }

            const modal = createModal('LfgSystem2Create');
            if (modal) {
                await interaction.showModal(modal);
            } else {
                await interaction.send.reply({ content: 'Error loading the application form.', ephemeral: true });
            }
        } catch (error) {
            console.log(error);
            return interaction.reply({content: 'Error loading the application form.', ephemeral: true });
        }
    }
};

