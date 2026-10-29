'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');
const winston = require('winston');
const logger = require('../utils/logger');

// Logs one line through the real logger format and returns what it printed.
function capture(log) {
    const stream = new PassThrough();
    const transport = new winston.transports.Stream({ stream });
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk.toString()));
    logger.add(transport);
    try {
        log();
    } finally {
        logger.remove(transport);
    }
    return chunks.join('');
}

test('a string second argument is kept in the line', () => {
    const line = capture(() => logger.error('[Job] push failed:', 'getaddrinfo ENOTFOUND x'));
    assert.match(line, /\[ERROR\] \[Job\] push failed: getaddrinfo ENOTFOUND x/);
});

test('several plain arguments are all kept, in order', () => {
    const line = capture(() => logger.warn('[Job] unknown action:', 'foo', 42));
    assert.match(line, /\[WARN\] \[Job\] unknown action: foo 42/);
});

test('an Error second argument still logs its message and stack', () => {
    const line = capture(() => logger.error('[Job] failed:', new Error('boom')));
    assert.match(line, /\[Job\] failed: boom/);
    assert.match(line, /Error: boom\n\s+at /);
});

test('an object second argument is still printed as metadata', () => {
    const line = capture(() => logger.info('[Job] done', { count: 3 }));
    assert.match(line, /\[INFO\] \[Job\] done \{"count":3\}/);
});

test('a plain line is unchanged', () => {
    const line = capture(() => logger.info('[Job] started'));
    assert.match(line, /\[INFO\] \[Job\] started\n?$/);
});
