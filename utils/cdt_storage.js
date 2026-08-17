'use strict';

const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { CDT_S3_BUCKET } = require('../config/constants');

// Region and credentials come from the SDK default chain (.env AWS_REGION and
// AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or the instance role on the host).
const s3 = new S3Client({});

const KEY_PREFIX = 'cdt-designs';

// Every file swap writes a fresh version prefix and only then commits the new
// version to the database, so the Get Files button never sees a half-replaced
// set. Old prefixes are deleted after the commit.
const designPrefix = (designId, version) => `${KEY_PREFIX}/${designId}/v${version}/`;

const requireBucket = () => {
    if (!CDT_S3_BUCKET) {
        throw new Error('CDT_S3_BUCKET is not set; design file storage is unconfigured.');
    }
};

// File names become S3 keys and attachment:// references, so anything outside
// a safe character set is replaced.
const sanitizeName = (name) => {
    const safe = (name || '').replace(/[^\w.-]/g, '_');
    return safe.replace(/^\.+$/, '') || 'file';
};

// Duplicate attachment names within one design get an index suffix so they do
// not overwrite each other as S3 keys; suffixed candidates are re-checked so a
// literal "court-2.json" in the input cannot collide either.
const dedupeNames = (names) => {
    const used = new Set();
    return names.map((name) => {
        const dot = name.lastIndexOf('.');
        let candidate = name;
        let counter = 1;
        while (used.has(candidate)) {
            counter += 1;
            candidate = dot > 0 ? `${name.slice(0, dot)}-${counter}${name.slice(dot)}` : `${name}-${counter}`;
        }
        used.add(candidate);
        return candidate;
    });
};

// files: [{ attachment: <discord CDN url>, name }] from toFilePayloads.
const putDesignFiles = async (designId, version, files) => {
    requireBucket();
    const names = dedupeNames(files.map((file) => sanitizeName(file.name)));
    await Promise.all(files.map(async (file, i) => {
        const response = await fetch(file.attachment);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${file.name} from Discord: ${response.status}`);
        }
        await s3.send(new PutObjectCommand({
            Bucket: CDT_S3_BUCKET,
            Key: `${designPrefix(designId, version)}${names[i]}`,
            Body: Buffer.from(await response.arrayBuffer()),
        }));
    }));
};

const listKeys = async (prefix) => {
    const keys = [];
    let token;
    do {
        const page = await s3.send(new ListObjectsV2Command({
            Bucket: CDT_S3_BUCKET,
            Prefix: prefix,
            ContinuationToken: token,
        }));
        keys.push(...(page.Contents || []).map((object) => object.Key));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
};

// Returns [{ attachment: Buffer, name }] ready to attach to a Discord reply.
const getDesignFiles = async (designId, version) => {
    requireBucket();
    const prefix = designPrefix(designId, version);
    const keys = await listKeys(prefix);
    return Promise.all(keys.map(async (key) => {
        const object = await s3.send(new GetObjectCommand({ Bucket: CDT_S3_BUCKET, Key: key }));
        return {
            attachment: Buffer.from(await object.Body.transformToByteArray()),
            name: key.slice(prefix.length),
        };
    }));
};

// Deletes one version's files, or every stored version when version is null.
const deleteDesignFiles = async (designId, version = null) => {
    requireBucket();
    const prefix = version === null ? `${KEY_PREFIX}/${designId}/` : designPrefix(designId, version);
    const keys = await listKeys(prefix);
    for (let i = 0; i < keys.length; i += 1000) {
        const result = await s3.send(new DeleteObjectsCommand({
            Bucket: CDT_S3_BUCKET,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
        }));
        if (result.Errors?.length) {
            throw new Error(`Failed to delete ${result.Errors.length} object(s) under ${prefix}: ${result.Errors[0].Message}`);
        }
    }
};

module.exports = {
    designPrefix,
    sanitizeName,
    dedupeNames,
    putDesignFiles,
    getDesignFiles,
    deleteDesignFiles,
};
