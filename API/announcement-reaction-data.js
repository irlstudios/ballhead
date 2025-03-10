const axios = require('axios');

const apiEndpoint = 'https://lyjm699n1i.execute-api.us-east-2.amazonaws.com/dev/meticHandlers/announcements';

async function trackMetrics({ userID, channelID, messageID, timestamp }) {
    try {
        const response = await axios.post(apiEndpoint, {
            userID,
            channelID,
            messageID,
            timestamp,
        });
        console.log('Metrics logged successfully:', response.data);
    } catch (error) {
        console.error('Error logging metrics:', error.response?.data || error.message);
    }
}

module.exports = { trackMetrics };