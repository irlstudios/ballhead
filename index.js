const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
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
}).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});
