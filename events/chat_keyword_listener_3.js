const { Pool } = require('pg');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const lfgPhrases = [
    'I want someone to play',
    'Who wants to play',
    'Who trynna play',
    'Anyone wants to play',
    'Who wanna play',
    'Anyone GC',
    'GC anyone',
    'Someone hop on',
    'Someone hop on with me',
    'Anyone looking to play',
    'Anyone wants to hop on with me',
    'Anyone wants to play with me?',
    'Is someone around to hop on with me?',
    'Anybody want to play?',
    'Who want to play',
    'Who want to play with me',
    'Who can play with me',
    'Looking for someone to play with',
    'Anybody here wants to play?',
    'Is Anyone around to play?',
    'Who is available to play with me',
    'Who can run 2s with me',
    'Who can 1v1 me',
    'Anybody wants to 1v1',
    'Who wants to play 1v1',
    'any1 wanna play',
    'any1 trynna play',
    'who wanna ply',
    'som1 wanna play',
    'someone wanna ply wit me',
    'u trynna play',
    'u wanna play',
    'wanna hop on',
    'hop on wit me',
    'lets play sum',
    'lets go play',
    'anyone down to play?',
    'who wanna join',
    'who down for some games',
    'lets game',
    'lets hop on',
    'need someone to play wit',
    'anybody wanna game?',
    'who wanna run it',
    'wanna play sum games',
    'whos down for 1v1',
    'any1 down for 1v1',
    'any1 looking for a group',
    'need sum1 to run games with',
    'who can hop on rn',
    'who wanna play right now',
    'i wanna play',
    'lookin 4 someone to play wit',
    'any1 playing rn?',
    'who trynna 1v1',
    'can sum1 join me',
    'can anyone hop on right now',
    'anybody wanna hop on wit me',
    'anyone up for gaming?',
    'lets squad up',
    'who tryna squad',
    'who tryna run games',
    'need a squad',
    'lookin to squad up',
    'anybody wanna team up?',
    'who lookin to run games',
    'whos playing',
    'who down for sum games',
    'need some1 to play with me',
    'can anyone squad up wit me',
    'whos online',
    'lets run it',
    'lets queue up',
    'queue with me',
    'play wit me',
    'run games wit me',
    'run 2v2 wit me',
    'who can play right now',
    'who can run some games',
    'i need a team',
    'i need someone to hop on',
    'hop on right now',
    'any1 wanna squad',
    'wanne play',
    'anyone plaing',
    'who whanna play',
    'sum1 play wth me',
    'want too play',
    'who trynna plau',
    'whos playng',
    'anyne wanna play?',
    'whos wnnna play',
    'tryina play wit me',
    'who wnna hop on',
    'plaing wit me',
    'pla wth me',
    'plae with me',
    'play?',
    'game?',
    'lets go',
    'lets play',
    'who wanna play?',
    'lets go game',
    'hop on?',
    'anyone wanna play?'
];

async function fetchLfgPosts() {
    try {
        const query = `
            SELECT post_message_id
            FROM lfg_data
            WHERE COALESCE(array_length(participants, 1), 0) < 10;
        `;
        const result = await pool.query(query);

        return result.rows.map(row => `https://discord.com/channels/752216589792706621/807771981222641664/${row.post_message_id}`);
    } catch (error) {
        console.error('Error fetching LFG posts from database:', error);
        return [];
    }
}

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (lfgPhrases.some(phrase => message.content.toLowerCase().includes(phrase.toLowerCase())) && !message.author.bot) {
            try {
                const lfgPosts = await fetchLfgPosts();
                if (lfgPosts.length > 0) {
                    const randomPostIndex = Math.floor(Math.random() * lfgPosts.length);
                    const lfgPostLink = lfgPosts[randomPostIndex];
                    const suggestionContainer = new ContainerBuilder();
                    suggestionContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Looking for a Group'));
                    suggestionContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                        `Hey <@${message.author.id}>! Someone is looking for a group.`,
                        lfgPostLink,
                        'Why not hop in and join them?'
                    ].join('\n')));
                    await message.channel.send({ flags: MessageFlags.IsComponentsV2, components: [suggestionContainer] });
                } else {
                    // we ignore unless debugging
                }

            } catch (error) {
                console.error(`Could not send LFG suggestion: ${error}`);
            }
        }
    }
};
