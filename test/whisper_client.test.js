'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { transcribeWav, probeServer } = require('../utils/voice_moderation/whisper_client');

const servers = [];
const startStub = (handler) => new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

after(() => { for (const s of servers) s.close(); });

test('transcribeWav posts multipart wav and returns text', async () => {
    const url = await startStub((req, res) => {
        assert.strictEqual(req.method, 'POST');
        assert.strictEqual(req.url, '/inference');
        assert.match(req.headers['content-type'], /multipart\/form-data/);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ text: ' hello world ' }));
    });
    const result = await transcribeWav(Buffer.from('RIFFfake'), { url });
    assert.deepStrictEqual(result, { ok: true, text: 'hello world' });
});

test('transcribeWav reports http errors without throwing', async () => {
    const url = await startStub((req, res) => { res.statusCode = 500; res.end('boom'); });
    const result = await transcribeWav(Buffer.from('RIFFfake'), { url });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /500/);
});

test('transcribeWav reports network failure without throwing', async () => {
    const result = await transcribeWav(Buffer.from('RIFFfake'), { url: 'http://127.0.0.1:9' });
    assert.strictEqual(result.ok, false);
});

test('probeServer true when server answers, false when unreachable', async () => {
    const url = await startStub((req, res) => { res.statusCode = 404; res.end(); });
    assert.strictEqual(await probeServer({ url }), true);
    assert.strictEqual(await probeServer({ url: 'http://127.0.0.1:9' }), false);
});
