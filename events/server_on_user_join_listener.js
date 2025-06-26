const { EmbedBuilder, Events, GuildMemberFlagsBitField } = require('discord.js');
const { Pool } = require('pg');

const clientConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_DATABASE_NAME,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
};

const pool = new Pool(clientConfig);
const ONBOARDING_WINDOW_HOURS = 48;
let botClient = null;
module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const previouslyCompleted = oldMember.flags.has(GuildMemberFlagsBitField.Flags.CompletedOnboarding);
        const nowCompleted = newMember.flags.has(GuildMemberFlagsBitField.Flags.CompletedOnboarding);

        if (!previouslyCompleted && nowCompleted) {
            const joinedWithinWindow = (Date.now() - newMember.joinedTimestamp) <= ONBOARDING_WINDOW_HOURS * 3600000;
            if (!joinedWithinWindow) return;
            const { rowCount: alreadyOnboarded } = await pool.query(
                'SELECT 1 FROM onboarding_reminders WHERE user_id = $1 AND reminder_key = $2 LIMIT 1',
                [newMember.id, 'hour_1']
            );
            if (alreadyOnboarded > 0) return;

            const member = newMember;
            if (!botClient) botClient = member.client;

            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('Welcome to Gym Class VR!')
                .setDescription(
                    `Heya ${member.displayName}! :basketball: Congrats on finishing the onboarding into our server, were glad you've hit the ground running!\n\n` +
                    `Lets keep the ball rolling! Take a look at some of these channels that will help you see what we're all about! :\n` +
                    '- Visit **https://discord.com/channels/752216589792706621/1274849522731843676** to learn how to **verify your discord account** in‑game to unlock **discord bundle perks**. \n' +
                    '- Visit **https://discord.com/channels/752216589792706621/1382467390557917306** in the server for quick answers from our FAQ Team.\n' +
                    '- Visit **https://discord.com/channels/752216589792706621/1063547088836763799** in the server to view some resources and information we have posted for new users to view'
                )
                .setFooter({ text: 'We hope you enjoy your stay!' });
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                await member.send({ embeds: [welcomeEmbed] });
                await pool.query(
                    'INSERT INTO onboarding_reminders (user_id, reminder_key, send_at, sent) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\', false) ON CONFLICT (user_id, reminder_key) DO NOTHING',
                    [member.id, 'hour_1']
                ).catch(console.error);
            } catch (error) {
                console.error(`Could not send welcome DM to ${member.user.tag}:`, error);
            }
        }
    }
}

if (!global.onboardingReminderLoopStarted) {
    global.onboardingReminderLoopStarted = true;

    setInterval(async () => {
        if (!botClient) return;
        try {
            const { rows } = await pool.query(
                `DELETE FROM onboarding_reminders
                 WHERE send_at <= NOW() AND sent = false
                 RETURNING user_id, reminder_key`
            );

            for (const ticket of rows) {
                const user = await botClient.users.fetch(ticket.user_id).catch(() => null);
                if (!user) continue;

                const reminderEmbed = new (require('discord.js').EmbedBuilder)()
                    .setColor(0xf1c40f)
                    .setTitle('Keep the Ball Rolling! 🏀')
                    .setDescription(
                        `Hey <@${ticket.user_id}> hope you were able to verify and that you enjoyed your perks!\n\n` +
                        'We strongly encourage you to start engaging with our community so you can earn **even more perks** by participating in our programs :\n' +
                        '- **True Baller Program** you can earn this by just chatting with the community! Learn more here : https://discord.com/channels/752216589792706621/1275654828940595200\n' +
                        '- **Content Creator** you can earn this by posting content that follow our requirements! Learn more here : https://discord.com/channels/752216589792706621/1275652416460689418\n' +
                        '- **Coaching** you can become a Coach to help new players, or get coaching if you need help. Learn more here : https://discord.com/channels/752216589792706621/1063547088836763799'
                    )
                    .setFooter({ text: 'See you on the court!' });

                await user.send({ embeds: [reminderEmbed] }).catch(() => null);
            }
        } catch (err) {
            console.error('Onboarding heartbeat loop error:', err);
        }
    }, 5 * 60 * 1000);
}