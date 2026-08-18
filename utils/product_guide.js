'use strict';

const { CDT_DESIGNS_FORUM_CHANNEL_ID } = require('../config/constants');

// The server-wide front door: one short page per system, every page ending
// with the command to start with. Content lives here, in one place, in the
// same style as utils/league_guide.js.
const GUIDE_TOPICS = Object.freeze({
    squads: Object.freeze({
        title: 'Squads',
        lines: Object.freeze([
            'Team up with a persistent crew: squads have a name, a roster, and their own practices.',
            '- **/squad browse** - look through existing squads and request to join',
            '- **/squad register** - create your own squad',
            '- **/squad invite**, **/squad roster**, **/squad profile** - manage and show off your squad',
            '- **/squad find-members** or **/squad join-random** - when you need people fast',
            'Start with **/squad browse**.',
        ]),
    }),
    leagues: Object.freeze({
        title: 'Leagues',
        lines: Object.freeze([
            'Community-run leagues with tiers, officials, and rewards.',
            '- **/league directory** - browse every registered league and find one to play in',
            '- **/apply base-league** - register your own league',
            '- **/league guide** - the full owner guide (sent by DM when your league is approved)',
            'Players start with **/league directory**; owners start with **/apply base-league**.',
        ]),
    }),
    'content-creator': Object.freeze({
        title: 'Content Creator Program',
        lines: Object.freeze([
            'Post Gym Class content, earn points, and unlock the Content Creator role.',
            '- **/cc apply-instagram** - join with your Instagram (TikTok and YouTube sign-ups happen in the GC mobile app)',
            '- **/cc check-progress** - see your points, valid posts, and how close you are',
            '- **/cc quality-score** - see how your tracked posts scored',
            'Start with **/cc apply-instagram**, then check back weekly with **/cc check-progress**.',
        ]),
    }),
    'court-designs': Object.freeze({
        title: 'Custom Court Designs',
        lines: Object.freeze([
            'Community-made courts and backboards you can use in game.',
            `- Browse <#${CDT_DESIGNS_FORUM_CHANNEL_ID}> - every post has a **Get Files** button to download the design`,
            '- **/apply cdt** - join the Community Design Team and publish your own designs',
            'Start by browsing the forum and grabbing a court you like.',
        ]),
    }),
    rooms: Object.freeze({
        title: 'Personal Voice Rooms',
        lines: Object.freeze([
            'Your own voice channel with full control over who gets in.',
            '- **/room view** - see your room settings',
            '- **/room invite**, **/room uninvite**, **/room kick**, **/room block** - control access',
            '- **/room lock**, **/room unlock**, **/room rename** - manage the room itself',
            'Join the room creation channel to get a room, then run **/room view**.',
        ]),
    }),
    applications: Object.freeze({
        title: 'Programs and Applications',
        lines: Object.freeze([
            'Apply for community roles and programs, all under one command.',
            '- **/apply official** and **/apply ff-official** - officiate games',
            '- **/apply emh** - host Extra Modes sessions',
            '- **/apply bug-squasher** - help squash bugs',
            '- **/apply cdt** - join the Community Design Team',
            '- **/apply status** - check where your applications stand',
            'Decisions are sent by DM, so keep your DMs open. Check anytime with **/apply status**.',
        ]),
    }),
    reports: Object.freeze({
        title: 'Reports and Officials',
        lines: Object.freeze([
            'Keep games fair and safe.',
            '- **/report player** - report a player for breaking the rules; moderators review every report',
            '- **/officials status** - officials can check their standing',
            '- **/ff stats** and **/ff leaderboard** - Friendly Fire stats and rankings',
            'If something went wrong in a game, start with **/report player**.',
        ]),
    }),
});

const buildOverviewPage = () => ({
    title: 'Ballhead Guide',
    lines: [
        'Ballhead runs the Gym Class community: squads, leagues, creator programs, custom courts, and more.',
        'Run **/guide topic:<name>** for a walkthrough of any system:',
        '',
        ...Object.entries(GUIDE_TOPICS).map(([key, page]) => `- \`${key}\` - ${page.title}`),
        '',
        'New here? Start with `squads` to find people to play with.',
    ],
});

const buildGuidePage = (topic) => {
    const page = GUIDE_TOPICS[topic];
    if (!page) return buildOverviewPage();
    return { title: page.title, lines: [...page.lines, '', 'See every system with **/guide**.'] };
};

module.exports = { GUIDE_TOPICS, buildGuidePage, buildOverviewPage };
