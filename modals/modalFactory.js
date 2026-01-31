const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const modalConfig = require('./modalConfig');

function createModal(type) {
    const config = modalConfig[type];
    if (!config) {
        console.error(`No modal configuration found for type: ${type}`);
        return null;
    }

    const modal = new ModalBuilder()
        .setCustomId(type)
        .setTitle(config.title);

    config.fields.forEach(field => {
        const textInput = new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label)
            .setStyle(TextInputStyle[field.style] ?? TextInputStyle.Short)
            .setRequired(Boolean(field.required));

        if (field.placeholder) {
            textInput.setPlaceholder(field.placeholder);
        }

        const actionRow = new ActionRowBuilder().addComponents(textInput);
        modal.addComponents(actionRow);
    });

    return modal;
}

module.exports = { createModal };
