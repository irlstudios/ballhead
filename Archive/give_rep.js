// +----------------------------------------------------------------------------------------------------+
// |  Everything commented out, so i can push working code to the new git without breaking client boot  |
// +----------------------------------------------------------------------------------------------------+
//
//const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, Collection} = require('discord.js');
//const axios = require('axios');
//
//module.exports = {
//    data: new SlashCommandBuilder()
//        .setName('give-rep')
//        .setDescription('View your recent games, and give rep to your opponent'),
//
//
//    async execute(interaction) {
//        await interaction.deferReply({
//            ephemeral: true,
//        })
//
//        const member = interaction.member;
//
//        const gamedata = await axios.get(`
//        // Data from the game server
//        `);
//
//        const buttons = new Collection(
//
//        );
//
//       const embed = new EmbedBuilder()
//            .setColor(0xff0000)
//            .setTitle('Your Games')
//            .setDescription(
//                null
//                // This needs to be their ${gamedata} from the endpoint
//           )
//
//
//
//        await interaction.reply({
//            content: embed
//        })
//    }
//}