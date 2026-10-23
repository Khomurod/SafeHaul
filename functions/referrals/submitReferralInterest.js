/**
 * The quick interest form a referred driver fills in: first and last name,
 * phone, email, and consent to be contacted.
 *
 * It creates a lead, the way a Facebook lead arrives, with the referral and the
 * link creator as the assignee, and tells the creator. A driver already known
 * to the company, as a lead or an application with the same phone or email,
 * gets no second record: the referral is added to the one there if it has
 * none. The answer is the same either way, so the form cannot be used to learn
 * who is in a company's records.
 */
const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const { admin, db } = require('../firebaseAdmin');
const { assertCompanyAcceptingIntake } = require('../shared/companyTenant');
const { checkRateLimit } = require('../shared/rateLimiter');
const { trustedClientIp } = require('../shared/clientIp');
const { normalizePhone } = require('../shared/normalizePhone');
const { normalizeSearchPhone } = require('../shared/searchNormalization');
const { isValidEmail } = require('../shared/isValidEmail');
const { createNotification } = require('../shared/createNotification');
const { resolveReferralLink } = require('./referralLinks');

const { HttpsError } = functions.https;
const NAME_MAX = 80;

/** What the driver agrees to, in the server's words: the page shows the same. */
function consentText(companyName) {
    return `I agree that ${companyName} may contact me by phone call, text message (SMS) and email about driving jobs. `
        + 'Message and data rates may apply. Reply STOP to opt out.';
}

function nameOf(value, label) {
    const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (!text) throw new HttpsError('invalid-argument', `Please enter your ${label}.`);
    if (text.length > NAME_MAX) throw new HttpsError('invalid-argument', `Your ${label} is too long.`);
    return text;
}

/** The answers, checked; refuses the first one that is missing or malformed. */
function readAnswers(data) {
    const firstName = nameOf(data.firstName, 'first name');
    const lastName = nameOf(data.lastName, 'last name');
    const normalizedPhone = normalizeSearchPhone(data.phone);
    if (normalizedPhone.length !== 10) throw new HttpsError('invalid-argument', 'Please enter a 10-digit phone number.');
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email address.');
    if (data.contactConsent !== true) {
        throw new HttpsError('invalid-argument', 'Please agree to be contacted so a recruiter can reach you.');
    }
    return { firstName, lastName, phone: normalizePhone(normalizedPhone), normalizedPhone, email };
}

/** A lead or an application this company already has for the driver, or null. */
async function existingRecord(company, answers) {
    const [leadByPhone, leadByEmail, appByPhone, appByEmail] = await Promise.all([
        company.collection('leads').where('normalizedPhone', '==', answers.normalizedPhone).limit(1).get(),
        company.collection('leads').where('email', '==', answers.email).limit(1).get(),
        company.collection('applications').where('phoneNormalized', '==', answers.normalizedPhone).limit(1).get(),
        company.collection('applications').where('emailNormalized', '==', answers.email).limit(1).get(),
    ]);
    const found = [leadByPhone, leadByEmail, appByPhone, appByEmail].find((snap) => !snap.empty);
    return found ? found.docs[0].ref : null;
}

/** Adds the referral to a record that has none, with a line in its activity log, in one commit. */
async function attachReferral(ref, link, companyId) {
    const logRef = ref.collection('activity_logs').doc();
    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists || snap.data()?.referral) return;
        transaction.update(ref, { referral: link.referral, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        transaction.set(logRef, {
            action: 'Referral',
            details: `Referred again through the link of ${link.referral.referrerName || 'a driver'} (${link.referral.code}), by the quick interest form.`,
            type: 'system',
            companyId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
}

/**
 * The quick form's lead for a phone number in a company. One id per number, so
 * two forms sent at once for the same driver meet on one document instead of
 * making two leads; the number itself is not in the id.
 */
function quickFormLeadId(companyId, normalizedPhone) {
    return `referral_${crypto.createHash('sha256').update(`${companyId}:${normalizedPhone}`).digest('hex').slice(0, 24)}`;
}

exports.submitReferralInterest = functions
    .runWith({ memory: '256MB', timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        const clientIp = trustedClientIp(context.rawRequest);
        if (!(await checkRateLimit(`referral_interest_${clientIp}`, 5, 60, 'closed'))) {
            throw new HttpsError('resource-exhausted', 'Too many tries. Please wait a minute and try again.');
        }

        const payload = data && typeof data === 'object' ? data : {};
        const answers = readAnswers(payload);
        const companyId = typeof payload.companyId === 'string' ? payload.companyId : '';
        const companyData = await assertCompanyAcceptingIntake(db, companyId);
        const companyName = companyData.companyName || 'this company';
        const link = await resolveReferralLink(db, companyId, payload.referralCode);
        const company = db.collection('companies').doc(companyId);

        const existing = await existingRecord(company, answers);
        if (existing) {
            if (link) await attachReferral(existing, link, companyId);
            return { ok: true };
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const leadRef = company.collection('leads').doc(quickFormLeadId(companyId, answers.normalizedPhone));
        const created = await db.runTransaction(async (transaction) => {
            if ((await transaction.get(leadRef)).exists) return false;
            transaction.set(leadRef, {
                companyId,
                firstName: answers.firstName,
                lastName: answers.lastName,
                phone: answers.phone,
                normalizedPhone: answers.normalizedPhone,
                email: answers.email,
                source: 'Driver Referral',
                status: 'New Lead',
                assignedTo: link?.assignedTo || '',
                assignedToName: link?.assignedToName || '',
                ...(link && { referral: link.referral }),
                contactConsent: { text: consentText(companyName), at: now, ip: clientIp },
                'sms-consent': 'yes',
                createdAt: now,
                updatedAt: now,
            });
            return true;
        });
        if (!created) {
            // Another form for this driver got there first: it is the record.
            if (link) await attachReferral(leadRef, link, companyId);
            return { ok: true };
        }

        if (link?.assignedTo) {
            try {
                await createNotification(db, companyId, {
                    type: 'referral_lead',
                    title: 'New referral',
                    message: `${answers.firstName} ${answers.lastName} was referred by ${link.referral.referrerName || 'a driver'}`,
                    recipientId: link.assignedTo,
                    relatedType: 'lead',
                    relatedId: leadRef.id,
                });
            } catch (error) {
                console.error(`[submitReferralInterest] Notification failed for lead ${leadRef.id}: ${error?.message || error}`);
            }
        }
        return { ok: true };
    });

exports.consentText = consentText;
exports.quickFormLeadId = quickFormLeadId;
