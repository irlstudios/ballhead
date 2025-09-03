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



/*
Archived button handlers


const handleLfgSystem1Create = async (interaction) => {
    await interaction.deferReply({ephemeral: true});

    const inGameUsername = interaction.fields.getTextInputValue('inGameUsernameSystem1');
    const description = interaction.fields.getTextInputValue('descriptionSystem1');
    const startTime = interaction.fields.getTextInputValue('startTimeSystem1');
    const place = interaction.fields.getTextInputValue('placeSystem1');

    const embed = new EmbedBuilder()
        .setTitle('Looking For Group')
        .setColor(0x00FF00)
        .setDescription('Find a group to play with! Join now!')
        .addFields(
            { name: 'In-Game Username', value: inGameUsername, inline: true },
            { name: 'Description', value: description, inline: true },
            { name: 'Start Time', value: startTime, inline: true },
            { name: 'Place of Gathering', value: place, inline: true },
        )
        .setFooter({ text: `Post by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

    const joinGroupButton = new ButtonBuilder()
        .setCustomId('lfgSystem1Join')
        .setLabel('Join Group')
        .setStyle(ButtonStyle.Primary);

    const viewParticipantsButton = new ButtonBuilder()
        .setCustomId('lfgSystem1ViewParticipants')
        .setLabel('View Participants')
        .setStyle(ButtonStyle.Secondary);

    const closePostButton = new ButtonBuilder()
        .setCustomId('lfgSystem1Close')
        .setLabel('Close Post')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(joinGroupButton, viewParticipantsButton, closePostButton);

    const lfgChannel = interaction.guild.channels.cache.get('807771981222641664');
    const message = await lfgChannel.send({ embeds: [embed], components: [actionRow] });

    const threadName = `${inGameUsername}-LFG-Thread`;
    const thread = await lfgChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 12,
        reason: 'LFG post thread',
    });

    await thread.members.add(interaction.user.id);
    await thread.send(`Welcome <@${interaction.user.id}>! Use this thread to manage your group and chat with members.`);

    const client = new Client(clientConfig);
    await client.connect();

    try {
        await client.query('INSERT INTO "lfg_data" ("post_owner_discord_id", "post_message_id", "discord_thread_id", "participants") VALUES ($1, $2, $3, $4)', [
            interaction.user.id,
            message.id,
            thread.id,
            [],
        ]);
    } finally {
        await client.end();
    }

    await interaction.editReply({content: 'Your LFG post has been created!'});
};


const handleLfgSystem2Create = async (interaction) => {
    await interaction.deferReply({ephemeral: true});

    const requirements = interaction.fields.getTextInputValue('requirementsSystem2');
    const rules = interaction.fields.getTextInputValue('rulesSystem2') || null;
    const additionalInfo = interaction.fields.getTextInputValue('additionalInfoSystem2') || null;

    const squadData = await sheets.spreadsheets.values.get({
        spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
        range: 'Squad Leaders!A2:D',
    });

    const squadRows = squadData.data.values;
    const squad = squadRows.find(row => row[1] === interaction.user.id);

    if (!squad) {
        return interaction.editReply({content: 'Squad information not found for your account.'});
    }

    const squadName = squad[2];

    let description = `Hello all 👋, <@${interaction.user.id}> is looking for members to join their squad **${squadName}**! \n\n**Here are their requirements:**\n${requirements}`;

    if (rules) {
        description += `\n\n**Here are the rules in the squad:**\n${rules}`;
    }

    if (additionalInfo) {
        description += `\n\n**Here is additional information:**\n${additionalInfo}`;
    }

    description += `\n\nIf you're interested, use the buttons below to join or view the roster!`;

    const joinTeamButton = new ButtonBuilder()
        .setCustomId('LfgSystem2Join')
        .setLabel('Join Team')
        .setStyle(ButtonStyle.Primary);

    const viewRosterButton = new ButtonBuilder()
        .setCustomId('LfgSystem2ViewRoster')
        .setLabel('View Roster')
        .setStyle(ButtonStyle.Secondary);

    const closePostButton = new ButtonBuilder()
        .setCustomId('LfgSystem2ClosePost')
        .setLabel('Close Post')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(joinTeamButton, viewRosterButton, closePostButton);

    const embed = new EmbedBuilder()
        .setDescription(description);

    const recruitmentChannel = interaction.guild.channels.cache.get('1281372149243969550');
    const recruitmentMessage = await recruitmentChannel.send({embeds: [embed], components: [actionRow]});

    const threadName = `${squadName}-Recruitment`;
    const thread = await recruitmentChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 12,
        reason: 'Recruitment thread for squad',
    });

    await thread.members.add(interaction.user.id);
    await thread.send(`Welcome <@${interaction.user.id}>! This thread is for managing your recruitment process for the squad **${squadName}**.`);

    const client = new Client(clientConfig);
    await client.connect();

    try {
        await client.query('INSERT INTO "lfm_data" ("post_owner_discord_id", "post_message_id", "discord_thread_id", "participants") VALUES ($1, $2, $3, $4)', [
            interaction.user.id,
            recruitmentMessage.id,
            thread.id,
            [],
        ]);
    } finally {
        await client.end();
    }

    await interaction.editReply({content: 'Your squad recruitment post, private thread, and buttons have been created!'});

};


const handleLfgSystem3Create = async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    const leagueName = interaction.fields.getTextInputValue('leagueNameSystem3');
    const gameDetails = interaction.fields.getTextInputValue('gameDetailsSystem3');
    const officialRequirements = interaction.fields.getTextInputValue('officialRequirementsSystem3');

    const embed = new EmbedBuilder()
        .setTitle('Looking For Officials')
        .setColor(0x00FF00)
        .setDescription('A league is looking for officials! Join now to help referee the game.')
        .addFields(
            { name: 'League Name', value: leagueName, inline: true },
            { name: 'Game Details', value: gameDetails, inline: false },
            { name: 'Officials Required', value: officialRequirements, inline: false },
        )
        .setFooter({ text: `Post by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

    const joinButton = new ButtonBuilder()
        .setCustomId('lfgSystem3Join')
        .setLabel('Join as Official')
        .setStyle(ButtonStyle.Primary);

    const closePostButton = new ButtonBuilder()
        .setCustomId('lfgSystem3Close')
        .setLabel('Close Post')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(joinButton, closePostButton);

    const lfgChannel = interaction.guild.channels.cache.get('1286764324014260317');
    const message = await lfgChannel.send({ embeds: [embed], components: [actionRow] });

    const threadName = `${leagueName}-Officials-Thread`;
    const thread = await lfgChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: 12,
        reason: 'Officials recruitment thread',
    });

    await thread.members.add(interaction.user.id);
    await thread.send(`Welcome <@${interaction.user.id}>! Use this thread to manage your official recruitment process. \n-# to remove a participant please use /remove-participant user:`);

    const client = new Client(clientConfig);
    await client.connect();

    try {
        await client.query('INSERT INTO "lfo_data" ("post_owner_discord_id", "post_message_id", "discord_thread_id", "participants") VALUES ($1, $2, $3, $4)', [
            interaction.user.id,
            message.id,
            thread.id,
            [],
        ]);
    } finally {
        await client.end();
    }

    await interaction.editReply({ content: 'Your officials request post has been created!' });
};



const handleLfgSystem2Join = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const result = await pgClient.query('SELECT post_owner_discord_id, participants, discord_thread_id FROM lfm_data WHERE post_message_id = $1', [interaction.message.id]);

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'Could not find the LFG post in the database.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, participants: currentParticipants, discord_thread_id: threadId } = result.rows[0];

        if (interaction.user.id === postOwnerId) {
            return interaction.reply({ content: 'You cannot join your own group.', ephemeral: true });
        }

        if (currentParticipants.includes(interaction.user.id)) {
            return interaction.reply({ content: 'You have already joined this group.', ephemeral: true });
        }

        currentParticipants.push(interaction.user.id);
        await pgClient.query('UPDATE lfm_data SET participants = $1 WHERE post_message_id = $2', [
            currentParticipants,
            interaction.message.id,
        ]);

        const recruitmentChannel = interaction.guild.channels.cache.get(interaction.channelId);
        const thread = await recruitmentChannel.threads.fetch(threadId);

        if (!thread) {
            return interaction.reply({ content: 'The recruitment thread could not be found.', ephemeral: true });
        }

        await thread.members.add(interaction.user.id);
        await thread.send(`Welcome <@${interaction.user.id}>! <@${postOwnerId}>, a new member has joined your recruitment thread.`);

        await interaction.reply({ content: 'You have successfully joined the group!', ephemeral: true });
    } catch (error) {
        console.error('Error joining the group.', error);
        await interaction.reply({ content: 'An error occurred while trying to join the group.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};


const handleLfgSystem2Close = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;
        const userId = interaction.user.id;

        const result = await pgClient.query('SELECT post_owner_discord_id, discord_thread_id FROM lfm_data WHERE post_message_id = $1', [postMessageId]);

        if (!result || result.rows.length === 0) {
            return interaction.reply({ content: 'LFG post not found.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, discord_thread_id: threadId } = result.rows[0];

        if (userId !== postOwnerId) {
            return interaction.reply({ content: 'Only the post owner can close this LFG post.', ephemeral: true });
        }

        const thread = interaction.guild.channels.cache.get(threadId);
        if (thread) {
            await thread.delete('LFG post closed by owner.');
        }

        await interaction.message.delete();
        await pgClient.query('DELETE FROM lfm_data WHERE post_message_id = $1', [postMessageId]);

        await interaction.reply({ content: 'Your LFG post has been closed!', ephemeral: true });
    } catch (error) {
        console.error('Error closing LFG post for System 2:', error);
        await interaction.reply({ content: 'An error occurred while closing the LFG post.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};


const handleLfgSystem1Close = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;
        const userId = interaction.user.id;

        const result = await pgClient.query('SELECT post_owner_discord_id, discord_thread_id, participants FROM lfg_data WHERE post_message_id = $1', [postMessageId]);

        if (!result || result.rows.length === 0) {
            return interaction.reply({ content: 'LFG post not found.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, discord_thread_id: threadId, participants = [] } = result.rows[0];

        if (userId !== postOwnerId) {
            return interaction.reply({ content: 'Only the post owner can close this LFG post.', ephemeral: true });
        }

        const thread = interaction.guild.channels.cache.get(threadId);
        if (thread) {
            await thread.delete('LFG post closed by owner');
        }

        await interaction.message.delete();
        await pgClient.query('DELETE FROM lfg_data WHERE post_message_id = $1', [postMessageId]);

        await interaction.reply({ content: 'Your LFG post has been closed!', ephemeral: true });
    } catch (error) {
        console.error('Error closing LFG post for System 1:', error);
        await interaction.reply({ content: 'An error occurred while closing the LFG post.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleLfgSystem1Join = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const result = await pgClient.query('SELECT post_owner_discord_id, participants, discord_thread_id FROM lfg_data WHERE post_message_id = $1', [interaction.message.id]);

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'Could not find the LFG post in the database.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, participants: currentParticipants, discord_thread_id: threadId } = result.rows[0];

        if (interaction.user.id === postOwnerId) {
            return interaction.reply({ content: 'You cannot join your own group.', ephemeral: true });
        }

        if (currentParticipants.includes(interaction.user.id)) {
            return interaction.reply({ content: 'You have already joined this group.', ephemeral: true });
        }

        currentParticipants.push(interaction.user.id);
        await pgClient.query('UPDATE lfg_data SET participants = $1 WHERE post_message_id = $2', [
            currentParticipants,
            interaction.message.id,
        ]);

        const recruitmentChannel = interaction.guild.channels.cache.get(interaction.channelId);
        const thread = await recruitmentChannel.threads.fetch(threadId);

        if (!thread) {
            return interaction.reply({ content: 'The recruitment thread could not be found.', ephemeral: true });
        }

        await thread.members.add(interaction.user.id);
        await thread.send(`Welcome <@${interaction.user.id}>! <@${postOwnerId}>, a new member has joined your recruitment thread.`);

        await interaction.reply({ content: 'You have successfully joined the group!', ephemeral: true });
    } catch (error) {
        console.error('Error joining the group.', error);
        await interaction.reply({ content: 'An error occurred while trying to join the group.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleLfgSystem1ViewParticipants = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;

        const result = await pgClient.query('SELECT participants FROM lfg_data WHERE post_message_id = $1', [postMessageId]);

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'No participants found for this post.', ephemeral: true });
        }

        const participants = result.rows[0].participants;

        if (participants.length === 0) {
            return interaction.reply({ content: 'No participants have joined this group yet.', ephemeral: true });
        }

        const participantMentions = participants.map(userId => `<@${userId}>`).join('\n');

        const participantsEmbed = new EmbedBuilder()
            .setTitle('LFG Participants')
            .setDescription(`Here are the participants for this group:\n\n${participantMentions}`)
            .setColor(0x00FF00);

        await interaction.reply({ embeds: [participantsEmbed], ephemeral: true });

    } catch (error) {
        console.error('Error fetching participants.', error);
        await interaction.reply({ content: 'An error occurred while fetching the participants.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};


const handleLfgSystem3Join = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    const allowedRoles = [
        "1289776755132858460",
        "1286098187223957617",
        "1286098139513880648",
        "1286098091396698134",
    ];

    const sheetId = '14J4LOdWDa2mzS6HzVBzAJgfnfi8_va1qOWVsxnwB-UM';
    const sheetTabName = 'Officials LFO Interactions';

    try {
        const result = await pgClient.query(
            'SELECT post_owner_discord_id, participants, discord_thread_id FROM lfo_data WHERE post_message_id = $1',
            [interaction.message.id]
        );

        if (result.rows.length === 0) {
            return interaction.reply({ content: 'Could not find the recruitment post in the database.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, participants: currentParticipants, discord_thread_id: threadId } = result.rows[0];

        if (interaction.user.id === postOwnerId) {
            return interaction.reply({ content: 'You cannot join your own recruitment post.', ephemeral: true });
        }

        if (currentParticipants.includes(interaction.user.id)) {
            return interaction.reply({ content: 'You have already joined this recruitment thread.', ephemeral: true });
        }

        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!member) {
            return interaction.reply({ content: 'Could not find your member data.', ephemeral: true });
        }

        const hasRequiredRole = allowedRoles.some(roleId => member.roles.cache.has(roleId));
        if (!hasRequiredRole) {
            return interaction.reply({ content: 'You do not have the required roles to join this recruitment thread.', ephemeral: true });
        }

        currentParticipants.push(interaction.user.id);
        await pgClient.query('UPDATE lfo_data SET participants = $1 WHERE post_message_id = $2', [
            currentParticipants,
            interaction.message.id,
        ]);

        const recruitmentChannel = interaction.guild.channels.cache.get(interaction.channelId);
        const thread = await recruitmentChannel.threads.fetch(threadId);
        if (!thread) {
            return interaction.reply({ content: 'The recruitment thread could not be found.', ephemeral: true });
        }
        await thread.members.add(interaction.user.id);
        await thread.send(`Welcome <@${interaction.user.id}>! <@${postOwnerId}>, a new official has joined your recruitment thread.`);
        const officialUsername = interaction.user.tag;
        const officialId = interaction.user.id;
        const postLink = `https://discord.com/channels/${interaction.guild.id}/${interaction.channelId}/${interaction.message.id}`;
        const timeJoined = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

        const row = [officialUsername, officialId, postLink, timeJoined, 'FALSE'];

        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${sheetTabName}!A:D`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [row],
            },
        });

        await interaction.reply({ content: 'You have successfully joined the recruitment thread as an official!', ephemeral: true });
    } catch (error) {
        console.error('Error joining recruitment thread or logging interaction:', error);
        await interaction.reply({ content: 'An error occurred while trying to join the recruitment thread.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};

const handleLfgSystem3Close = async (interaction) => {
    const pgClient = new Client(clientConfig);
    await pgClient.connect();

    try {
        const postMessageId = interaction.message.id;
        const userId = interaction.user.id;

        const result = await pgClient.query(
            'SELECT post_owner_discord_id, discord_thread_id FROM lfo_data WHERE post_message_id = $1',
            [postMessageId]
        );

        if (!result || result.rows.length === 0) {
            return interaction.reply({ content: 'Recruitment post not found.', ephemeral: true });
        }

        const { post_owner_discord_id: postOwnerId, discord_thread_id: threadId } = result.rows[0];

        if (userId !== postOwnerId) {
            return interaction.reply({ content: 'Only the post owner can close this recruitment post.', ephemeral: true });
        }

        const thread = interaction.guild.channels.cache.get(threadId);
        if (thread) {
            await thread.delete('Recruitment post closed by owner.');
        }

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF0000)
            .setFooter({ text: 'This post is now closed.' });

        const disabledActionRow = new ActionRowBuilder().addComponents(
            interaction.message.components[0].components.map(component =>
                ButtonBuilder.from(component).setDisabled(true)
            )
        );

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [disabledActionRow],
        });

        await pgClient.query('DELETE FROM lfo_data WHERE post_message_id = $1', [postMessageId]);

        await interaction.reply({ content: 'Your recruitment post has been closed and updated!', ephemeral: true });
    } catch (error) {
        console.error('Error closing recruitment post:', error);
        await interaction.reply({ content: 'An error occurred while closing the recruitment post.', ephemeral: true });
    } finally {
        await pgClient.end();
    }
};


// this function is for lfg system 2
const hanldeviewRoster = async (interaction) => {
    let squadName;
    try {
        squadName = interaction.message.embeds[0]?.description?.match(//regex)?.[1];
if (!squadName) {
    throw new Error("Could not extract squad name from the message embed.");
}
} catch (e) {
    console.error("Error extracting squad name:", e);
    await interaction.reply({ content: "Could not determine the squad name from the original message.", ephemeral: true });
    return;
}


try {
    const { squadMembers, squadLeader } = await getSquadData(squadName);
    await interaction.reply({
        ephemeral: true,
        embeds: [{
            color: 0x0099ff,
            title: `Roster for ${squadName}`,
            fields: [
                { name: 'Squad Leader', value: squadLeader || 'Not specified' },
                { name: 'Squad Members', value: squadMembers || 'None' },
            ],
            timestamp: new Date().toISOString()
        }],
    });
} catch (error) {
    console.error(`Error fetching roster for ${squadName}:`, error);
    await interaction.reply({
        content: `Error fetching roster: ${error.message || 'Please try again later.'}`,
        ephemeral: true
    });
}
}

async function getSquadData(squadName) {
    const auth = authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const normalizedSquadName = squadName.toUpperCase();

    async function fetchFilteredRows(range, filterCondition) {
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: '1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k',
                range: range,
            });
            const allRows = response.data.values || [];
            const dataRows = allRows.slice(1);
            return dataRows.filter(filterCondition);
        } catch (error) {
            console.error(`Error fetching data from Sheets range ${range}:`, error);
            throw new Error(`Failed to fetch data for range ${range}.`);
        }
    }

    try {
        const leaderFilter = row => row && row.length > 2 && row[2]?.toUpperCase() === normalizedSquadName;
        const matchingLeaders = await fetchFilteredRows('Squad Leaders!A:F', leaderFilter);

        if (matchingLeaders.length === 0) {
            throw new Error(`No squad found with the name "${squadName}".`);
        }
        if (matchingLeaders.length > 1) {
            console.warn(`Multiple leaders found for squad "${squadName}". Using the first one found.`);
        }
        const leaderRow = matchingLeaders[0];
        const leaderId = leaderRow[1]?.trim();
        const formattedLeader = leaderId ? `<@${leaderId}>` : 'Leader ID Not Found';

        const memberFilter = row => row && row.length > 2 && row[2]?.toUpperCase() === normalizedSquadName;
        const matchingMembers = await fetchFilteredRows('Squad Members!A:E', memberFilter);

        let formattedMembers = 'No members found.';
        if (matchingMembers.length > 0) {
            formattedMembers = matchingMembers
                .map(row => row[1]?.trim())
                .filter(id => id)
                .map(id => `- <@${id}>`)
                .join('\n');
            if (!formattedMembers) formattedMembers = 'No valid member IDs found.';
        }

        return {
            squadMembers: formattedMembers,
            squadLeader: formattedLeader
        };

    } catch (error) {
        console.error(`Error in getSquadData for "${squadName}": ${error.message}`);
        throw error;
    }
}
 */
