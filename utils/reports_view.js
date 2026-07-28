'use strict';

// Rendering for the moderator-facing report views. Both the /reports command and
// the queue buttons build their replies here so an action and a fresh command
// render the same card.

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ContainerBuilder, SeparatorBuilder, MessageFlags,
} = require('discord.js');
const { buildTextBlock, noticePayload } = require('./ui');
const { STATUS_LABEL, severityLabel, formatAge } = require('./reports_logic');

const FILTER_LABEL = {
    open: 'Open reports',
    needs_info: 'Awaiting reporter',
};

const payload = (container, rows = []) => ({
    flags: MessageFlags.IsComponentsV2,
    components: [container, ...rows],
});

// buildTextBlock drops falsy lines, so an '' spacer never survives. Sections are
// split with the native Components V2 separator instead.
const addSection = (container, options) => {
    const block = buildTextBlock(options);
    if (!block) {
        return container;
    }
    if (container.components?.length) {
        container.addSeparatorComponents(new SeparatorBuilder());
    }
    return container.addTextDisplayComponents(block);
};

// Backfilled reports that were already actioned lost their reporter along with
// the buttons that carried the ID, so this has to read well with nothing.
const reporterLine = (report) => {
    if (!report.reporter_id) {
        return '**Reporter:** not recorded (predates indexing)';
    }
    const approved = Number(report.reporter_approved) || 0;
    const denied = Number(report.reporter_denied) || 0;
    const record = approved + denied === 0 ? 'no prior reports' : `${approved} approved / ${denied} denied`;
    return `**Reporter:** <@${report.reporter_id}> - ${record}`;
};

const repeatLine = (report) => {
    const others = Number(report.other_open_count) || 0;
    if (others === 0) {
        return null;
    }
    return `**Repeat:** ${others} other open report${others === 1 ? '' : 's'} on this player`;
};

// One report at a time. Index is a position in the already-sorted list, so the
// buttons only ever need to carry a number rather than the whole queue state.
const buildQueueCard = (rows, index, filter = 'open') => {
    if (rows.length === 0) {
        return noticePayload(
            `Nothing in the ${FILTER_LABEL[filter] || filter} queue. Good place to be.`,
            { title: 'Queue Clear', subtitle: 'Player Reports' }
        );
    }

    const position = Math.min(Math.max(index, 0), rows.length - 1);
    const report = rows[position];

    // Triage signals first, then the report itself: the top half is what decides
    // whether this one gets looked at now, the bottom half is the case.
    const container = new ContainerBuilder();
    addSection(container, {
        title: report.ref_id,
        subtitle: `${FILTER_LABEL[filter] || filter} - ${position + 1} of ${rows.length} (priority ${Math.round(report.score || 0)})`,
        lines: [
            `**Reported:** ${report.reported_name}`,
            repeatLine(report),
            `**Severity:** ${severityLabel(report.severity)}`,
            `**Waiting:** ${formatAge(report.created_at)}`,
            reporterLine(report),
        ],
    });
    addSection(container, {
        lines: [
            `**Rule broken:** ${report.rule_broken || '_not recorded_'}`,
            report.time_of_offense ? `**When:** ${report.time_of_offense}` : null,
            report.lobby_name ? `**Lobby:** ${report.lobby_name}` : null,
            report.proof_description ? `**Proof shows:** ${report.proof_description}` : '_No proof description (predates the requirement)._',
            report.proof_url ? `**Proof link:** ${report.proof_url}` : null,
        ],
    });

    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`rpt:approve:${filter}:${report.ref_id}:${position}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`rpt:deny:${filter}:${report.ref_id}:${position}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger)
    );
    // Asking for information on a report that is already awaiting information
    // would re-send the same DM and leave it exactly where it was.
    if (filter !== 'needs_info') {
        actions.addComponents(
            new ButtonBuilder()
                .setCustomId(`rpt:info:${filter}:${report.ref_id}:${position}`)
                .setLabel('Need Info')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    const navigation = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`rpt:prev:${filter}:${report.ref_id}:${position}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(position === 0),
        new ButtonBuilder()
            .setCustomId(`rpt:next:${filter}:${report.ref_id}:${position}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(position >= rows.length - 1)
    );
    if (report.thread_url) {
        navigation.addComponents(
            new ButtonBuilder()
                .setLabel('Open thread')
                .setStyle(ButtonStyle.Link)
                .setURL(report.thread_url)
        );
    }

    return payload(container, [actions, navigation]);
};

// Every report ever filed against one player. The question this answers is
// whether the case in the queue is a one-off or a pattern.
const buildPlayerHistory = (name, rows) => {
    if (rows.length === 0) {
        return noticePayload(
            `No reports on file for **${name}**.`,
            { title: 'No History', subtitle: 'Player Reports' }
        );
    }

    const open = rows.filter((r) => r.status === 'open').length;
    const approved = rows.filter((r) => r.status === 'approved').length;

    const lines = rows.slice(0, 20).map((r) => {
        const link = r.thread_url ? `[${r.ref_id}](${r.thread_url})` : `\`${r.ref_id}\``;
        return `${link} - ${STATUS_LABEL[r.status] || r.status} - ${severityLabel(r.severity)} - ${formatAge(r.created_at)} ago`;
    });
    if (rows.length > 20) {
        lines.push(`_...and ${rows.length - 20} more._`);
    }

    const container = new ContainerBuilder();
    addSection(container, {
        title: `Report History: ${rows[0].reported_name}`,
        subtitle: `${rows.length} total - ${open} open - ${approved} approved`,
        lines,
    });
    return payload(container);
};

const buildStatsCard = (stats) => {
    const { byStatus, openBySeverity, oldestOpen, topReported } = stats;
    const open = byStatus.open || 0;

    const severityLines = openBySeverity.length
        ? openBySeverity.map((r) => `- ${severityLabel(r.severity)}: ${r.n}`)
        : ['- nothing open'];

    const repeatLines = topReported.length
        ? topReported.map((r) => `- **${r.reported_name}** - ${r.total} reports (${r.open_count} open)`)
        : ['- no player has been reported more than once'];

    const container = new ContainerBuilder();
    addSection(container, {
        title: 'Report Backlog',
        subtitle: `${open} open - ${byStatus.needs_info || 0} awaiting reporter`,
        lines: [
            oldestOpen
                ? `**Oldest open:** ${oldestOpen.ref_id} on ${oldestOpen.reported_name}, waiting ${formatAge(oldestOpen.created_at)}`
                : '**Oldest open:** none',
            `**Resolved:** ${byStatus.approved || 0} approved, ${byStatus.denied || 0} denied`,
        ],
    });
    addSection(container, { lines: ['**Open by severity**', ...severityLines] });
    addSection(container, { lines: ['**Most reported players**', ...repeatLines] });
    return payload(container);
};

module.exports = {
    FILTER_LABEL,
    buildQueueCard,
    buildPlayerHistory,
    buildStatsCard,
};
