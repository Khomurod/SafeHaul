const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions"); // V1 for public HTTP
const admin = require("firebase-admin");
const { assertCompanyAdminStrict } = require("../shared/companyAccess");
const axios = require("axios");
const crypto = require("crypto");

// Define secrets for v2 functions
const FACEBOOK_APP_ID = defineSecret("FACEBOOK_APP_ID");
const FACEBOOK_APP_SECRET = defineSecret("FACEBOOK_APP_SECRET");
const FACEBOOK_VERIFY_TOKEN = defineSecret("FACEBOOK_VERIFY_TOKEN");

const db = admin.firestore();

/**
 * Connect a Facebook Page to the Platform
 * 1. Exchange User Token for Long-Lived Page Token
 * 2. Store in global integrations index
 * 3. Subscribe App to Page Webhooks
 */
exports.connectFacebookPage = onCall(
    { secrets: [FACEBOOK_APP_ID, FACEBOOK_APP_SECRET] },
    async (request) => {
        // 1. Security Check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'User must be logged in.');
        }

        const { shortLivedUserToken, pageId, pageName, companyId } = request.data;

        if (!shortLivedUserToken || !pageId) {
            throw new HttpsError('invalid-argument', 'Missing token or page ID.');
        }
        /*
         * TENANT BINDING.
         *
         * This used to be `const companyId = request.auth.uid`, under a comment
         * assuming a 1:1 user-to-company mapping. SafeHaul has never worked that
         * way: companies carry generated ids and users join them through
         * `memberships`, and a user can belong to several (hence the company
         * chooser). So every page connected this way wrote its leads to
         * `companies/{uid}/leads` — a tree belonging to no company at all, which
         * no screen reads. The leads were not misrouted between tenants; they
         * were silently dropped into nowhere.
         *
         * The caller must therefore say which company they are acting for, and
         * the server must not believe them. `assertCompanyAdminStrict` is the
         * shared assertion every comparable callable uses — `saveEmailSettings`,
         * `deleteApplication`, `applicationChanges`, the bulk-action admin tools —
         * and its docblock names this exact situation: "sensitive configuration
         * and outbound actions". It throws `invalid-argument` on a missing
         * companyId, so that check comes free.
         *
         * Reusing it rather than hand-rolling `token.roles[companyId]` matters
         * for one case in particular: custom claims are rebuilt asynchronously on
         * membership writes, so a freshly promoted admin can hold a stale token.
         * The shared helper falls back to the `memberships` collection and the
         * company's own ownerId; a bespoke claims-only check would reject them.
         *
         * Accepting an unverified `companyId` would have turned a bug that loses
         * leads into one that plants them in someone else's tenant.
         */
        await assertCompanyAdminStrict(request.auth.uid, companyId);

        /*
         * A page is claimed by one company, and this matters MORE after the
         * tenant fix above than before it. The write below has always been an
         * unconditional `.set()`; while the stored value was the caller's uid a
         * rebind just moved the page to another tree nobody reads. Now the value
         * is a REAL company, so an unguarded rebind would silently redirect a
         * live lead feed from one tenant into another. An attacker still needs
         * Facebook-side access to the page, which is a real barrier — but "you
         * must first compromise their Facebook account" is not a boundary worth
         * relying on when refusing costs three lines.
         *
         * Checked BEFORE the Graph API calls, both because it needs nothing from
         * them and because it must not be thrown inside the try below, whose
         * catch would flatten it into "Failed to connect Facebook Page." and
         * leave the admin with no idea why.
         *
         * Re-connecting a page to the SAME company is allowed: that is the
         * ordinary token-refresh path and it has to keep working.
         */
        const existing = await db.collection('integrations_index').doc(pageId).get();
        const heldBy = existing.exists ? existing.data().companyId : null;
        if (heldBy && heldBy !== companyId) {
            /*
             * One exception, and it is the whole recovery path for this bug.
             *
             * Every page connected before the fix holds a USER id here, not a
             * company id. Refusing those would mean the rightful company could
             * never reconnect its own page — it would be told, permanently and
             * incomprehensibly, that another company owns it. A stale uid binding
             * was never serving anyone (its leads went to a tree no screen
             * reads), so releasing it costs nothing and unblocks the owner.
             *
             * A binding to a real company is a different matter and still stands.
             */
            const holder = await db.collection('companies').doc(heldBy).get();
            if (holder.exists) {
                throw new HttpsError(
                    'already-exists',
                    'This Facebook Page is already connected to another company. Disconnect it there first.',
                );
            }
            console.log(
                `[connectFacebookPage] Page ${pageId} was bound to ${heldBy}, which is not a company `
                + `(pre-2026-08-25 uid binding). Reclaiming it for ${companyId}.`,
            );
        }

        try {
            // 2. Exchange Token (User -> Page Long-Lived)
            // First exchange for Long-Lived User Token (60 days)
            const exchangeResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: FACEBOOK_APP_ID.value(),
                    client_secret: FACEBOOK_APP_SECRET.value(),
                    fb_exchange_token: shortLivedUserToken
                }
            });

            const longLivedUserToken = exchangeResponse.data.access_token;

            if (!longLivedUserToken) {
                throw new Error("Failed to exchange for Long-Lived User Token.");
            }

            // Now use the Long-Lived User Token to get the Page Token
            const response = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
                params: {
                    fields: 'access_token',
                    access_token: longLivedUserToken
                }
            });

            const pageAccessToken = response.data.access_token;
            if (!pageAccessToken) {
                throw new Error("Failed to retrieve Page Access Token.");
            }

            // 3. Save to Global Index (Root Collection for Webhook Lookup)
            //    integrations_index/{pageId}
            await db.collection('integrations_index').doc(pageId).set({
                companyId: companyId,
                pageName: pageName || 'Unknown Page',
                accessToken: pageAccessToken, // Stored securely
                connectedAt: admin.firestore.FieldValue.serverTimestamp(),
                platform: 'facebook'
            });

            // 4. Subscribe App to Page Webhooks (leadgen)
            // POST /{page-id}/subscribed_apps
            await axios.post(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, null, {
                params: {
                    subscribed_fields: 'leadgen',
                    access_token: pageAccessToken
                }
            });

            return { success: true, message: `Connected ${pageName} successfully.` };

        } catch (error) {
            // A deliberate HttpsError carries a message the admin can act on.
            // Flattening it into the generic one below loses exactly the part
            // that tells them what to do.
            if (error instanceof HttpsError) throw error;
            console.error("Facebook Connection Error:", error.response?.data || error.message);
            throw new HttpsError('internal', 'Failed to connect Facebook Page.');
        }
    });

