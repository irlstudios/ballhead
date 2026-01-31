const { MessageFlags, ContainerBuilder, TextDisplayBuilder, Events, GuildMemberFlagsBitField } = require('discord.js');
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
let onboardingRemindersReady = null;

const ensureOnboardingRemindersTable = async () => {
    if (onboardingRemindersReady) return onboardingRemindersReady;
    onboardingRemindersReady = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS onboarding_reminders (
            user_id TEXT NOT NULL,
            reminder_key TEXT NOT NULL,
            send_at TIMESTAMPTZ NOT NULL,
            sent BOOLEAN NOT NULL DEFAULT false
        )`);
        await pool.query(
            'CREATE UNIQUE INDEX IF NOT EXISTS onboarding_reminders_user_id_reminder_key_idx ON onboarding_reminders (user_id, reminder_key)'
        );
        await pool.query(
            'CREATE INDEX IF NOT EXISTS onboarding_reminders_send_at_idx ON onboarding_reminders (send_at)'
        );
    })();
    return onboardingRemindersReady;
};
module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const previouslyCompleted = oldMember.flags.has(GuildMemberFlagsBitField.Flags.CompletedOnboarding);
        const nowCompleted = newMember.flags.has(GuildMemberFlagsBitField.Flags.CompletedOnboarding);

        if (!previouslyCompleted && nowCompleted) {
            const joinedWithinWindow = (Date.now() - newMember.joinedTimestamp) <= ONBOARDING_WINDOW_HOURS * 3600000;
            if (!joinedWithinWindow) return;
            await ensureOnboardingRemindersTable();
            const { rowCount: alreadyOnboarded } = await pool.query(
                'SELECT 1 FROM onboarding_reminders WHERE user_id = $1 AND reminder_key = $2 LIMIT 1',
                [newMember.id, 'hour_1']
            );
            if (alreadyOnboarded > 0) return;

            const member = newMember;
            if (!botClient) botClient = member.client;

            const welcomeContainer = new ContainerBuilder();
            welcomeContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Welcome to Gym Class VR'));
            welcomeContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                `Heya ${member.displayName}! Congrats on finishing onboarding.`,
                'Let\'s keep the ball rolling. Here are a few helpful channels:',
                '- Verify your Discord account in-game: https://discord.com/channels/752216589792706621/1274849522731843676',
                '- FAQ Team answers: https://discord.com/channels/752216589792706621/1382467390557917306',
                '- New player resources: https://discord.com/channels/752216589792706621/1063547088836763799'
            ].join('\n')));
            welcomeContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# We hope you enjoy your stay'));
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                await member.send({ flags: MessageFlags.IsComponentsV2, components: [welcomeContainer] });
                await pool.query(
                    'INSERT INTO onboarding_reminders (user_id, reminder_key, send_at, sent) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\', false) ON CONFLICT (user_id, reminder_key) DO NOTHING',
                    [member.id, 'hour_1']
                ).catch(console.error);
            } catch (error) {
                console.error(`Could not send welcome DM to ${member.user.tag}:`, error);
            }
        }
    }
};

if (!global.onboardingReminderLoopStarted) {
    global.onboardingReminderLoopStarted = true;

    setInterval(async () => {
        if (!botClient) return;
        try {
            await ensureOnboardingRemindersTable();
            const { rows } = await pool.query(
                `DELETE FROM onboarding_reminders
                 WHERE send_at <= NOW() AND sent = false
                 RETURNING user_id, reminder_key`
            );

            for (const ticket of rows) {
                const user = await botClient.users.fetch(ticket.user_id).catch(() => null);
                if (!user) continue;

                const reminderContainer = new ContainerBuilder();
                reminderContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('## Keep the Ball Rolling'));
                reminderContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
                    `Hey <@${ticket.user_id}> hope you were able to verify and enjoy your perks.`,
                    'Earn even more perks by participating in our programs:',
                    '- True Baller Program: https://discord.com/channels/752216589792706621/1275654828940595200',
                    '- Content Creator: https://discord.com/channels/752216589792706621/1275652416460689418',
                    '- Coaching: https://discord.com/channels/752216589792706621/1063547088836763799'
                ].join('\n')));
                reminderContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# See you on the court'));

                await user.send({ flags: MessageFlags.IsComponentsV2, components: [reminderContainer] }).catch(() => null);
            }
        } catch (err) {
            console.error('Onboarding heartbeat loop error:', err);
        }
    }, 5 * 60 * 1000);
}
