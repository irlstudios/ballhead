const test = require('node:test');
const assert = require('node:assert');
const { createCanvas, loadImage } = require('canvas');

// canvas@2 built from source on the Node 24 prod host painted every pixel
// black (2026-10-09), blanking every leaderboard and LFG image. Run this on
// the host after a Node or canvas change.
test('canvas paints and round-trips a PNG', async () => {
    const canvas = createCanvas(4, 4);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 4, 4);
    assert.deepStrictEqual(Array.from(ctx.getImageData(1, 1, 1, 1).data), [255, 0, 0, 255]);

    const decoded = await loadImage(canvas.toBuffer());
    const check = createCanvas(4, 4).getContext('2d');
    check.drawImage(decoded, 0, 0);
    assert.deepStrictEqual(Array.from(check.getImageData(1, 1, 1, 1).data), [255, 0, 0, 255]);
});
