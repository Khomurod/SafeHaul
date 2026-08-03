/**
 * The task interfaces SafeHaul features are allowed to call.
 *
 * This is the whole public surface of the AI platform. A feature imports a
 * named task from here; it never imports a provider, a router internal or an
 * adapter. There is no generic prompt-passthrough by design — the set of
 * prompts the application can issue is fixed in this folder at deploy time.
 */

const contract = require('./contract');
const { extractCdlFields } = require('./cdlExtraction');
const { analyzeDocumentPages } = require('./edocFieldPlacement');
const { testProviderConnection } = require('./healthCheck');

module.exports = {
    TASK_TYPES: contract.TASK_TYPES,
    PRIVACY: contract.PRIVACY,
    extractCdlFields,
    analyzeDocumentPages,
    testProviderConnection,
};