/**
 * Facebook Webhook Handler
 * - Verifies Challenge
 * - Ingests Leads
 */
exports.facebookWebhook = onRequest(
    { secrets: [FACEBOOK_APP_SECRET, FACEBOOK_VERIFY_TOKEN], invoker: 'public' },
    async (req, res) => {
        const APP_SECRET = FACEBOOK_APP_SECRET.value();
        const VERIFY_TOKEN_VALUE = FACEBOOK_VERIFY_TOKEN.value();
        if (!VERIFY_TOKEN_VALUE) throw new Error("FACEBOOK_VERIFY_TOKEN secret is not set in production.");

        // A. Verification (GET)
        if (req.method === 'GET') {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];

            if (mode && token) {
                if (mode === 'subscribe' && token === VERIFY_TOKEN_VALUE) {
                    console.log('WEBHOOK_VERIFIED');
                    return res.status(200).send(challenge);
                } else {
                    return res.sendStatus(403);
                }
            }
        }

        // B. Security (Signature Check for POST)
        if (req.method === 'POST') {
            if (!APP_SECRET) {
                console.error("Critical: APP_SECRET not set.");
                return res.sendStatus(500);
            }

            const signature = req.headers['x-hub-signature'];
            if (!signature) {
                console.warn("Missing X-Hub-Signature");
                return res.sendStatus(401); // P1-4 FIX: Enforce signature validation
            } else {
                const elements = signature.split('=');
                const signatureHash = elements[1];
                const expectedHash = crypto.createHmac('sha1', APP_SECRET)
                    .update(req.rawBody) // Firebase Functions preserves rawBody
                    .digest('hex');

                if (signatureHash !== expectedHash) {
                    console.error("Invalid Signature");
                    return res.sendStatus(403);
                }
            }

            // C. Process Entries
            try {
                const body = req.body;
                if (body.object === 'page') {
                    for (const entry of body.entry) {
                        for (const change of entry.changes) {
                            if (change.field === 'leadgen') {
                                await processLead(change.value);
                            }
                        }
                    }
                    return res.status(200).send('EVENT_RECEIVED');
                } else {
                    return res.sendStatus(404);
                }
            } catch (error) {
                console.error("Webhook Error:", error);
                return res.sendStatus(500);
            }
        }

        return res.sendStatus(405);
    });

