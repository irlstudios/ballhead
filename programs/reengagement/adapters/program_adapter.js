'use strict';

// ProgramAdapter interface contract.
//
// Each community program (Friendly Fire, Squads, Content Creator, ...) provides
// an object satisfying this shape. The engine (job + sender + handler) depends
// only on this contract, never on a program's data source, so new programs plug
// in without touching the engine.
//
// Required metadata:
//   id            string  - stable program key, e.g. 'ff' (used in custom IDs).
//   label         string  - human name, e.g. 'Friendly Fire'.
//   staffThreadId string  - Discord thread/channel that returning-player notes
//                           are posted to.
//   registerLink  string  - URL a returning member uses to sign back up.
//   nextSessionInfo string- short line about the next session.
//
// Required methods:
//   async getLapsedMembers(): Promise<Array<LapsedMember>>
//       Returns the members currently eligible for re-engagement.
//   async getChangelogSince(season: number): Promise<string[]>
//       Returns "what changed" lines applicable to someone who last played in
//       the given season (i.e. changes after that season).
//   async getForcedTargets(userIds: string[]): Promise<Array<LapsedMember>>
//       Test hook: build synthetic targets for specific user IDs from real data,
//       regardless of whether they are actually lapsed.
//
// LapsedMember shape (also the output of churn detection):
//   { userId, inGameName, lastActiveSeason, lapsedSeasons, achievements }
//
// This module exports only a documentation/validation helper; the contract is
// structural.

const REQUIRED_KEYS = ['id', 'label', 'staffThreadId', 'registerLink', 'getLapsedMembers', 'getChangelogSince'];

function assertAdapter(adapter) {
    for (const key of REQUIRED_KEYS) {
        if (adapter[key] === undefined || adapter[key] === null) {
            throw new Error(`ProgramAdapter is missing required key: ${key}`);
        }
    }
    return adapter;
}

module.exports = { assertAdapter, REQUIRED_KEYS };
