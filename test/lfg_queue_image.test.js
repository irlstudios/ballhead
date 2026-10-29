'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createCanvas, loadImage } = require('canvas');

// handlers/lfg.js captures undici's request at require time, so the fake CDN
// goes in first; this file runs in its own node:test process.
const undici = require('undici');
let cdn = null;
undici.request = async () => {
    if (!cdn) throw new Error('getaddrinfo ENOTFOUND cdn.ballhead.app');
    return { body: { arrayBuffer: async () => cdn } };
};

const { generateQueueImage } = require('../handlers/lfg');

const queue = { key: 'casual_2v2', size: 4 };
const members = new Map([['1', {}], ['2', {}]]);

test('draws the queue card on the CDN background at its size', async () => {
    cdn = createCanvas(640, 360).toBuffer('image/png');
    const { attachment, name } = await generateQueueImage(queue, members);
    const image = await loadImage(attachment);
    assert.strictEqual(name, 'casual_2v2.png');
    assert.deepStrictEqual([image.width, image.height], [640, 360]);
});

test('still draws the queue card when the CDN background is unavailable', async () => {
    cdn = null;
    const { attachment } = await generateQueueImage(queue, members);
    const image = await loadImage(attachment);
    assert.deepStrictEqual([image.width, image.height], [800, 400]);
});
