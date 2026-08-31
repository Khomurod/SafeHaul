/**
 * Super Admin → AI Integrations callables.
 *
 * These deliberately reuse the Environment & Integrations vault's guards and
 * audit trail rather than starting a parallel security model. The same rules
 * therefore apply without having to be re-implemented or re-argued:
 *
 *  - exact `globalRole === 'super_admin'`, read from the verified ID token
 *    with no Firestore fallback;
 *  - recent authentication (15 minutes) for every reveal and every mutation;
 *  - fail-closed per-operation rate limits;
 *  - one credential per reveal request;
 *  - value-free audit records in `environment_audit_log`;
 *  - safe, generic errors that never echo a provider's response.
 *
 * The two consoles also share one source of truth: AI credentials live in
 * Secret Manager under `SAFEHAUL_AI_*` and are inventoried by the vault
 * registry, which derives its rows from the same frozen AI provider table used
 * here. There is no second credential store.
 *
 * Provider ids arriving from the browser are resolved through that frozen
 * registry before anything else happens, so no request can name a Secret
 * Manager resource, a URL or a Firestore path of its own choosing.
 */

// The handlers themselves live in `callables/`, grouped by what they do to the
// credential store: read, mutate, diagnose, report. This module is the
// deployment surface and nothing else — `index.js` reads these names off it, so
// **the export names here are the contract** and a rename is a redeployment.
const { buildProviderRow, listAiProviders } = require('./callables/list');
const {
    diagnoseAiCredentialAccess, migrateGroqCredential, revealAiCredential,
} = require('./callables/credentials');
const {
    deleteAiCredential, saveAiCredential, setAiProviderEnabled,
    setAiProviderPriority, updateAiProviderConfig,
} = require('./callables/mutations');
const { testAiProvider } = require('./callables/health');
const {
    diagnoseAiModelPins, listAiTelemetry, normalizeLogFilters,
} = require('./callables/telemetry');
const { MASK, requireRegisteredProvider } = require('./callables/options');

exports.listAiProviders = listAiProviders;
exports.revealAiCredential = revealAiCredential;
exports.saveAiCredential = saveAiCredential;
exports.deleteAiCredential = deleteAiCredential;
exports.setAiProviderEnabled = setAiProviderEnabled;
exports.setAiProviderPriority = setAiProviderPriority;
exports.updateAiProviderConfig = updateAiProviderConfig;
exports.testAiProvider = testAiProvider;
exports.diagnoseAiCredentialAccess = diagnoseAiCredentialAccess;
exports.migrateGroqCredential = migrateGroqCredential;
exports.listAiTelemetry = listAiTelemetry;
exports.diagnoseAiModelPins = diagnoseAiModelPins;

exports.__test = { buildProviderRow, MASK, requireRegisteredProvider, normalizeLogFilters };
