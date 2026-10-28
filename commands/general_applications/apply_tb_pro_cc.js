const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createModal } = require('../../modals/modalFactory');
const { noticePayload } = require('../../utils/ui');
const { TB_PRO_CC_ROLE_ID, TB_PRO_CC_ELIGIBLE_ROLE_IDS } = require('../../config/constants');

const SUBTITLE = 'TB PRO CC Application';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply-tb-pro-cc')
        .setDescription('Submit an application to become TB PRO CC'),
    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (member.roles.cache.has(TB_PRO_CC_ROLE_ID)) {
            await interaction.reply({
                ...noticePayload(
                    'You are already TB PRO CC and cannot submit another application.',
                    { title: 'Already TB PRO CC', subtitle: SUBTITLE }
                ),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
            return;
        }

        if (!TB_PRO_CC_ELIGIBLE_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) {
            await interaction.reply({
                ...noticePayload(
                    `Only ${TB_PRO_CC_ELIGIBLE_ROLE_IDS.map(id => `<@&${id}>`).join(' and ')} members can apply for TB PRO CC.`,
                    { title: 'Role Required', subtitle: SUBTITLE }
                ),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
            return;
        }

        const modal = createModal('tbProCcApplicationModal');
        if (modal) {
            await interaction.showModal(modal);
        } else {
            await interaction.reply({
                ...noticePayload(
                    'Error loading the application form. Please try again soon.',
                    { title: 'Form Unavailable', subtitle: SUBTITLE }
                ),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }
    }
};
