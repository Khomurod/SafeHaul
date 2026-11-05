/**
 * autoSendPostApplicationForms.js — the automatic send after submission: a
 * driver who left the thank-you page without dealing with the company's
 * required post-application forms gets them anyway, by the rules of a team
 * member's Send to driver (`shared/postApplicationSend.js`).
 *
 * Every 15 minutes, per company with E-Docs on (`features.eDocs !== false`),
 * not deactivated, and with at least one required, enabled form
 * (`postApplicationTemplates`): the applications a driver submitted through the
 * public form (`lifecycle.processedViaFunction`, which only
 * `submitGuestApplication` writes) 30 minutes to 2 hours ago (`submittedAt`,
 * the server's time of the first submission; oldest first, on Firestore's own
 * single-field index). The first 30 minutes leave a driver still on the
 * thank-you page alone; the end bounds the work. Each required form then goes
 * as Send to driver sends it: no request yet, it is made and the creation
 * triggers send it; one the thank-you page made and the driver did not sign
 * gets its flags turned on and the correction trigger sends it; one signed,
 * voided, being submitted or already sent is left alone.
 *
 * Once per form: a request whose link was already sent where the driver can be
 * reached answers `already-sent` and nothing is written, so every later run in
 * the window finds it so. The decision is one transaction, so two runs at once
 * (or a run and Send to driver) make one message: the second finds what the
 * first wrote. Nothing is marked on the application.
 *
 * The sender is the company (`senderName`, the email's "Requested by" and the
 * text's sender) and the system (`senderId: 'system:post-application'`), which
 * the bell reads as nobody: a signed form tells the application's recruiter
 * (`sealNotifications.js`). A request it makes has `source:
 * 'post_application_auto'`. No usable email and no "Yes" to texts: skipped and
 * logged, and looked at again by the next run in the window. A run stops
 * starting sends after `RUN_BUDGET_MS`; the rest go on the next run.
 *
 * Logs carry ids, counts and reasons only, never tokens, addresses or numbers.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { isCompanyDeactivated } = require('./shared/companyTenant');
const { normalizePostSubmitTemplateConfig } = require('./shared/postApplicationRequest');
const { sendPostApplicationForm } = require('./shared/postApplicationSend');

const MINUTE_MS = 60 * 1000;

/** How long after submission a form is sent, in minutes. */
const WINDOW_MINUTES = Object.freeze({ from: 30, to: 120 });

/** Who the request names as its sender (`senderId`): not a user. */
const AUTO_SENDER_ID = 'system:post-application';

/** What a request this job makes says made it (`source`). */
const AUTO_SOURCE = 'post_application_auto';

/** How long one run starts sends, inside its 300-second timeout. */
const RUN_BUDGET_MS = 4 * MINUTE_MS;

const LOG = '[autoSendPostApplicationForms]';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The company's forms that are sent: required and switched on. */
function requiredForms(company) {
    return normalizePostSubmitTemplateConfig(company.postApplicationTemplates)
        .filter((form) => form.enabled && form.required);
}

/** Whether an application came through the public form, whose thank-you page offers the forms. */
const submittedOnPublicForm = (application) => application.lifecycle?.processedViaFunction === true;

const skip = (counts, why) => { counts.skipped[why] = (counts.skipped[why] || 0) + 1; };

/** Sends one form of one application, and counts and logs how it went. */
async function sendForm({ companyId, company, applicationId, application, templateId }, counts) {
    const ids = `companyId=${companyId} applicationId=${applicationId} templateId=${templateId}`;
    try {
        const outcome = await sendPostApplicationForm(db, {
            companyId,
            applicationId,
            templateId,
            application,
            companyName: application.companyName || company.companyName || '',
            sender: {
                senderId: AUTO_SENDER_ID,
                senderName: text(company.companyName) || text(application.companyName) || 'Your Employer',
            },
            source: AUTO_SOURCE,
        });
        if (outcome.kind === 'sent') {
            counts.sent += 1;
            console.log(`${LOG} ${ids} requestId=${outcome.requestId} outcome=sent email=${Boolean(outcome.email)} sms=${Boolean(outcome.sms)}`);
            return;
        }
        skip(counts, outcome.kind);
        if (outcome.kind === 'no-channel') console.log(`${LOG} ${ids} outcome=no-channel`);
    } catch (error) {
        // A template the application cannot fill is the company's to fix, not a failure of the run.
        if (error instanceof HttpsError) {
            skip(counts, 'form-not-ready');
            console.warn(`${LOG} ${ids} outcome=form-not-ready (${error.code})`);
            return;
        }
        counts.errors += 1;
        console.error(`${LOG} ${ids} not sent: ${error?.code ?? 'error'}`);
    }
}

/** Sends a company's required forms to its applications in the window; false once the run is out of time. */
async function sendCompany(companyId, company, forms, now, stopAt, counts) {
    const due = await db.collection('companies').doc(companyId).collection('applications')
        .where('submittedAt', '>=', admin.firestore.Timestamp.fromMillis(now - WINDOW_MINUTES.to * MINUTE_MS))
        .where('submittedAt', '<=', admin.firestore.Timestamp.fromMillis(now - WINDOW_MINUTES.from * MINUTE_MS))
        // Oldest first: a run out of time leaves the newest, which stay in the window longest.
        .orderBy('submittedAt', 'asc')
        .get();

    for (const doc of due.docs) {
        const application = doc.data() || {};
        // A record the team made, or one written outside the public form: no thank-you page offered it the forms.
        if (!submittedOnPublicForm(application)) continue;
        counts.applications += 1;
        for (const form of forms) {
            if (Date.now() >= stopAt) return false;
            await sendForm({ companyId, company, applicationId: doc.id, application, templateId: form.templateId }, counts);
        }
    }
    return true;
}

exports.autoSendPostApplicationForms = onSchedule({
    schedule: 'every 15 minutes',
    region: 'us-central1',
    timeoutSeconds: 300,
}, async () => {
    const now = Date.now();
    const stopAt = now + RUN_BUDGET_MS;
    const counts = { companies: 0, applications: 0, sent: 0, errors: 0, skipped: {} };
    let finished = true;

    const companies = await db.collection('companies')
        .select('features', 'isActive', 'status', 'postApplicationTemplates', 'companyName')
        .get();
    for (const company of companies.docs) {
        const data = company.data() || {};
        if (data.features?.eDocs === false || isCompanyDeactivated(data)) continue;
        const forms = requiredForms(data);
        if (!forms.length) continue;
        counts.companies += 1;
        try {
            finished = await sendCompany(company.id, data, forms, now, stopAt, counts);
        } catch (error) {
            counts.errors += 1;
            console.error(`${LOG} companyId=${company.id} applications not read: ${error?.code ?? 'error'}`);
        }
        if (!finished) break;
    }

    const skipped = Object.entries(counts.skipped).map(([why, count]) => `${why}=${count}`).join(' ') || 'none';
    console.log(`${LOG} companies=${counts.companies} applications=${counts.applications} sent=${counts.sent} errors=${counts.errors}`
        + ` skipped: ${skipped}${finished ? '' : '; out of time, the next run sends the rest'}`);
});

exports.AUTO_SENDER_ID = AUTO_SENDER_ID;
exports.AUTO_SOURCE = AUTO_SOURCE;
