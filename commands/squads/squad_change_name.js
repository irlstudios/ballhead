const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient } = require('../../utils/sheets_cache');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('change-squad-name')
        .setDescription('Change the name of your squad if you are the squad leader.')
        .addStringOption(option =>
            option.setName('new-name')
                .setDescription('The new name for your squad. (1-4 alphanumeric characters)')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const newSquadName = interaction.options.getString('new-name').toUpperCase();
        const guild = interaction.guild;

        const squadNamePattern = /^[A-Z0-9]{1,4}$/;
        if (!squadNamePattern.test(newSquadName)) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Squad Name'),
                new TextDisplayBuilder().setContent('The name must be between 1 and 4 alphanumeric characters.')
            );
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        const sheets = await getSheetsClient();
        const spreadsheetId = '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k';

        try {
            const squadLeadersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F'
            });

            const squadMembersResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E'
            });

            const allDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H'
            });

            const squadLeaders = squadLeadersResponse.data.values || [];
            const squadMembers = squadMembersResponse.data.values || [];
            const allData = allDataResponse.data.values || [];

            const leaderRowIndex = squadLeaders.findIndex(row => row && row.length > 1 && row[1] === userId);
            if (leaderRowIndex === -1) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## No Squad Owned'),
                    new TextDisplayBuilder().setContent('You do not own a squad, so you cannot change the squad name.')
                );
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            }
            const userSquadLeaderRow = squadLeaders[leaderRowIndex];
            const currentSquadName = userSquadLeaderRow[2];

            const isSquadNameTaken = squadLeaders.some((row, index) => row && row.length > 2 && row[2] === newSquadName && index !== leaderRowIndex);
            if (isSquadNameTaken) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Name Already Used'),
                    new TextDisplayBuilder().setContent(`The squad name ${newSquadName} is already in use.\nPlease choose a different name.`)
                );
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            }

            const updatedSquadLeaders = squadLeaders.map(row => {
                if (!row || row.length < 3) return row;
                if (row[1] === userId) {
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5]];
                }
                return row;
            });

            const updatedSquadMembers = squadMembers.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2] === currentSquadName) {
                    return [row[0], row[1], newSquadName, row[3], row[4]];
                }
                return row;
            });

            const updatedAllData = allData.map(row => {
                if (!row || row.length < 3) return row;
                if (row[2] === currentSquadName) {
                    return [row[0], row[1], newSquadName, row[3], row[4], row[5], row[6], row[7]];
                }
                return row;
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Leaders!A:F',
                valueInputOption: 'RAW',
                resource: { values: updatedSquadLeaders }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'Squad Members!A:E',
                valueInputOption: 'RAW',
                resource: { values: updatedSquadMembers }
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: 'All Data!A:H',
                valueInputOption: 'RAW',
                resource: { values: updatedAllData }
            });

            const squadMembersToNotify = squadMembers.filter(row => row && row.length > 2 && row[2] === currentSquadName);
            for (const memberRow of squadMembersToNotify) {
                if (!memberRow || memberRow.length < 2) continue;
                const memberId = memberRow[1];
                try {
                    const member = await guild.members.fetch(memberId);
                    if (member) {
                        const dmContainer = new ContainerBuilder();
                        dmContainer.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('## Squad Name Changed'),
                            new TextDisplayBuilder().setContent(`The squad name has been changed from **${currentSquadName}** to **${newSquadName}** by the squad leader.`)
                        );
                        await member.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] }).catch(err => console.log(`Failed to DM ${memberId}: ${err.message}`));

                        try {
                            await member.setNickname(`[${newSquadName}] ${member.user.username}`);
                        } catch (error) {
                            if (error.code !== 50013) {
                                console.log(`Could not update nickname for ${member.user.tag} (${memberId}):`, error.message);
                            }
                        }
                    }
                } catch (error) {
                    console.log(`Could not fetch member ${memberId} for notification: ${error.message}`);
                }
            }

            try {
                const leader = await guild.members.fetch(userId);
                if (leader) {
                    try {
                        await leader.setNickname(`[${newSquadName}] ${leader.user.username}`);
                    } catch (error) {
                        if (error.code !== 50013) {
                            console.log(`Could not update nickname for leader ${leader.user.tag} (${userId}):`, error.message);
                        }
                    }
                }
            } catch (error) {
                console.log(`Could not fetch leader ${userId} for nickname update: ${error.message}`);
            }


            const loggingChannel = await interaction.client.guilds.fetch('1233740086839869501')
                .then(guild => guild.channels.fetch('1233853415952748645'))
                .catch(() => null);

            if (loggingChannel) {
                try {
                    const logContainer = new ContainerBuilder();
                    logContainer.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('## Squad Name Changed'),
                        new TextDisplayBuilder().setContent(`The squad **${currentSquadName}** has been renamed to **${newSquadName}** by **${interaction.user.tag}** (${interaction.user.id}).`)
                    );
                    await loggingChannel.send({ flags: MessageFlags.IsComponentsV2, components: [logContainer] });
                } catch (logError) {
                    console.error('Failed to send log message:', logError);
                }
            }

            const successContainer = new ContainerBuilder();
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Squad Name Changed'),
                new TextDisplayBuilder().setContent(`Your squad name has been successfully changed from **${currentSquadName}** to **${newSquadName}**.\nAll members have been notified and nicknames updated (where possible).`)
            );

            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [successContainer], ephemeral: true });

        } catch (error) {
            console.error('Error during the change-squad-name command execution:', error);
            let errorMessage = 'An error occurred while changing the squad name. Please try again later.';
            if (error.response && error.response.data && error.response.data.error) {
                errorMessage += ` (Details: ${error.response.data.error.message})`;
            } else if (error.message) {
                errorMessage += ` (Details: ${error.message})`;
            }
            const errorContainer = new ContainerBuilder();
            errorContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Rename Failed'),
                new TextDisplayBuilder().setContent(errorMessage)
            );
            await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [errorContainer], ephemeral: true });
        }
    }
};
