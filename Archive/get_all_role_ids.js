const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-role-ids')
        .setDescription('List all role IDs in the server with optional role names.')
        .addBooleanOption(option =>
            option.setName('add_name')
                .setDescription('Include role names in the CSV output')
                .setRequired(false)
        ),

    async execute(interaction) {
        const addName = interaction.options.getBoolean('add_name') ?? false;

        const roles = interaction.guild.roles.cache.sort((a, b) => b.position - a.position);

        let csvContent = addName ? 'Role ID,Role Name\n' : 'Role ID\n';
        roles.forEach(role => {
            csvContent += addName ? `${role.id},"${role.name.replace(/"/g, '""')}"\n` : `${role.id}\n`;
        });

        const filePath = path.join(os.tmpdir(), `role-ids-${interaction.guild.id}.csv`);
        fs.writeFileSync(filePath, csvContent);

        const file = new AttachmentBuilder(filePath, { name: 'role_ids.csv' });

        await interaction.reply({
            content: `Here is the list of all role IDs${addName ? ' with names' : ''}.`,
            files: [file],
            ephemeral: true
        });

        setTimeout(() => {
            fs.unlink(filePath, err => {
                if (err) console.error('Error deleting temp CSV file:', err);
            });
        }, 10000);
    }
};