const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { Client } = require('pg');
const {createModal} = require('../../modals/modalFactory');

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
    ssl: { rejectUnauthorized: false } };  

module.exports = {
    data: new SlashCommandBuilder()
        .setName('find-squad-members')
        .setDescription('Create a post to find members for your squad'),
    async execute(interaction) {
        const squadLeaderRoleId = '1218468103382499400';

        if (!interaction.member.roles.cache.has(squadLeaderRoleId)) {
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Role Required', subtitle: 'Squad Recruitment', lines: ['You must be a Squad Leader to use this command.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }

        const client = new Client(clientConfig);
        await client.connect();

        try {
            const result = await client.query(
                'SELECT post_owner_discord_id FROM "lfm_data" WHERE post_owner_discord_id = $1 AND discord_thread_id IS NOT NULL',
                [interaction.user.id]
            );

            if (result.rows.length > 0) {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Active Post Found', subtitle: 'Squad Recruitment', lines: ['You already have an active recruitment post. Please close it before creating a new one.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }

            const modal = createModal('LfgSystem2Create');
            if (modal) {
                await interaction.showModal(modal);
            } else {
                const errorContainer = new ContainerBuilder();
                const block = buildTextBlock({ title: 'Form Unavailable', subtitle: 'Squad Recruitment', lines: ['Error loading the application form.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
                await interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
            }
        } catch (error) {
            console.log(error);
            const errorContainer = new ContainerBuilder();
            const block = buildTextBlock({ title: 'Request Failed', subtitle: 'Squad Recruitment', lines: ['Error loading the application form.'] });
            if (block) errorContainer.addTextDisplayComponents(block);
            return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
