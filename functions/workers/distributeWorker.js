// functions/workers/distributeWorker.js
const { onRequest } = require("firebase-functions/v2/https");
const { db } = require("../firebaseAdmin");
const { dealLeadsToCompany } = require("../leadLogic");
const { OAuth2Client } = require("google-auth-library");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'truckerapp-system';
const EXPECTED_SERVICE_ACCOUNT = `${PROJECT_ID}@appspot.gserviceaccount.com`;
const oauthClient = new OAuth2Client();

/**
 * Verifies the OIDC token from Cloud Tasks.
 * Returns the verified ticket on success, or null on failure.
 */
async function verifyOIDCToken(authHeader, expectedAudience) {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.split("Bearer ")[1];
    try {
        const ticket = await oauthClient.verifyIdToken({
            idToken: token,
            audience: expectedAudience,
        });
        const payload = ticket.getPayload();
        // Ensure the token was issued for the expected service account
        if (payload.email !== EXPECTED_SERVICE_ACCOUNT) {
            console.warn(`[distributeWorker] OIDC email mismatch: got ${payload.email}, expected ${EXPECTED_SERVICE_ACCOUNT}`);
            return null;
        }
        return payload;
    } catch (err) {
        console.warn(`[distributeWorker] OIDC verification failed: ${err.message}`);
        return null;
    }
}

/**
 * Worker function triggered by Cloud Tasks.
 * Processes lead distribution for a single company.
 */
exports.processCompanyDistribution = onRequest(
    {
        timeoutSeconds: 540,
        memory: "1GiB",
        region: "us-central1",
        secrets: ["SMS_ENCRYPTION_KEY"]
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).send("Method Not Allowed");
        }

        // --- SECURITY: Multi-layer authentication ---
        const isEmulator = !!process.env.FUNCTIONS_EMULATOR;

        if (!isEmulator) {
            // Layer 1 (Primary): Verify OIDC token signature + audience + service account
            const functionUrl = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/processCompanyDistribution`;
            const oidcPayload = await verifyOIDCToken(req.headers.authorization, functionUrl);

            if (oidcPayload) {
                // OIDC verified — this is a legitimate Cloud Task
                // console.log("[distributeWorker] OIDC verified:", oidcPayload.email);
            } else {
                // Layer 2 (Fallback): Check Cloud Tasks headers
                // Google Cloud automatically strips these from external requests
                const hasQueueHeader = req.headers["x-appengine-queuename"] || req.headers["x-cloudtasks-queuename"];
                if (!hasQueueHeader) {
                    console.error("[distributeWorker] Access Forbidden: No valid OIDC token and no Cloud Tasks headers.");
                    return res.status(403).send("Forbidden: internal-only");
                }
                console.warn("[distributeWorker] OIDC verification failed, but Cloud Tasks headers are present. Allowing request.");
            }
        }

        const { companyId, quotaOverride, forceRotate } = req.body;

        if (!companyId) {
            console.error("Missing companyId in request body");
            return res.status(400).send("Missing companyId");
        }

        try {
            // Fetch company data fresh to ensure we have latest settings
            const companySnap = await db.collection("companies").doc(companyId).get();

            if (!companySnap.exists) {
                console.log(`Company ${companyId} not found, skipping.`);
                return res.status(200).send("Company not found");
            }

            const company = { id: companySnap.id, ...companySnap.data() };

            // Run the existing logic for THIS company only
            const result = await dealLeadsToCompany(company, quotaOverride, forceRotate);

            console.log(`Worker Success [${company.companyName}]:`, result);
            res.status(200).json({ success: true, result });
        } catch (error) {
            console.error(`Worker Failed [${companyId}]:`, error);
            res.status(500).send(error.message);
        }
    }
);
