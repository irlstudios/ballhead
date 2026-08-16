'use strict';

// Folds flat domain-prefixed commands (squad-invite, league-checkin) into one
// top-level command per domain so users type "/squad invite" instead of
// a dash-joined name. This is purely a registration-time transform: every
// per-command module keeps its own file, options, and execute() untouched,
// and a dispatcher routes the domain command back to the right module.

const COMMAND_DOMAINS = Object.freeze({
    squad: 'Squad commands: register, invite, roster, and more',
    league: 'League program commands for owners, staff, and players',
    apply: 'Apply for community programs and leagues',
    cdt: 'Community Design Team commands',
    cc: 'Content creator program commands',
    ff: 'Friendly Fire commands',
    'ranked-session': 'Ranked session coaching commands',
    officials: 'Community officials commands',
    report: 'Report a player or look up a report',
});

const DISCORD_MAX_SUBCOMMANDS = 25;

// Longest matching "<domain>-" prefix wins, so a hypothetical
// ranked-session-log folds into ranked-session, not a shorter domain.
function domainOf(name) {
    let best = null;
    for (const domain of Object.keys(COMMAND_DOMAINS)) {
        if (name.startsWith(`${domain}-`) && (!best || domain.length > best.length)) {
            best = domain;
        }
    }
    return best;
}

// Rebuild a command's JSON as a subcommand (type 1) or, when the command has
// subcommands of its own, a subcommand group (type 2). Only name, description,
// and options survive: top-level-only fields like default_member_permissions
// are dropped deliberately -- every folded staff command enforces its own role
// checks in code.
function toNestedOption(subName, json) {
    const options = json.options || [];
    if (options.some((o) => o.type === 2)) {
        throw new Error(`${json.name}: a command with subcommand groups cannot fold into a domain`);
    }
    const isGroup = options.some((o) => o.type === 1);
    return { type: isGroup ? 2 : 1, name: subName, description: json.description, options };
}

function buildDomainDispatcher(domain, bucket) {
    const options = [...bucket].map(([rest, module]) => toNestedOption(rest, module.data.toJSON()));
    if (options.length > DISCORD_MAX_SUBCOMMANDS) {
        throw new Error(`domain ${domain} has ${options.length} subcommands; Discord allows ${DISCORD_MAX_SUBCOMMANDS}`);
    }
    const json = { name: domain, description: COMMAND_DOMAINS[domain], options };

    const resolve = (interaction) => {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand(false);
        return bucket.get(group || sub) || null;
    };

    return {
        data: { name: domain, toJSON: () => json },
        // Lets the router key cooldowns (and anything else per-command) on the
        // routed module instead of the shared domain command.
        resolveSubcommand: resolve,
        execute: async (interaction) => {
            const module = resolve(interaction);
            if (!module) {
                throw new Error(`No handler for /${domain} ${interaction.options.getSubcommand(false)}`);
            }
            return module.execute(interaction);
        },
        autocomplete: async (interaction) => {
            const module = resolve(interaction);
            if (module && typeof module.autocomplete === 'function') {
                return module.autocomplete(interaction);
            }
        },
    };
}

// modules: array of loaded command modules. Returns Map(registeredName -> module),
// where domain members are replaced by one dispatcher per domain.
function groupCommandsByDomain(modules) {
    const flat = new Map();
    const domains = new Map();

    for (const module of modules) {
        const name = module.data.name;
        const domain = domainOf(name);
        if (!domain) {
            flat.set(name, module);
            continue;
        }
        const rest = name.slice(domain.length + 1);
        if (!domains.has(domain)) {
            domains.set(domain, new Map());
        }
        if (domains.get(domain).has(rest)) {
            throw new Error(`duplicate subcommand "${rest}" in domain "${domain}"`);
        }
        domains.get(domain).set(rest, module);
    }

    for (const [domain, bucket] of domains) {
        if (bucket.size === 1) {
            const [module] = bucket.values();
            flat.set(module.data.name, module);
            continue;
        }
        flat.set(domain, buildDomainDispatcher(domain, bucket));
    }

    return flat;
}

module.exports = {
    COMMAND_DOMAINS,
    groupCommandsByDomain,
};
