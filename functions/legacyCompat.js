const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { assertCompanyAdminStrict } = require("./shared/companyAccess");

async function assertSuperAdmin(request) {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    const roles = request.auth.token?.roles || {};
    const globalRole = request.auth.token?.globalRole || roles.globalRole;
    if (globalRole !== "super_admin") {
        throw new HttpsError("permission-denied", "Super admin access required.");
    }
}

exports.updateBulkSessionStatus = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    const { companyId, sessionId, status } = request.data || {};
    if (!companyId || !sessionId || !["paused", "active", "cancelled"].includes(status)) {
        throw new HttpsError("invalid-argument", "companyId, sessionId and valid status are required.");
    }

    await assertCompanyAdminStrict(request.auth.uid, companyId);
    const sessionRef = db.collection("companies").doc(companyId).collection("bulk_sessions").doc(sessionId);
    const payload = {
        status,
        updatedBy: request.auth.uid,
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (status === "active") {
        payload.workerGeneration = admin.firestore.FieldValue.increment(1);
    }
    await sessionRef.update(payload);
    return { success: true };
});

exports.backfillEmployerFields = onCall({ cors: true, timeoutSeconds: 540 }, async (request) => {
    await assertSuperAdmin(request);
    const dryRun = request.data?.dryRun !== false;
    const snapshot = await db.collectionGroup("applications").get();
    let totalDocs = 0;
    let updatedDocs = 0;
    let errorDocs = 0;

    for (const docSnap of snapshot.docs) {
        totalDocs++;
        try {
            const data = docSnap.data() || {};
            if (!Array.isArray(data.employers)) continue;
            let touched = false;
            const employers = data.employers.map((emp) => {
                if (!emp || typeof emp !== "object") return emp;
                const next = { ...emp };
                if (next.name && !next.companyName) {
                    next.companyName = next.name;
                    delete next.name;
                    touched = true;
                }
                if (next.street && !next.address) {
                    next.address = next.street;
                    delete next.street;
                    touched = true;
                }
                if (next.reason && !next.reasonForLeaving) {
                    next.reasonForLeaving = next.reason;
                    delete next.reason;
                    touched = true;
                }
                return next;
            });
            if (touched) {
                updatedDocs++;
                if (!dryRun) {
                    await docSnap.ref.update({ employers, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                }
            }
        } catch (err) {
            errorDocs++;
        }
    }

    return {
        success: true,
        message: dryRun ? "Dry run complete." : "Employer backfill complete.",
        stats: {
            totalDocs,
            updatedDocs,
            skippedDocs: Math.max(totalDocs - updatedDocs - errorDocs, 0),
            errorDocs,
        },
        processed: totalDocs,
        updated: updatedDocs,
        errors: errorDocs,
        dryRun,
    };
});

