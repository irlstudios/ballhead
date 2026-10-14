'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { Writable } = require('node:stream');
const { setImmediate } = require('node:timers/promises');
const winston = require('winston');
const { AxiosError } = require('axios');
const logger = require('../utils/logger');

// The shape axios rejects with on a 404: the request and response point at each
// other, and the config carries the Authorization header with the bot token.
const axios404 = () => {
    const config = { headers: { Authorization: 'Bot secret-token' } };
    const request = { method: 'GET', headers: config.headers };
    const response = { status: 404, data: { message: 'Unknown Invite' }, request, config };
    request.res = response;
    return new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', config, request, response);
};

const captureOutput = async (run) => {
    const chunks = [];
    const capture = new winston.transports.Stream({
        stream: new Writable({ write: (chunk, _encoding, done) => { chunks.push(String(chunk)); done(); } }),
    });
    const quiet = logger.transports.map((transport) => [transport, transport.silent]);
    quiet.forEach(([transport]) => { transport.silent = true; });
    logger.add(capture);
    try {
        run();
        await setImmediate();
    } finally {
        logger.remove(capture);
        quiet.forEach(([transport, silent]) => { transport.silent = silent; });
    }
    return chunks.join('');
};

test('logging an axios error neither throws nor writes the bot token', async () => {
    const output = await captureOutput(() => {
        assert.doesNotThrow(() => logger.error('Invite lookup failed:', axios404()));
    });
    assert.match(output, /Invite lookup failed: Request failed with status code 404/);
    assert.match(output, /ERR_BAD_REQUEST/);
    assert.doesNotMatch(output, /secret-token/);
});

test('an axios error nested in metadata does not write the bot token either', async () => {
    const output = await captureOutput(() => {
        assert.doesNotThrow(() => logger.error('Nested failure', { err: axios404() }));
    });
    assert.match(output, /Nested failure/);
    assert.match(output, /ERR_BAD_REQUEST/);
    assert.doesNotMatch(output, /secret-token/);
});

test('logging any other circular object does not throw', async () => {
    const circular = { name: 'loop' };
    circular.self = circular;
    const output = await captureOutput(() => {
        assert.doesNotThrow(() => logger.info('Circular meta', circular));
    });
    assert.match(output, /Circular meta/);
});

test('plain metadata is still written', async () => {
    const output = await captureOutput(() => logger.info('Plain meta', { sessionId: 7 }));
    assert.match(output, /Plain meta \{"sessionId":7\}/);
});
