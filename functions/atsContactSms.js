const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { db } = require('./firebaseAdmin');
const SMSAdapterFactory = require('./integrations/factory');
const { parseAtsSmsTemplate } = require('./shared/atsSmsTemplate');
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

async function sendContactAttemptSmsIfNeeded({ companyId, beforeData, afterData }) {
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
  const userName =
    afterData.assignedToName ||
    afterData.lastModifiedByName ||
    'Your recruiter';

  const body = parseAtsSmsTemplate(rawTemplate, { driverName, userName });
  if (!body.trim()) return;

  const rawPhone = afterData.phoneNormalized || afterData.phone || '';
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    console.warn('[atsContactSms] Missing or invalid phone; skipping SMS');
    return;
  }

  const senderUserId = afterData.assignedTo || null;
  try {
    const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, senderUserId);
    await adapter.sendSMS(phone, body, senderUserId);
    console.log(`[atsContactSms] Sent ${status} SMS for company ${companyId}`);
  } catch (err) {
    console.error('[atsContactSms] Failed to send SMS:', err.message || err);
  }
}

// secrets: this trigger decrypts the company's SMS credentials/JWT (via SMSAdapterFactory)
// to send automated contact-attempt texts. Without SMS_ENCRYPTION_KEY bound, decryption throws
// and the automated SMS never sends.
const triggerOpts = { maxInstances: 3, secrets: ['SMS_ENCRYPTION_KEY'] };

exports.onApplicationAtsContactSms = onDocumentUpdated(
  {
    ...triggerOpts,
    document: 'companies/{companyId}/applications/{applicationId}',
  },
  async (event) => {
    const beforeData = event.data.before.data() || {};
    const afterData = event.data.after.data();
    const companyId = event.params.companyId;
    await sendContactAttemptSmsIfNeeded({ companyId, beforeData, afterData });
  }
);

exports.onLeadAtsContactSms = onDocumentUpdated(
  {
    ...triggerOpts,
    document: 'companies/{companyId}/leads/{leadId}',
  },
  async (event) => {
    const beforeData = event.data.before.data() || {};
    const afterData = event.data.after.data();
    const companyId = event.params.companyId;
    await sendContactAttemptSmsIfNeeded({ companyId, beforeData, afterData });
  }
);

exports.shouldFireContactAttemptSms = shouldFireContactAttemptSms;
exports.templateFieldForStatus = templateFieldForStatus;
exports.sendContactAttemptSmsIfNeeded = sendContactAttemptSmsIfNeeded;
