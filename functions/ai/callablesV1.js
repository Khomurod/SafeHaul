/**
 * The 1st generation half of the credential-access diagnosis.
 *
 * This file exists for one reason, and it is not tidiness: **1st and 2nd
 * generation Cloud Functions default to different runtime service accounts.**
 * 1st gen runs as the App Engine default account, 2nd gen as the Compute Engine
 * default account, and SafeHaul deploys both without setting an explicit
 * `serviceAccount` anywhere. AI credentials are read at runtime through the
 * Secret Manager client, so access depends entirely on a manual IAM grant — and
 * a grant made to one of those accounts leaves the other refused.
 *
 * The observable effect is that CDL auto-fill (1st gen, `parseCdlWithGroq`) and
 * the E-Doc assistant, AI Integrations console and blog scheduler (all 2nd gen)
 * can disagree about whether the very same credential exists. Nothing in the
 * product could show that, and `docs/ai-platform.md` compounded it by naming
 * only the App Engine account in its manual-setup step.
 *
 * So the diagnosis runs from both generations and the console shows both
 * answers side by side. A single row proves nothing; the pair is the diagnosis.
 *
 * Everything else — the guards, the audit trail, the value-free report — is
 * shared with ./callables.js. This file is the generation, not a second
 * implementation.
 */

const functions = require('firebase-functions/v1');
const { assertSuperAdmin, assertWithinRateLimit } = require('../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const { diagnoseCredentialAccess } = require('./tasks/credentialAccess');

/**
 * Re-throws a v2 `HttpsError` as its v1 equivalent.
 *
 * The shared guards are written against the 2nd generation SDK and throw its
 * `HttpsError` class. The 1st generation wrapper recognises only its own, so an
 * unconverted guard rejection would reach the browser as a bare `internal` —
 * turning "you are not a super admin" and "slow down" into the same
 * indistinguishable failure. Reusing the guards is worth this adapter; writing a
 * second set of authorization rules would not be.
 */
function asV1Error(error) {
    const code = typeof error?.httpErrorCode?.status === 'string' ? null : error?.code;
    if (typeof code === 'string' && code.includes('-')) {
        return new functions.https.HttpsError(code, error.message || 'The request could not be completed.');
    }
    if (error instanceof functions.https.HttpsError) return error;
    console.error(`[ai/diagnoseAiCredentialAccessV1] ${error?.message || 'unknown error'}`);
    return new functions.https.HttpsError('internal', 'The request could not be completed.');
}

exports.diagnoseAiCredentialAccessV1 = functions
    // The legacy Groq binding must be readable here for the same reason it is on
    // the 2nd generation callables: the report says whether this runtime carries
    // it, and a binding is declared per function.
    .runWith({ memory: '256MB', timeoutSeconds: 60, secrets: ['GROQ_API_KEY'] })
    .https.onCall(async (data, context) => {
        // The guards need only `auth.uid` and `auth.token`, which a 1st
        // generation `context` carries under the same names.
        const request = { auth: context.auth, data: data || {} };

        try {
            await assertSuperAdmin(request, ACTIONS.LIST, { integration: 'AI credential access' });
            await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: 'AI credential access' });
        } catch (error) {
            throw asV1Error(error);
        }

        try {
            const report = await diagnoseCredentialAccess({ generation: 'v1' });

            await recordAuditEvent({
                auth: request.auth,
                action: ACTIONS.LIST,
                result: RESULTS.SUCCESS,
                metadata: {
                    integration: 'AI credential access',
                    setting: 'gen1',
                    entryCount: report.providers.length,
                    reason: report.unreadableCount > 0 ? 'credentials-unreadable' : null,
                },
            });

            return report;
        } catch (error) {
            throw asV1Error(error);
        }
    });

exports.__private = { asV1Error };
