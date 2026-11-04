const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { admin, db } = require('./firebaseAdmin');
const SMSAdapterFactory = require('./integrations/factory');
const BaseAdapter = require('./integrations/adapters/BaseAdapter');
const { parseAtsSmsTemplate } = require('./shared/atsSmsTemplate');
const { agreedToSms, onOptOutList } = require('./shared/smsPermission');
const { isAlreadyExists } = require('./shared/writeSubmissionSnapshot');
const { normalizePhone } = require('./utils/phoneUtils');

const CONTACT_ATTEMPT_STATUSES = ['Contact Attempt 1', 'Contact Attempt 2', 'Contact Attempt 3'];

const STATUS_TO_TEMPLATE_FIELD = {
  'Contact Attempt 1': 'templateContactAttempt1',
  'Contact Attempt 2': 'templateContactAttempt2',
  'Contact Attempt 3': 'templateContactAttempt3',
};

function driverDisplayName(data) {
  if (!data) return '';
  const full = (data.fullName || '').trim();
  if (full) return full;
  const first = data.firstName || '';
  const last = data.lastName || '';
  return `${first} ${last}`.trim();
}

/**
 * Returns true only when `status` transitions into a contact-attempt stage (idempotent / no-op otherwise).
 */
function shouldFireContactAttemptSms(beforeData, afterData) {
  const prev = beforeData?.status;
  const next = afterData?.status;
  if (prev === next) return false;
  return CONTACT_ATTEMPT_STATUSES.includes(next);
}

function templateFieldForStatus(status) {
  return STATUS_TO_TEMPLATE_FIELD[status] || null;
}

