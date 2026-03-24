'use strict';

const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { getSheetsClient, getCachedValues } = require('../../utils/sheets_cache');
const {
    SPREADSHEET_SQUADS,
    GYM_CLASS_GUILD_ID,
    BOT_BUGS_CHANNEL_ID,
    SQUAD_LEADER_ROLE_ID,
    COMPETITIVE_SQUAD_OWNER_ROLE_ID,
    LEVEL_5_ROLE_ID,
} = require('../../config/constants');
const {
    findUserSquads, findUserAllDataRows, isSquadNameTaken,
    AD_SQUAD_NAME, AD_SQUAD_TYPE, AD_IS_LEADER, SL_SQUAD_NAME,
} = require('../../utils/squad_queries');
const { calculateSquadWins } = require('../../utils/top_squad_sync');
const { getSquadLevel } = require('../../utils/squad_level_sync');
const logger = require('../../utils/logger');

const formatDate = () => {
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear().toString().slice(-2);
    return `${month}/${day}/${year}`;
};

module.exports = {
    cooldown: 604800,
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register a new Squad.')
        .addStringOption(option =>
            option.setName('squadname')
                .setDescription('The desired name/tag for your Squad (1-4 alphanumeric chars).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('squadtype')
                .setDescription('Select the intended type for your Squad.')
                .setRequired(true)
                .addChoices(
                    { name: 'Casual', value: 'Casual' },
                    { name: 'Competitive', value: 'Competitive' },
                )),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const hasRequiredRole = interaction.member.roles.cache.has(LEVEL_5_ROLE_ID);
        if (!hasRequiredRole) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Role Required'),
                new TextDisplayBuilder().setContent(`You must have the <@&${LEVEL_5_ROLE_ID}> role to register a squad.`)
            );
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        const squadName = interaction.options.getString('squadname').toUpperCase();
        const squadType = interaction.options.getString('squadtype');
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userTag = interaction.user.tag;

        if (!/^[A-Z0-9]{1,4}$/.test(squadName)) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Invalid Squad Name'),
                new TextDisplayBuilder().setContent('Squad names must be 1 to 4 letters (A-Z) or numbers (0-9).')
            );
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
        }

        const sheets = await getSheetsClient();

        try {
            const results = await getCachedValues({
                sheets,
                spreadsheetId: SPREADSHEET_SQUADS,
                ranges: ['All Data!A:H', 'Squad Leaders!A:G'],
                ttlMs: 30000,
            });
            const allData = (results.get('All Data!A:H') || []).slice(1);
            const squadLeaders = (results.get('Squad Leaders!A:G') || []).slice(1);

            // Multi-squad validation
            const userSquads = findUserSquads(squadLeaders, userId);
            const userAllDataRows = findUserAllDataRows(allData, userId);

            // Determine types of existing squads via All Data (Squad Leaders col 3 is Event Squad, not type)
            const ownedTypes = userAllDataRows
                .filter(row => row.length > AD_IS_LEADER && row[AD_IS_LEADER] === 'Yes')
                .map(row => ({ name: row[AD_SQUAD_NAME], type: row[AD_SQUAD_TYPE] }));

            const ownsCasual = ownedTypes.find(s => s.type === 'Casual');
            const ownsComp = ownedTypes.find(s => s.type === 'Competitive');
            const ownsBTeam = userSquads.find(r => r.length > 6 && r[6] && r[6] !== '');

            let isBTeam = false;
            let aTeamSquadName = '';

            if (squadType === 'Casual') {
                if (ownsCasual) {
                    return interaction.editReply({ content: 'You already own a Casual squad.' });
                }
                if (ownsComp && ownsComp.name?.toUpperCase() !== squadName) {
                    return interaction.editReply({
                        content: `Your Casual squad must share the same name as your Competitive squad (${ownsComp.name}).`,
                    });
                }
            } else if (squadType === 'Competitive') {
                if (ownsComp && !ownsBTeam) {
                    // They want a second comp squad (B team). Check level 50 requirement.
                    const squadWins = await calculateSquadWins(sheets);
                    const compData = squadWins.get(ownsComp.name);
                    const level = compData ? getSquadLevel(compData.totalWins) : 0;
                    if (level < 50) {
                        return interaction.editReply({
                            content: `Your Competitive squad must be level 50+ to create a B team. Current level: ${level}.`,
                        });
                    }
                    isBTeam = true;
                    aTeamSquadName = ownsComp.name;
                } else if (ownsComp && ownsBTeam) {
                    return interaction.editReply({ content: 'You already own an A team and B team.' });
                } else if (ownsCasual && ownsCasual.name?.toUpperCase() !== squadName) {
                    return interaction.editReply({
                        content: `Your Competitive squad must share the same name as your Casual squad (${ownsCasual.name}).`,
                    });
                }
            }

            // Check if user is a member of another squad (owners cannot join others)
            const isMemberOfOther = userAllDataRows.some(
                row => row[AD_IS_LEADER] !== 'Yes' && row[AD_SQUAD_NAME] && row[AD_SQUAD_NAME] !== 'N/A'
            );
            if (isMemberOfOther && userSquads.length === 0) {
                return interaction.editReply({ content: 'You must leave your current squad before creating one.' });
            }

            // Name uniqueness check (allows same user to own same name in different type)
            if (isSquadNameTaken(squadLeaders, squadName, userId)) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Squad Tag Taken'),
                    new TextDisplayBuilder().setContent(`The squad tag **${squadName}** is already taken.`)
                );
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            }

            const squadLeaderRole = interaction.guild.roles.cache.get(SQUAD_LEADER_ROLE_ID);
            const competitiveRole = interaction.guild.roles.cache.get(COMPETITIVE_SQUAD_OWNER_ROLE_ID);
            if (!squadLeaderRole || !competitiveRole) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Configuration Error'),
                    new TextDisplayBuilder().setContent('Required squad leader roles are missing.')
                );
                return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container], ephemeral: true });
            }

            const dateString = formatDate();
            const parentSquad = isBTeam ? aTeamSquadName : '';
            const newLeaderRow = [
                username,
                userId,
                squadName,
                'N/A',
                'FALSE',
                dateString,
                parentSquad,
            ];

            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'Squad Leaders!A1',
                valueInputOption: 'RAW',
                resource: { values: [newLeaderRow] },
            }).catch(err => { throw new Error(`Failed to append to Squad Leaders sheet: ${err.message}`); });

            // Add or update All Data entry
            const newAllDataRow = [
                username,
                userId,
                squadName,
                squadType || 'N/A',
                'N/A',
                'FALSE',
                'Yes',
                'TRUE',
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_SQUADS,
                range: 'All Data!A1',
                valueInputOption: 'RAW',
                resource: { values: [newAllDataRow] },
            }).catch(err => { throw new Error(`Failed to append to All Data sheet: ${err.message}`); });

            try {
                await interaction.member.roles.add(squadLeaderRole);
                if (squadType === 'Competitive') await interaction.member.roles.add(competitiveRole);
            } catch (roleError) {
                logger.warn(`Failed to add roles to ${username} (${userId}): ${roleError.message}`);
                const warningContainer = new ContainerBuilder();
                warningContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Role Assignment Failed'),
                    new TextDisplayBuilder().setContent('Squad created, but some roles could not be assigned.\nPlease check permissions and assign manually.')
                );
                await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true });
            }

            try {
                await interaction.member.setNickname(`[${squadName}] ${interaction.member.user.username}`);
            } catch (nickError) {
                logger.warn(`Failed to set nickname for ${username}: ${nickError.message}`);
                const warningContainer = new ContainerBuilder();
                warningContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('## Nickname Update Failed'),
                    new TextDisplayBuilder().setContent('Squad created, but nickname could not be updated due to permissions.')
                );
                await interaction.followUp({ flags: MessageFlags.IsComponentsV2, components: [warningContainer], ephemeral: true });
            }

            try {
                const dmContainer = new ContainerBuilder();
                dmContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Squad Registered\n${squadName}`),
                    new TextDisplayBuilder().setContent(`Your squad **${squadName}** (${squadType}) has been registered.${isBTeam ? ` This is a B team linked to **${aTeamSquadName}**.` : ''}`)
                );
                await interaction.user.send({ flags: MessageFlags.IsComponentsV2, components: [dmContainer] });
            } catch (dmError) {
                logger.warn(`Failed to send registration DM to ${username}: ${dmError.message}`);
            }

            const successContainer = new ContainerBuilder();
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Squad Registered\n${squadName}`),
                new TextDisplayBuilder().setContent(`Squad **${squadName}** (${squadType}) has been registered and configured.${isBTeam ? ` Linked as B team to **${aTeamSquadName}**.` : ''}`)
            );
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [successContainer],
                ephemeral: true,
            });

        } catch (error) {
            logger.error(`Error processing /register command for ${userTag} (${userId}):`, error);
            try {
                const errorGuild = await interaction.client.guilds.fetch(GYM_CLASS_GUILD_ID);
                const errorChannel = await errorGuild.channels.fetch(BOT_BUGS_CHANNEL_ID);
                const errorContainer = new ContainerBuilder();
                errorContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## Squad Registration Error\n${userTag}`),
                    new TextDisplayBuilder().setContent(`**User:** ${userTag} (${userId})\n**Error:** ${error.message}`)
                );
                await errorChannel.send({ flags: MessageFlags.IsComponentsV2, components: [errorContainer] });
            } catch (logError) {
                logger.error('Failed to log registration error to Discord:', logError);
            }
            const errorContainer = new ContainerBuilder();
            errorContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Registration Failed'),
                new TextDisplayBuilder().setContent(`An error occurred while registering your squad: ${error.message || 'Please try again later or contact an admin.'}`)
            );
            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2,
                components: [errorContainer],
                ephemeral: true,
            }).catch(logger.error);
        }
    },
};