// --- Helper: Process Single Lead ---
async function processLead(value) {
    const { leadgen_id, page_id } = value;

    // 1. Lookup Company
    const integrationDoc = await db.collection('integrations_index').doc(page_id).get();

    if (!integrationDoc.exists) {
        console.error(`Received lead for unknown page: ${page_id}`);
        return;
    }

    const { companyId, accessToken } = integrationDoc.data();

    // 2. Fetch Lead Details from Graph API
    const leadResponse = await axios.get(`https://graph.facebook.com/v19.0/${leadgen_id}`, {
        params: {
            access_token: accessToken
        }
    });

    const leadData = leadResponse.data;
    // Format: { id, created_time, field_data: [{name: 'full_name', values: ['...']}] }

    // 3. Map Fields
    // We need to map standard fields (email, phone_number, full_name, etc.)
    const mappedLead = {
        // Tenant binding: keep parity with client-created leads so collection-group
        // {path=**}/leads reads (which gate on resource.data.companyId) work.
        companyId: companyId,
        firstName: '',
        lastName: '',
        phone: '',
        email: '',
        source: 'Facebook Ads',
        status: 'New Lead',
        createdAt: admin.firestore.Timestamp.fromDate(new Date(leadData.created_time || Date.now())),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        facebookLeadId: leadgen_id,
        pageId: page_id
    };

    // Helper map
    (leadData.field_data || []).forEach(field => {
        const val = field.values[0];
        const name = field.name;

        if (name === 'email') mappedLead.email = val;
        if (name === 'phone_number') mappedLead.phone = val;
        if (name === 'full_name') {
            const parts = val.split(' ');
            mappedLead.firstName = parts[0];
            mappedLead.lastName = parts.slice(1).join(' ') || '';
        }
        if (name === 'first_name') mappedLead.firstName = val;
        if (name === 'last_name') mappedLead.lastName = val;
        // Add more mappings as needed involved in your lead forms
    });

    // Fallback Name
    if (!mappedLead.firstName && !mappedLead.lastName) {
        mappedLead.lastName = 'Facebook Lead';
    }

    // 4. Save to Company Subcollection
    await db.collection('companies').doc(companyId).collection('leads').add(mappedLead);
    console.log(`Ingested Facebook Lead ${leadgen_id} for Company ${companyId}`);
}

/**
 * Facebook Webhook Handler - V1 Version (Public HTTP by default)
 * This version uses Cloud Functions Gen 1 which doesn't have Cloud Run auth issues
 */
exports.facebookWebhookV1 = functions.https.onRequest(async (req, res) => {
    // Use runtime config or environment for secrets in V1
    const APP_SECRET = process.env.FACEBOOK_APP_SECRET_VALUE || '';
    const VERIFY_TOKEN_VALUE = process.env.FACEBOOK_VERIFY_TOKEN_VALUE;
    if (!VERIFY_TOKEN_VALUE) {
        console.error("FACEBOOK_VERIFY_TOKEN_VALUE is not set.");
        return res.sendStatus(500);
    }

    // A. Verification (GET)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN_VALUE) {
                console.log('WEBHOOK_VERIFIED_V1');
                return res.status(200).send(challenge);
            } else {
                return res.sendStatus(403);
            }
        }
    }

    // B. Security (Signature Check for POST)
    if (req.method === 'POST') {
        if (!APP_SECRET) {
            console.error("Critical: APP_SECRET not set for V1 webhook.");
            return res.sendStatus(500);
        }

        const signature = req.headers['x-hub-signature'];
        if (!signature) {
            console.warn("Missing X-Hub-Signature V1");
            return res.sendStatus(401);
        }

        const elements = signature.split('=');
        const signatureHash = elements[1];
        const expectedHash = crypto.createHmac('sha1', APP_SECRET)
            .update(req.rawBody)
            .digest('hex');

        if (signatureHash !== expectedHash) {
            console.error("Invalid Signature V1");
            return res.sendStatus(403);
        }

        // C. Process Entries
        try {
            const body = req.body;
            if (body.object === 'page') {
                for (const entry of body.entry) {
                    for (const change of entry.changes) {
                        if (change.field === 'leadgen') {
                            await processLead(change.value);
                        }
                    }
                }
                return res.status(200).send('EVENT_RECEIVED');
            } else {
                return res.sendStatus(404);
            }
        } catch (error) {
            console.error("Webhook Error V1:", error);
            return res.sendStatus(500);
        }
    }

    return res.sendStatus(405);
});