function automatedSmsEntry(companyId, status, outcome, detail) {
  return {
    action: 'Automated SMS',
    details: `Automatic ${status} text ${detail}.`,
    type: 'system',
    smsOutcome: outcome,
    companyId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * The record's activity log entry for one automatic text, in plain words and
 * without the message, the number or the provider's error. One entry per event:
 * Firestore delivers an event at least once, sometimes twice at the same time.
 *
 * `claim()` writes the entry before the SMS provider is called, so only the run
 * that wrote it may send; a repeated run finds it and sends nothing, even when
 * the first run stopped before recording a result (an unconfirmed text is never
 * sent again). `settle()` then records the outcome. An outcome that sends
 * nothing is written once with `record()`, and a log that cannot be written
 * never stops the trigger.
 */
function automatedSmsLog({ recordRef, eventId, companyId, status }) {
  const logs = recordRef ? recordRef.collection('activity_logs') : null;
  const ref = logs ? (eventId ? logs.doc(`auto_sms_${eventId}`) : logs.doc()) : null;
  let claimed = false;
  return {
    async record(outcome, detail) {
      if (!ref) return;
      try {
        await ref.create(automatedSmsEntry(companyId, status, outcome, detail));
      } catch (err) {
        if (isAlreadyExists(err)) return;
        console.error('[atsContactSms] Could not record the automatic text in the activity log:', err.message || err);
      }
    },
    /** Whether this run may call the SMS provider. */
    async claim() {
      if (!ref) return true;
      try {
        await ref.create(automatedSmsEntry(companyId, status, 'sending', 'was being sent; no result was recorded'));
        claimed = true;
        return true;
      } catch (err) {
        if (isAlreadyExists(err)) {
          console.log(`[atsContactSms] ${status} SMS for this change was already handled; not sent again (company ${companyId})`);
        } else {
          console.error('[atsContactSms] Could not record the automatic text, so it was not sent:', err.message || err);
        }
        return false;
      }
    },
    async settle(outcome, detail) {
      if (!claimed) return this.record(outcome, detail);
      try {
        await ref.update(automatedSmsEntry(companyId, status, outcome, detail));
      } catch (err) {
        console.error('[atsContactSms] Could not record the automatic text in the activity log:', err.message || err);
      }
    },
  };
}

/**
 * Texts a record that moved into a Contact Attempt stage the company's message
 * for that stage, and records the outcome in its activity log. An application
 * (any `recordType` but 'lead') is texted only after its driver's explicit "Yes"
 * to SMS; a lead was never asked. A number on the opt-out list is not texted.
 */
async function sendContactAttemptSmsIfNeeded({ companyId, beforeData, afterData, recordType, recordRef, eventId }) {
  if (!shouldFireContactAttemptSms(beforeData, afterData)) return;

  const status = afterData.status;
  const templateField = templateFieldForStatus(status);
  if (!templateField) return;

  const settingsSnap = await db
    .collection('companies')
    .doc(companyId)
    .collection('settings')
    .doc('automated_sms')
    .get();

  const rawTemplate = (settingsSnap.exists && settingsSnap.data()?.[templateField]) || '';
  if (!String(rawTemplate).trim()) {
    console.log(`[atsContactSms] No template configured for ${status} (company ${companyId})`);
    return;
  }

  const driverName = driverDisplayName(afterData);
  // The assignee's name only while the record has an assignee: unassigning in
  // the dossier once stored "Unassigned" as the name.
  const userName =
    (afterData.assignedTo && afterData.assignedToName) ||
    afterData.lastModifiedByName ||
    'Your recruiter';

  const body = parseAtsSmsTemplate(rawTemplate, { driverName, userName });
  if (!body.trim()) return;

  const log = automatedSmsLog({ recordRef, eventId, companyId, status });

  if (recordType !== 'lead' && !agreedToSms(afterData)) {
    console.log(`[atsContactSms] ${status} SMS not sent: the driver did not agree to SMS (company ${companyId})`);
    return log.record('skipped_no_consent', 'not sent: the driver did not agree to SMS');
  }

  const rawPhone = afterData.phoneNormalized || afterData.phone || '';
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    console.warn('[atsContactSms] Missing or invalid phone; skipping SMS');
    return log.record('skipped_no_phone', 'not sent: there is no usable phone number');
  }

  if (!(await log.claim())) return;

  const senderUserId = afterData.assignedTo || null;
  try {
    // A failed opt-out lookup sends nothing: it is recorded as a failed text.
    if (await onOptOutList(companyId, phone)) {
      console.log(`[atsContactSms] ${status} SMS not sent: the number opted out (company ${companyId})`);
      return log.settle('skipped_opt_out', 'not sent: this number opted out of texts');
    }
    const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, senderUserId);
    await adapter.sendSMS(phone, body, senderUserId);
  } catch (err) {
    console.error('[atsContactSms] Failed to send SMS:', err.message || err);
    return log.settle('failed', err?.code === BaseAdapter.SEND_UNCONFIRMED
      ? 'may have gone out: the SMS provider did not answer, so it was not sent again'
      : 'failed to send');
  }
  console.log(`[atsContactSms] Sent ${status} SMS for company ${companyId}`);
  return log.settle('sent', 'sent');
}

// secrets: this trigger decrypts the company's SMS credentials/JWT (via SMSAdapterFactory)
// to send automated contact-attempt texts. Without SMS_ENCRYPTION_KEY bound, decryption throws
// and the automated SMS never sends.
const triggerOpts = { maxInstances: 3, secrets: ['SMS_ENCRYPTION_KEY'] };

/** The trigger's handler for one collection's records. */
const contactAttemptHandler = (recordType) => async (event) => {
  await sendContactAttemptSmsIfNeeded({
    companyId: event.params.companyId,
    beforeData: event.data.before.data() || {},
    afterData: event.data.after.data(),
    recordType,
    recordRef: event.data.after.ref,
    eventId: event.id,
  });
};

exports.onApplicationAtsContactSms = onDocumentUpdated(
  {
    ...triggerOpts,
    document: 'companies/{companyId}/applications/{applicationId}',
  },
  contactAttemptHandler('application')
);

exports.onLeadAtsContactSms = onDocumentUpdated(
  {
    ...triggerOpts,
    document: 'companies/{companyId}/leads/{leadId}',
  },
  contactAttemptHandler('lead')
);

exports.shouldFireContactAttemptSms = shouldFireContactAttemptSms;
exports.templateFieldForStatus = templateFieldForStatus;
exports.sendContactAttemptSmsIfNeeded = sendContactAttemptSmsIfNeeded;
