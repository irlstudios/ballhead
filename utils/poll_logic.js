'use strict';

// Pure list + scoring logic for the community top-5 poll. No Discord or DB access
// here so every rule is unit-testable. A "list" is an ordered array of thread IDs
// where index 0 is the user's #1 pick; position = index + 1.

const POLL_BOARDS = ['gameplay', 'skins', 'bugs'];
const MAX_LIST = 5;

function isValidBoard(board) {
    return POLL_BOARDS.includes(board);
}

// A pick at position N is worth (6 - N) points: #1 = 5, #5 = 1.
function weightForPosition(position) {
    return 6 - position;
}

// Which boards a forum thread belongs to, from its parent channel and applied tags.
// Bugs: the whole bug forum. Ideas: one board per recognised category tag (may be
// empty -> not indexed; may be several -> indexed under each).
function resolveBoards({ parentId, appliedTags = [], gameIdeasForumId, bugsForumId, boardTagMap }) {
    if (parentId === bugsForumId) {
        return ['bugs'];
    }
    if (parentId === gameIdeasForumId) {
        return ['gameplay', 'skins'].filter(
            (board) => boardTagMap[board] && appliedTags.includes(boardTagMap[board]),
        );
    }
    return [];
}

function appendToList(list, threadId) {
    if (list.includes(threadId)) {
        return { ok: false, reason: 'duplicate', list };
    }
    if (list.length >= MAX_LIST) {
        return { ok: false, reason: 'full', list };
    }
    return { ok: true, reason: null, list: [...list, threadId] };
}

function moveItem(list, index, direction) {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
        return list;
    }
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

function removeItem(list, index) {
    if (index < 0 || index >= list.length) {
        return list;
    }
    return list.filter((_, i) => i !== index);
}

module.exports = {
    POLL_BOARDS,
    MAX_LIST,
    isValidBoard,
    weightForPosition,
    resolveBoards,
    appendToList,
    moveItem,
    removeItem,
};
