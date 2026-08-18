'use strict';

// HTTP client for whisper-server (whisper.cpp) on the PC over the tailnet.
// Never throws: callers branch on { ok } and feed the health tracker.

const REQUEST_TIMEOUT_MS = 30000;

const baseUrl = (url) => (url || process.env.WHISPER_SERVER_URL || '').replace(/\/$/, '');

const postInference = async (wav, url, responseFormat) => {
    const base = baseUrl(url);
    if (!base) return { ok: false, reason: 'unconfigured' };
    try {
        const form = new FormData();
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
        form.append('response_format', responseFormat);
        const response = await fetch(`${base}/inference`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) return { ok: false, reason: `http ${response.status}` };
        return { ok: true, body: await response.json() };
    } catch (error) {
        return { ok: false, reason: error.message || 'network error' };
    }
};

const transcribeWav = async (wav, { url } = {}) => {
    const result = await postInference(wav, url, 'json');
    if (!result.ok) return result;
    return { ok: true, text: (result.body.text || '').trim() };
};

// Segment offsets are seconds relative to the start of the WAV; callers that
// send silence-padded clip tracks read them directly as clip offsets.
const transcribeWavVerbose = async (wav, { url } = {}) => {
    const result = await postInference(wav, url, 'verbose_json');
    if (!result.ok) return result;
    const segments = (result.body.segments || [])
        .map(({ start, end, text }) => ({ start, end, text: (text || '').trim() }))
        .filter((segment) => segment.text);
    return { ok: true, text: (result.body.text || '').trim(), segments };
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

module.exports = { transcribeWav, transcribeWavVerbose, probeServer };
