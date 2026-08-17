const Mixpanel = require('mixpanel');
const logger = require('./logger');

// Mixpanel.init throws without a token, which would crash the bot at require
// time. Analytics must never take the bot down, so degrade to null instead.
const token = process.env.MIXPANEL_PROJECT_TOKEN;
if (!token) {
    logger.warn('[Analytics] MIXPANEL_PROJECT_TOKEN not set, Mixpanel disabled');
}

module.exports = token ? Mixpanel.init(token) : null;
