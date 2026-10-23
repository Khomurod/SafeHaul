/**
 * A driver's referral link: `companies/{companyId}/referral_links/{code}`, made by
 * a member of the company's team for a driver who sends others to apply.
 *
 * The link lives under its company, readable by that team only, so the
 * referring driver's name and phone are never public. The public pages carry
 * only the code; the server looks it up here.
 */
const { teamMemberName } = require('../shared/recruiterAssignment');

/** 8 characters, the alphabet the page draws from (no look-alikes). */
const REFERRAL_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/**
 * The active link a code names in this company, with who the lead or
 * application goes to: its creator, while they are on the team.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} companyId
 * @param {unknown} code
 * @returns {Promise<null | {
 *   referral: { code: string, referrerName: string },
 *   assignedTo: string, assignedToName: string,
 * }>} `assignedTo` is `''` when the creator has left the team
 */
async function resolveReferralLink(db, companyId, code) {
    const value = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!companyId || !REFERRAL_CODE.test(value)) return null;

    const snap = await db.collection('companies').doc(companyId).collection('referral_links').doc(value).get();
    if (!snap.exists) return null;
    const link = snap.data() || {};
    if (link.active !== true || link.companyId !== companyId) return null;

    const referral = { code: value, referrerName: String(link.referrerName || '').trim() };
    const name = await teamMemberName(db, companyId, link.createdBy);
    return name === null
        ? { referral, assignedTo: '', assignedToName: '' }
        : { referral, assignedTo: link.createdBy, assignedToName: name };
}

module.exports = { REFERRAL_CODE, resolveReferralLink };
