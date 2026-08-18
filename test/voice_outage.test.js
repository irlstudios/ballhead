'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createOutageState, applyOutcome } = require('../utils/voice_moderation/outage');

test('transition to unhealthy happens exactly once at the threshold', () => {
    let state = createOutageState({ failureThreshold: 3 });
    const transitions = [];
    for (let i = 0; i < 5; i += 1) {
        state = applyOutcome(state, false);
        if (state.transition) transitions.push(state.transition);
    }
    assert.deepStrictEqual(transitions, ['down']);
});

test('recovery transition fires once on the first success after down', () => {
    let state = createOutageState({ failureThreshold: 3 });
    state = applyOutcome(applyOutcome(applyOutcome(state, false), false), false);
    state = applyOutcome(state, true);
    assert.strictEqual(state.transition, 'up');
    state = applyOutcome(state, true);
    assert.strictEqual(state.transition, null);
});
