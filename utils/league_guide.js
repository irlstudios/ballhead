'use strict';

const { MessageFlags, ContainerBuilder } = require('discord.js');
const { buildTextBlock } = require('./ui');
const { ACTIVE_LEAGUE_REQUIREMENTS: R, ACTIVE_LEAGUE_RETENTION: KEEP } = require('./league_enforcement');

// The League Owner Guide: sent as a DM when a league is registered or
// promoted, and available on demand through /league guide. Content lives here
// so every surface shows the same guide, with tier thresholds pulled from the
// enforcement constants so the guide can never drift from the actual rules.
const LEAGUE_GUIDE_SECTIONS = Object.freeze([
    Object.freeze({
        title: 'League Owner Guide',
        lines: Object.freeze([
            'Welcome to the Gym Class league program. This guide covers everything you need to run your league.',
            'Bring it back anytime with **/league guide**.',
        ]),
    }),
    Object.freeze({
        title: 'Getting Started',
        lines: Object.freeze([
            '- **/league settings** — set your primary sport and your content hashtag so players know what you run',
            '- **/league update-invite** — keep your invite link current; our health checks use it',
            '- **/league add-co-owner** — share the work with up to 2 co-owners',
            '- **/league directory** — where the community browses every registered league, including yours',
        ]),
    }),
    Object.freeze({
        title: 'Stay in Good Standing',
        lines: Object.freeze([
            '- **/league checkin** — submit your monthly activity check-in. This is required; missed check-ins put your league at risk and block tier upgrades',
            '- Keep your invite valid and your server active; automated health checks run regularly',
            '- Strikes can be issued for rule violations. Appeal an active strike with **/league appeal**',
        ]),
    }),
    Object.freeze({
        title: 'Track Your Games and Content',
        lines: Object.freeze([
            '- **/league submit-game** — record each completed league game by tagging the players. A game history builds your league\'s track record',
            '- Register a content hashtag with **/league settings** — it must start with #gc (for example #gcskyballers). Every post using it is tracked and credited to your league',
            '- **/league content** — see your hashtag and content totals anytime',
        ]),
    }),
    Object.freeze({
        title: 'Level Up: Base to Active to Sponsored',
        lines: Object.freeze([
            'Promotion is automatic: meet every requirement below and the daily tier sync moves your league to Active.',
            `- ${R.MIN_MEMBERS}+ members in your server`,
            `- ${R.MIN_TENURE_DAYS}+ days since your league was approved`,
            `- Check-ins current, with a ${R.MIN_CONSECUTIVE_CHECKIN_MONTHS}+ month streak`,
            '- No active strikes and a Healthy league status',
            '',
            'Check where you stand anytime with **/league requirements**.',
            `To stay Active: keep checking in monthly, hold ${KEEP.MIN_MEMBERS}+ members, and avoid strikes — leagues below the bar move back to Base.`,
            'Active and Sponsored leagues can request certified officials for their games with **/league request-official**.',
            'Sponsored leagues (**/apply sponsored-league**) also unlock rewards via **/league request-reward**.',
        ]),
    }),
    Object.freeze({
        title: 'Need Help?',
        lines: Object.freeze([
            'Ask in the league owners channel or open a ticket in the Gym Class server. Moderators are happy to help.',
        ]),
    }),
]);

function buildLeagueGuidePayload() {
    const container = new ContainerBuilder();
    for (const section of LEAGUE_GUIDE_SECTIONS) {
        const block = buildTextBlock({ title: section.title, lines: section.lines });
        if (block) container.addTextDisplayComponents(block);
    }
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = {
    LEAGUE_GUIDE_SECTIONS,
    buildLeagueGuidePayload,
};
