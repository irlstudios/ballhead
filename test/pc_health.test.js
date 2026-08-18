'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createHealth, recordSuccess, recordFailure } = require('../utils/voice_moderation/pc_health');

test('starts healthy and stays healthy below the threshold', () => {
    let h = createHealth({ failureThreshold: 3 });
    assert.strictEqual(h.healthy, true);
    h = recordFailure(recordFailure(h));
    assert.strictEqual(h.healthy, true);
    assert.strictEqual(h.consecutiveFailures, 2);
});

test('goes unhealthy at the threshold and recovers on success', () => {
    let h = createHealth({ failureThreshold: 3 });
    h = recordFailure(recordFailure(recordFailure(h)));
    assert.strictEqual(h.healthy, false);
    h = recordSuccess(h);
    assert.deepStrictEqual([h.healthy, h.consecutiveFailures], [true, 0]);
});

test('does not mutate the input state', () => {
    const h = createHealth({});
    recordFailure(h);
    assert.strictEqual(h.consecutiveFailures, 0);
});
