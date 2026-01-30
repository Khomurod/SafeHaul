// functions/workers/distributeWorker.js
const { onRequest } = require("firebase-functions/v2/https");
const { db } = require("../firebaseAdmin");
const { dealLeadsToCompany } = require("../leadLogic");

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
        // 1. Security: Only allow Cloud Tasks to call this
        // Cloud Tasks automatically adds these headers
        const hasQueueHeader = req.headers["x-appengine-queuename"] || req.headers["x-cloudtasks-queuename"];
        if (!hasQueueHeader && !process.env.FUNCTIONS_EMULATOR) {
            console.error("Access Forbidden: Missing Queue Header");
            return res.status(403).send("Forbidden");
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
