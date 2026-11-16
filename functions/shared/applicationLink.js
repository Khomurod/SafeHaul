/**
 * The application link a message gives a driver: `[Application Link]` in a
 * campaign (`bulkActions/workers/sendLoop.js`), `{application link}` in an
 * automated contact text (`atsContactSms.js`).
 *
 * It is `<base>/apply/<appSlug>?r=<code>`, where `code` is the recruiter link
 * (`recruiter_links/{code}`, made on the recruiter's profile page) that the
 * record's assignee has for this company, so the application it brings is
 * theirs (`recruiterAssignment.js`); the plain apply page when the record has
 * no assignee or the assignee no link here. The base is the company's
 * `appUrl`, else https://app.safehaul.io, as in the verification emails. Only
 * the company's slug and the link code are in it, nothing about the driver.
 */

const DEFAULT_APP_URL = 'https://app.safehaul.io';
const CODE = /^[A-Za-z0-9_-]{1,128}$/;

function applyBaseUrl(company) {
    const url = typeof company?.appUrl === 'string' ? company.appUrl.trim().replace(/\/+$/, '') : '';
    return /^https?:\/\/\S+$/i.test(url) ? url : DEFAULT_APP_URL;
}

/** The company's apply page, with the recruiter's `?r=` code when there is one. */
function applyUrl(company, companyId, code) {
    const page = `${applyBaseUrl(company)}/apply/${encodeURIComponent(company?.appSlug || companyId)}`;
    return code ? `${page}?r=${encodeURIComponent(code)}` : page;
}

/** The recruiter's link code for this company, or null. */
async function recruiterLinkCode(db, companyId, userId) {
    const snap = await db.collection('recruiter_links')
        .where('companyId', '==', companyId)
        .where('userId', '==', userId)
        .limit(1)
        .get();
    const code = snap.empty ? null : snap.docs[0].id;
    return code && CODE.test(code) ? code : null;
}

/**
 * `linkFor(assignedTo)`: the link for a record with that assignee. Each
 * recruiter is looked up once for as long as the function is kept (a batch, an
 * event); a failed lookup gives the plain apply page.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} companyId
 * @param {object} company the company document's data
 * @returns {(assignedTo: unknown) => Promise<string>}
 */
function applicationLinks(db, companyId, company) {
    const codes = new Map();
    return async (assignedTo) => {
        const userId = typeof assignedTo === 'string' ? assignedTo.trim() : '';
        if (!userId) return applyUrl(company, companyId, null);
        if (!codes.has(userId)) {
            codes.set(userId, (async () => recruiterLinkCode(db, companyId, userId))().catch((err) => {
                console.warn(`[applicationLink] Could not read a recruiter link in ${companyId}; the plain apply link is used:`, err.message);
                return null;
            }));
        }
        return applyUrl(company, companyId, await codes.get(userId));
    };
}

module.exports = { applicationLinks, applyUrl };
