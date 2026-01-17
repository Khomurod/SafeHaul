const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
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

        const { shortLivedUserToken, pageId, pageName } = request.data;
        const companyId = request.auth.uid; // Assumes 1:1 user-company mapping for simplicity, or get from custom claims

        if (!shortLivedUserToken || !pageId) {
            throw new HttpsError('invalid-argument', 'Missing token or page ID.');
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
            // integrations_index/{pageId}
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
    { secrets: [FACEBOOK_APP_SECRET, FACEBOOK_VERIFY_TOKEN] },
    async (req, res) => {
        const APP_SECRET = FACEBOOK_APP_SECRET.value();
        const VERIFY_TOKEN_VALUE = FACEBOOK_VERIFY_TOKEN.value() || 'safehaul_verify_123';

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
            if (APP_SECRET) {
                const signature = req.headers['x-hub-signature'];
                if (!signature) {
                    console.warn("Missing X-Hub-Signature");
                    // return res.sendStatus(401); // Optional: Enforcement
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
        firstName: '',
        lastName: '',
        phone: '',
        email: '',
        source: 'Facebook Ads',
        isPlatformLead: false, // It's a company lead
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
