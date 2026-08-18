'use strict';

// HTTP client for whisper-server (whisper.cpp) on the PC over the tailnet.
// Never throws: callers branch on { ok } and feed the health tracker.

const REQUEST_TIMEOUT_MS = 30000;

const baseUrl = (url) => (url || process.env.WHISPER_SERVER_URL || '').replace(/\/$/, '');

const transcribeWav = async (wav, { url } = {}) => {
    const base = baseUrl(url);
    if (!base) return { ok: false, reason: 'unconfigured' };
    try {
        const form = new FormData();
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
        form.append('response_format', 'json');
        const response = await fetch(`${base}/inference`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) return { ok: false, reason: `http ${response.status}` };
        const body = await response.json();
        return { ok: true, text: (body.text || '').trim() };
    } catch (error) {
        return { ok: false, reason: error.message || 'network error' };
    }
};

// Any HTTP response means the server process is up; only a network-level
// failure counts as down. Model readiness is implied by process startup.
const probeServer = async ({ url } = {}) => {
    const base = baseUrl(url);
    if (!base) return false;
    try {
        await fetch(base, { method: 'GET', signal: AbortSignal.timeout(5000) });
        return true;
    } catch {
        return false;
    }
};

module.exports = { transcribeWav, probeServer };
