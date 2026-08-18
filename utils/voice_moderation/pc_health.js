'use strict';

// Pure health state machine for the PC whisper service. Consecutive cycle
// failures beyond the threshold flip healthy off; any success flips it back.

const createHealth = ({ failureThreshold = 3 } = {}) => ({
    failureThreshold, consecutiveFailures: 0, healthy: true,
});

const recordSuccess = (health) => ({ ...health, consecutiveFailures: 0, healthy: true });

const recordFailure = (health) => {
    const consecutiveFailures = health.consecutiveFailures + 1;
    return { ...health, consecutiveFailures, healthy: consecutiveFailures < health.failureThreshold };
};

module.exports = { createHealth, recordSuccess, recordFailure };
