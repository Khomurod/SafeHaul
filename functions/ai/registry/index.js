const capabilities = require('./capabilities');
const providers = require('./providers');

module.exports = { ...capabilities, ...providers };
