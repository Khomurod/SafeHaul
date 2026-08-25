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
         * CLAIMING THE PAGE.
         *
         * A page belongs to one company, and this matters MORE after the tenant
         * fix above than before it. The write below used to be an unconditional
         * `.set()`; while the stored value was the caller's uid a rebind just
         * moved the page to another tree nobody reads. Now the value is a REAL
         * company, so an unguarded rebind would silently redirect a live lead
         * feed from one tenant into another. An attacker still needs
         * Facebook-side access to the page, which is a real barrier — but "you
         * must first compromise their Facebook account" is not a boundary worth
         * relying on when refusing costs a few lines.
         *
         * The check and the claim are ONE TRANSACTION, and it runs BEFORE the
         * Graph API calls. Both of those are deliberate:
         *
         *   - Ordering. The previous shape was read → two Graph round-trips →
         *     write. Two admins connecting the same unclaimed page concurrently
         *     both completed the read before either reached the write, so both
         *     passed the ownership check and the last write took the page. The
         *     window was as wide as two network calls to Facebook.
         *   - Atomicity. Moving the write earlier is not on its own enough;
         *     without a transaction two callers can still interleave read and
         *     write. `runTransaction` makes the pair indivisible, matching the
         *     claim in `bulkActions/workers/batchWorker.js`.
         *
         * The claim is deliberately incomplete: it records the tenant but not
         * the page access token, which does not exist yet. `claimPending` marks
         * that state, and the catch below releases the claim if the Graph flow
         * never finishes — otherwise a failed connect would lock the page away
         * from the company that owns it.
         */
        const indexRef = db.collection('integrations_index').doc(pageId);
        const claim = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(indexRef);
            const previous = snapshot.exists ? snapshot.data() : null;
            const heldBy = previous ? previous.companyId : null;
            const isRebind = Boolean(heldBy) && heldBy !== companyId;

            if (isRebind) {
                /*
                 * One exception, and it is the whole recovery path for this bug.
                 *
                 * Every page connected before the fix holds a USER id here, not
                 * a company id. Refusing those would mean the rightful company
                 * could never reconnect its own page — it would be told,
                 * permanently and incomprehensibly, that another company owns
                 * it. A stale uid binding was never serving anyone (its leads
                 * went to a tree no screen reads), so releasing it costs nothing
                 * and unblocks the owner.
                 *
                 * A binding to a real company is a different matter and stands.
                 */
                const holder = await transaction.get(db.collection('companies').doc(heldBy));
                if (holder.exists) {
                    return { refused: true };
                }
            }

            const claimFields = {
                companyId: companyId,
                pageName: pageName || 'Unknown Page',
                platform: 'facebook',
                claimPending: true,
            };
            if (isRebind) {
                // The previous holder's page token goes with the previous
                // holder. Leaving it in place would let a lead arriving during
                // the claim window be fetched with it and filed under the new
                // tenant. `processLead` skips a page with no token.
                claimFields.accessToken = admin.firestore.FieldValue.delete();
            }
            transaction.set(indexRef, claimFields, { merge: true });

            return { previous, reclaimedFrom: isRebind ? heldBy : null };
        });

        if (claim.refused) {
            // Thrown outside the try below on purpose: its catch would flatten
            // this into "Failed to connect Facebook Page." and leave the admin
            // with no idea why.
            throw new HttpsError(
                'already-exists',
                'This Facebook Page is already connected to another company. Disconnect it there first.',
            );
        }
        if (claim.reclaimedFrom) {
            console.log(
                `[connectFacebookPage] Page ${pageId} was bound to ${claim.reclaimedFrom}, which is not a `
                + `company (pre-2026-08-25 uid binding). Reclaiming it for ${companyId}.`,
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

            // 3. Complete the claim made above: same document, now with the
            //    token. A plain `.set()` (no merge) clears `claimPending` and
            //    leaves exactly the shape this document has always had. Nothing
            //    can have taken the page in between — the claim refuses every
            //    other company for as long as it stands.
            //    integrations_index/{pageId}
            await indexRef.set({
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
            // The claim was taken before Facebook was contacted, so a failure
            // here would otherwise leave the page locked to a company that is
            // not connected to it — and, on a rebind, would have thrown away the
            // previous holder's token for nothing.
            await releaseIncompleteClaim(indexRef, companyId, claim.previous);

            // A deliberate HttpsError carries a message the admin can act on.
            // Flattening it into the generic one below loses exactly the part
            // that tells them what to do.
            if (error instanceof HttpsError) throw error;
            console.error("Facebook Connection Error:", error.response?.data || error.message);
            throw new HttpsError('internal', 'Failed to connect Facebook Page.');
        }
    });

/**
 * Undo a claim that never became a connection.
 *
 * Only ever touches a document that is still the claim this call wrote:
 * `claimPending` set and `companyId` ours. If the connection completed, or
 * another attempt has since taken over, this leaves it alone.
 *
 * Restoring `previous` verbatim matters for the token-refresh path — a failed
 * refresh must give the company back the working connection it already had,
 * not delete it.
 *
 * Its own failure is logged and swallowed: the caller is already throwing, and
 * replacing the real reason with a cleanup error would help nobody.
 */
async function releaseIncompleteClaim(indexRef, companyId, previous) {
    try {
        await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(indexRef);
            if (!snapshot.exists) return;
            const current = snapshot.data();
            if (current.claimPending !== true || current.companyId !== companyId) return;
            if (previous) {
                transaction.set(indexRef, previous);
            } else {
                transaction.delete(indexRef);
            }
        });
    } catch (cleanupError) {
        console.error(
            `[connectFacebookPage] Failed to release the incomplete claim on ${indexRef.id}:`,
            cleanupError.message,
        );
    }
}

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

    // A page whose connection never finished holds a tenant but no token (see
    // the claim in `connectFacebookPage`). Without the token the lead cannot be
    // fetched at all, so say so once rather than failing inside the Graph call.
    if (!accessToken) {
        console.error(`Received lead for page ${page_id} with no stored access token; connection incomplete.`);
        return;
    }

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
