const axios = require('axios');

const baseUrl = 'https://api.apify.com/v2';
const platformActorEnvMap = {
    tiktok: 'APIFY_TIKTOK_ACTOR_ID',
    youtube: 'APIFY_YT_ACTOR_ID',
    reels: 'APIFY_REEL_ACTOR_ID'
};

function getToken() {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
        throw new Error('APIFY_TOKEN is not set');
    }
    return token;
}

function resolveActorId(platform) {
    const envKey = platformActorEnvMap[platform];
    if (!envKey) {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    const actorId = process.env[envKey];
    if (!actorId) {
        throw new Error(`${envKey} is not set`);
    }
    return actorId;
}

async function startActorRun(actorId, input, token) {
    const response = await axios.post(`${baseUrl}/acts/${actorId}/runs`, input, {
        params: {token},
        timeout: 30000
    });
    return response.data?.data;
}

async function getRun(runId, token) {
    const response = await axios.get(`${baseUrl}/actor-runs/${runId}`, {
        params: {token},
        timeout: 15000
    });
    return response.data?.data;
}

async function waitForRun(runId, token) {
    const finishedStatuses = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
    let attempt = 0;
    const maxAttempts = 80;
    let run = await getRun(runId, token);
    while (run && !finishedStatuses.has(run.status) && attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        attempt += 1;
        run = await getRun(runId, token);
    }
    if (run && finishedStatuses.has(run.status)) {
        return run;
    }
    throw new Error('Apify actor run did not finish within the allotted wait time');
}

async function getDatasetItems(datasetId, token) {
    if (!datasetId) {
        return [];
    }
    const response = await axios.get(`${baseUrl}/datasets/${datasetId}/items`, {
        params: {token, clean: 1},
        timeout: 15000
    });
    return response.data;
}

async function fetchCreatorData(platform, payload) {
    const token = getToken();
    const actorId = resolveActorId(platform);
    const filteredPayload = Object.fromEntries(
        Object.entries(payload || {}).filter(([, value]) => value !== undefined && value !== null)
    );
    const actorInput = filteredPayload.input && typeof filteredPayload.input === 'object'
        ? filteredPayload.input
        : filteredPayload;
    const initialRun = await startActorRun(actorId, actorInput, token);
    if (!initialRun?.id) {
        return {
            platform,
            runId: null,
            status: initialRun?.status || 'UNKNOWN',
            datasetId: null,
            items: []
        };
    }
    const finalRun = await waitForRun(initialRun.id, token) || initialRun;
    const items = await getDatasetItems(finalRun.defaultDatasetId, token);
    return {
        platform,
        runId: finalRun.id,
        status: finalRun.status,
        datasetId: finalRun.defaultDatasetId,
        items,
        input: actorInput
    };
}

module.exports = {fetchCreatorData};
