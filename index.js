const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config({ path: './resources/.env' });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildBans
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel]
});

client.commands = new Collection();
client.cooldowns = new Collection();

try {
    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        try {
            const command = require(`./commands/${file}`);
            if (!command?.data?.name) {
                console.error(`Error loading ${file}: 'data' or 'name' property is missing or invalid.`);
                continue;
            }
            console.log(`Registering Command: ${command.data.name}`);
            client.commands.set(command.data.name, command);
        } catch (error) {
            console.error(`Error loading ${file}: ${error}`);
        }
    }
} catch (error) {
    console.error('Error reading command files:', error);
}

try {
    const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const event = require(`./events/${file}`);
        if (!event.name || !event.execute) {
            console.error(`Error loading ${file}: Event does not properly export 'name' or 'execute'.`);
            continue;
        }
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
} catch (error) {
    console.error('Error reading event files:', error);
}

const reportBugCommand = client.commands.get('report-bug');
if (reportBugCommand?.data?.options?.[0]) {
    const commandNames = client.commands.map(cmd => cmd.data.name);
    const choices = commandNames.slice(0, 24).map(name => ({ name, value: name }));
    if (commandNames.length > 24) {
        choices.push({ name: 'other', value: 'other' });
    }
    reportBugCommand.data.options[0].choices = choices;
}

const interactionHandler = require('./interactionHandler');
client.on('interactionCreate', async (interaction) => {
    try {
        console.log('[Global Interaction] type:', interaction.type, 'customId:', interaction.customId);
        console.log('[Global Interaction] Button pressed:', interaction.customId);
        if (['squads_prev','squads_next'].includes(interaction.customId)) {
            return handlePagination1(interaction.customId, interaction);
        }
        await interactionHandler(interaction, client);
    } catch (error) {
        console.error('Error handling interaction:', error);
    }
});

const token = process.env.TOKEN;
if (!token) {
    console.error('Bot token is missing. Please add your bot token to the .env file.');
    process.exit(1);
}

client.login(token).then(() => {
    console.log('Bot logged in successfully.')

    axios.get('http://localhost:3000/api-response-time')
        .then(response => {
            let responseTime;
            if (typeof response.data === 'string') {
                console.log('API Server is up. Full response:', response.data);
                const match = response.data.match(/Response Time: (\d+\.\d+) ms/);
                if (match) {
                    responseTime = match[1];
                }
            } else if (response.data && response.data.responseTime) {
                console.log('API Server is up. Full response:', response.data);
                responseTime = response.data.responseTime;
            }
            if (responseTime !== undefined) {
                console.log('API Server is up. Response time:', responseTime);
            } else {
                console.log('API Server is up. Response time is not available in the expected format.');
            }
        })
        .catch(error => {
            console.error('Could not connect to the API Server:', error.message);
        });
}).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});
