'use strict';

// Pure churn-detection logic for Friendly Fire. No I/O: callers pass already
// parsed per-season rosters and an id-lookup, this returns the eligible lapsed
// members. Keeping it side-effect free makes the rule exhaustively unit-testable.

// Seasons that must contain NO appearance for a member to count as lapsed.
const RECENT_ABSENCE_OFFSETS = [0, 1]; // N, N-1
// Seasons in which a prior appearance qualifies a member as a past participant.
const PRIOR_ACTIVITY_OFFSETS = [2, 3, 4]; // N-2, N-3, N-4

const normalizeName = (name) => String(name || '').trim().toLowerCase();

// A stable identity for matching a person across seasons: their Discord ID when
// present, otherwise their normalized in-game name. This keeps a player who
// appears in the current season under a name-only row from being mislabeled as
// lapsed just because that row has no Discord ID.
const identityOf = (entry) => {
    if (entry.discordId) {
        return `id:${entry.discordId}`;
    }
    return `name:${normalizeName(entry.inGameName)}`;
};

const rosterFor = (rostersBySeason, season) => rostersBySeason.get(season) || [];

// Identities present in the recent (must-be-empty) window. Indexed by BOTH the
// id-identity and the name-identity so a recent appearance matches a prior one
// regardless of which seasons carried the Discord ID.
const buildRecentIdentitySet = (rostersBySeason, currentSeason) => {
    const recent = new Set();
    for (const offset of RECENT_ABSENCE_OFFSETS) {
        for (const entry of rosterFor(rostersBySeason, currentSeason - offset)) {
            if (entry.discordId) {
                recent.add(`id:${entry.discordId}`);
            }
            recent.add(`name:${normalizeName(entry.inGameName)}`);
        }
    }
    return recent;
};

const isRecentlyActive = (entry, recentIdentities) => {
    if (entry.discordId && recentIdentities.has(`id:${entry.discordId}`)) {
        return true;
    }
    return recentIdentities.has(`name:${normalizeName(entry.inGameName)}`);
};

// Returns the eligible lapsed members. Each result:
//   { userId, inGameName, lastActiveSeason, lapsedSeasons, achievements }
// lapsedSeasons = how many seasons since they last played (currentSeason - last).
function findLapsedMembers({ rostersBySeason, currentSeason, idLookup = () => null }) {
    const recentIdentities = buildRecentIdentitySet(rostersBySeason, currentSeason);

    // Walk prior seasons newest-first so the first time we see a person fixes
    // their most-recent appearance (and the achievements we surface).
    const priorSeasons = PRIOR_ACTIVITY_OFFSETS
        .map((offset) => currentSeason - offset)
        .filter((season) => season > 0)
        .sort((a, b) => b - a);

    const seen = new Set();
    const eligible = [];

    for (const season of priorSeasons) {
        for (const entry of rosterFor(rostersBySeason, season)) {
            const identity = identityOf(entry);
            if (seen.has(identity)) {
                continue;
            }
            if (isRecentlyActive(entry, recentIdentities)) {
                seen.add(identity);
                continue;
            }

            const userId = entry.discordId || idLookup(entry.inGameName);
            if (!userId) {
                // Unreachable: no way to DM them. Mark seen so an older season
                // doesn't reconsider the same unreachable person.
                seen.add(identity);
                continue;
            }

            seen.add(identity);
            eligible.push({
                userId: String(userId),
                inGameName: entry.inGameName,
                lastActiveSeason: season,
                lapsedSeasons: currentSeason - season,
                achievements: entry.stats || {},
            });
        }
    }

    return eligible;
}

module.exports = {
    findLapsedMembers,
    normalizeName,
    RECENT_ABSENCE_OFFSETS,
    PRIOR_ACTIVITY_OFFSETS,
};
