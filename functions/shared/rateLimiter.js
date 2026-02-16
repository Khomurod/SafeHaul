const { admin, db } = require("../firebaseAdmin");

/**
 * TOKEN BUCKET RATE LIMITER
 * @param {string} key - Unique identifier (IP, UserID, or specific ActionID)
 * @param {number} limit - Max requests allowed in the window
 * @param {number} windowSeconds - Time window in seconds
 * @returns {Promise<boolean>} - True if allowed, False if limit exceeded
 */
const checkRateLimit = async (key, limit, windowSeconds) => {
    const now = admin.firestore.Timestamp.now();
    const docRef = db.collection('rate_limits').doc(key);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            let data = doc.data();

            if (!doc.exists) {
                // First request
                t.set(docRef, {
                    count: 1,
                    windowStart: now,
                    expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + (windowSeconds * 1000))
                });
                return true;
            }

            // Check window expiration
            const windowEnd = data.windowStart.toMillis() + (windowSeconds * 1000);

            if (now.toMillis() > windowEnd) {
                // New Window
                t.set(docRef, {
                    count: 1,
                    windowStart: now,
                    expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + (windowSeconds * 1000))
                });
                return true;
            }

            if (data.count >= limit) {
                throw new Error("RATE_LIMIT_EXCEEDED");
            }

            // Increment
            t.update(docRef, {
                count: admin.firestore.FieldValue.increment(1)
            });
        });

        return true;
    } catch (e) {
        if (e.message === "RATE_LIMIT_EXCEEDED") return false;
        console.error("Rate Limiter Error:", e);
        return true; // Fail open to avoid blocking legitimate users on system error
    }
};

module.exports = { checkRateLimit };
