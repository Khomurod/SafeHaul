/**
 * SMS integration configuration controllers — aggregator.
 * =======================================================
 * The original single-file controller was split by concern into
 * ./config/ (behavior unchanged, exports preserved):
 *
 *  - config/providerConfigController.js  — saveIntegrationConfig, verifySmsConfig
 *  - config/lineConnectionController.js  — testLineConnection, verifyLineConnection
 *  - config/lineInventoryController.js   — addPhoneLine, removePhoneLine
 *  - config/lineAssignmentsController.js — saveSmsLineAssignments
 *  - config/lineTokens.js                — shared stable line-ID helpers
 *
 * Every controller above binds `secrets: ['SMS_ENCRYPTION_KEY']` on its own
 * onCall options (guarded by test/unit/smsSecretBindings.test.js).
 */

const providerConfigController = require('./config/providerConfigController');
const lineConnectionController = require('./config/lineConnectionController');
const lineInventoryController = require('./config/lineInventoryController');
const lineAssignmentsController = require('./config/lineAssignmentsController');

module.exports = {
    ...providerConfigController,
    ...lineConnectionController,
    ...lineInventoryController,
    ...lineAssignmentsController,
};
