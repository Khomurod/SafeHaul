const configController = require('./controllers/configController');
const smsService = require('./services/smsService');

// Re-export everything to maintain backward compatibility with functions/index.js
module.exports = {
    ...configController,
    ...smsService
};
