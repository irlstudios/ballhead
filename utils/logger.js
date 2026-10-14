'use strict';

const winston = require('winston');

// Axios errors carry their request config, whose headers hold the bot token,
// and link request and response to each other, so those fields are dropped at
// any depth (an axios error nested in meta serialises its config via toJSON).
// Anything else that cannot be serialised is noted instead of letting the
// logger throw inside the caller's catch block.
const UNSAFE_META_KEYS = new Set(['config', 'request', 'response']);
const dropUnsafe = (key, value) => (UNSAFE_META_KEYS.has(key) ? undefined : value);

const formatMeta = (meta) => {
    try {
        const json = JSON.stringify(meta, dropUnsafe);
        return json === '{}' ? '' : ` ${json}`;
    } catch {
        return ' [unserialisable metadata omitted]';
    }
};

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
            const metaStr = formatMeta(meta);
            if (stack) {
                return `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}${metaStr}`;
            }
            return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
    ],
});

module.exports = logger;
