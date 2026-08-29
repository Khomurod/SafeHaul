/**
 * Super Admin callable for the website-lead archive.
 *
 * ## What was here before
 *
 * Six callables: `getLandingPageSettings`, `updateLandingTelegramConfig`,
 * `setLandingTelegramEnabled`, `sendLandingTelegramTest`, `listLandingLeads` and
 * `retryLandingLeadDelivery` — the Landing Page Settings screen. The marketing
 * site they served has been removed and lead capture, Telegram delivery,
 * configuration, test-send and retry are all retired by owner decision.
 *
 * **The leads themselves were kept**, so one callable survives: the archive
 * screen has to be able to read them. Anything that wrote, delivered or
 * configured is gone, which means this file can no longer touch a credential at
 * all — the strongest form of the rule the old header spent a paragraph on. Any
 * rebuilt lead capture is to be **built fresh**, not restored from here.
 *
 * ## Security contract, unchanged
 *
 * This reuses the Environment & Integrations guards rather than inventing its
 * own, because those guards already encode what this screen needs: **exact**
 * `globalRole === 'super_admin'` (no company-admin path), authentication within
 * the last 15 minutes, a fail-closed rate limit, and a value-free audit record on
 * every outcome including denials. The rows it returns carry third-party contact
 * details, so read access is as guarded as a credential read was.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../environmentVault/audit');
const { assertSuperAdmin, assertWithinRateLimit } = require('../environmentVault/guards');
const leads = require('./leads');

/**
 * No `secrets` binding any more.
 *
 * The old options bound `SMS_ENCRYPTION_KEY` and both `LANDING_TELEGRAM_*`
 * values because the settings screen decrypted and reported on them. Nothing here
 * reads a credential, so binding one would grant an access this function has no
 * use for.
 */
const archiveOptions = { cors: true, region: 'us-central1' };

/** The integration name recorded on every audit row from this screen. */
const INTEGRATION = 'Website leads (archive)';

/**
 * Turns an unexpected error into a value-free failure.
 *
 * A lead row contains a name, an email and a phone number, so an error message
 * built from one is a disclosure. Callers get a fixed string.
 */
function safeFailure(error, label) {
    if (error instanceof HttpsError) return error;
    console.error(`[landing/callables] ${label} failed: ${error?.message || 'unknown'}`);
    return new HttpsError('internal', 'That operation could not be completed.');
}

/**
 * Lists archived leads, newest first.
 *
 * The CSV export the archive screen offers is built in the browser from exactly
 * these rows — there is no separate export endpoint, so nothing can leave the
 * server through a path this audit record does not cover.
 */
exports.listLandingLeads = onCall(archiveOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST, { integration: INTEGRATION });
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST, { integration: INTEGRATION }, 'landing');

    try {
        const rows = await leads.listLeads(request.data?.limit);
        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { integration: INTEGRATION, key: 'landing_leads', entryCount: rows.length },
        });
        return { leads: rows };
    } catch (error) {
        throw safeFailure(error, 'listLandingLeads');
    }
});
