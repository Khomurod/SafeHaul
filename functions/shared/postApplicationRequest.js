/**
 * postApplicationRequest.js — one of the company's post-application forms, made
 * into a signing request for one application.
 *
 * Two callables make it: the driver's thank-you page
 * (`createPostApplicationSigningRequest`, `postApplicationEdocs.js`) and a team
 * member's Send to driver (`sendPostApplicationDocument.js`). Both address the
 * same document, `postapp_<application>_<template>`, and build it here, so
 * whichever comes first, the other finds it and none is made twice. Who sends
 * it and how (`build(delivery)`) is each caller's.
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { admin } = require('../firebaseAdmin');
const {
  SIGNING_DATE_KEY,
  SIGNING_DATE_PLACEHOLDER,
  resolveSignedDateValue,
} = require('./signedDate');
const { companySignatureImagePath, isCompanySignatureField } = require('./companySignature');

const DOUBLE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const SINGLE_TOKEN_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

/** A new or re-issued link works seven days, as every signing link does. */
const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeTokenKey(value) {
  return normalizeString(value).trim().toLowerCase();
}

function formatDateForPlaceholder(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * A follow-up document is created the moment an application is submitted and may
 * be signed days later, so the signing date is NOT resolved here. It travels as
 * a sentinel through both token passes — a brace-free string, because re-emitting
 * `{{current_date}}` in the double pass would leave `{current_date}` for the
 * single-brace pass to eat — and is restored to the canonical placeholder
 * afterwards. `submitPublicEnvelope` stamps it with the real signing date.
 */
const DEFERRED_SIGNING_DATE = '\u0000signed_date\u0000';

function restoreDeferredSigningDate(text) {
  return normalizeString(text).split(DEFERRED_SIGNING_DATE).join(SIGNING_DATE_PLACEHOLDER);
}

function normalizePrefillPolicy(field = {}) {
  if (field.prefillPolicy === 'locked') return 'locked';
  if (field.prefillPolicy === 'editable') return 'editable';
  return field.readOnly ? 'locked' : 'editable';
}

function isPresent(value) {
  return value !== null && value !== undefined && normalizeString(value).trim() !== '';
}

function replaceTokens(template, context) {
  let text = normalizeString(template);
  const unresolved = new Set();

  DOUBLE_TOKEN_PATTERN.lastIndex = 0;
  text = text.replace(DOUBLE_TOKEN_PATTERN, (_, tokenKey) => {
    const key = normalizeTokenKey(tokenKey);
    const mapped = context[key];
    if (!isPresent(mapped)) {
      unresolved.add(key);
      return '';
    }
    return normalizeString(mapped);
  });

  SINGLE_TOKEN_PATTERN.lastIndex = 0;
  text = text.replace(SINGLE_TOKEN_PATTERN, (_, tokenKey) => {
    const key = normalizeTokenKey(tokenKey);
    const mapped = context[key];
    if (!isPresent(mapped)) {
      unresolved.add(key);
      return '';
    }
    return normalizeString(mapped);
  });

  return {
    value: text,
    unresolvedTokens: [...unresolved],
  };
}

/**
 * The application fields a template token may name: token → application field.
 * Nothing else reaches a document. A follow-up document is sealed and the whole
 * team reads it, so the SSN, the signature, the consents, ids, links and file
 * paths never become tokens; `{{ssn}}` resolves to nothing, like any unknown
 * token. Covers every binding the editor offers (`shared/edocFieldSemantics.js`).
 */
const APPLICATION_TOKEN_FIELDS = Object.freeze({
  first_name: 'firstName',
  middle_name: 'middleName',
  last_name: 'lastName',
  suffix: 'suffix',
  email: 'email',
  address: 'street',
  street: 'street',
  city: 'city',
  state: 'state',
  zip: 'zip',
  dob: 'dob',
  cdl_number: 'cdlNumber',
  cdl_state: 'cdlState',
  cdl_class: 'cdlClass',
  cdl_expiration: 'cdlExpiration',
  med_card_expiration: 'medCardExpiration',
});

const scalarText = (value) => (
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
);

function buildPrefillContextFromApplication(application = {}, companyName = '') {
  const source = application || {};
  const context = {};
  for (const [token, field] of Object.entries(APPLICATION_TOKEN_FIELDS)) {
    context[token] = scalarText(source[field]);
  }
  const fullName = `${context.first_name} ${context.last_name}`.trim();

  return {
    ...context,
    full_name: fullName,
    name: fullName,
    phone: scalarText(source.phone) || scalarText(source.phoneNumber),
    company_name: normalizeString(companyName).trim(),
    date: formatDateForPlaceholder(),
    // Stamped when the driver signs (`submitPublicEnvelope`), not now.
    [SIGNING_DATE_KEY]: DEFERRED_SIGNING_DATE,
  };
}

function resolveFieldForPostSubmit(field = {}, context = {}) {
  const policy = normalizePrefillPolicy(field);
  const templateText = normalizeString(field.defaultValue);
  const bindingKey = normalizeTokenKey(field.bindingKey || '');
  let resolved = replaceTokens(templateText, context);

  if (!templateText && bindingKey && isPresent(context[bindingKey])) {
    resolved = {
      value: normalizeString(context[bindingKey]),
      unresolvedTokens: [],
    };
  }

  const resolvedValue = restoreDeferredSigningDate(resolved.value);
  const hasResolvedValue = isPresent(resolvedValue);
  const readOnly = policy === 'locked' && hasResolvedValue;
  const shouldBlockMissingLockedRequired =
    Boolean(field.required) && policy === 'locked' && !hasResolvedValue;

  return {
    field: {
      ...field,
      defaultValue: resolvedValue,
      readOnly,
      prefillPolicy: policy,
    },
    meta: {
      hasResolvedValue,
      unresolvedTokens: resolved.unresolvedTokens,
      shouldBlockMissingLockedRequired,
    },
  };
}

function normalizePostSubmitTemplateConfig(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (typeof item === 'string') {
        const templateId = item.trim();
        if (!templateId) return null;
        // Legacy string entries predate the required flag: default REQUIRED.
        return { templateId, enabled: true, required: true, title: '', order: index };
      }
      if (!item || typeof item !== 'object') return null;
      const templateId = normalizeString(item.templateId || item.id).trim();
      if (!templateId) return null;
      return {
        templateId,
        enabled: item.enabled !== false,
        // Backward compatible: entries without an explicit required flag are
        // REQUIRED; companies must explicitly mark a form optional.
        required: item.required !== false,
        title: normalizeString(item.title).trim(),
        order: typeof item.order === 'number' ? item.order : index,
      };
    })
    .filter(Boolean);
}

/** Whether `templateId` is an enabled form of a company's post-application list (`raw`). */
function isPostApplicationForm(raw, templateId) {
  return normalizePostSubmitTemplateConfig(raw).some(
    (item) => item.templateId === templateId && item.enabled !== false
  );
}

/**
 * Deterministic signing-request id for a (application, template) pair. Repeat
 * clicks — including across page reloads and devices — address the SAME
 * document, which is what makes createPostApplicationSigningRequest idempotent.
 */
function buildPostApplicationRequestId(applicationId, templateId) {
  return `postapp_${applicationId}_${templateId}`;
}

/** Signing-request statuses that mean the applicant has already submitted. */
const COMPLETED_REQUEST_STATUSES = new Set([
  'pending_seal',
  'signed',
  'sealed',
  'completed',
  'error_sealing', // applicant DID submit; sealing retry is a company-side concern
]);

/** The request for (application, template) and its token document. */
function postApplicationRequestRefs(db, companyId, applicationId, templateId) {
  const requestRef = db
    .collection('companies')
    .doc(companyId)
    .collection('signing_requests')
    .doc(buildPostApplicationRequestId(applicationId, templateId));
  return { requestRef, tokenRef: requestRef.collection('secrets').doc('token') };
}

function mintAccessToken() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function linkExpiry() {
  return admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_MS);
}

/** A template's fields filled from the application; refuses one the driver could not sign as it stands. */
function resolveTemplateFields(companyId, template, prefillContext) {
  const templateFields = Array.isArray(template.fields) ? template.fields : [];
  const missingLockedRequired = [];
  const missingCompanySignatures = [];
  const resolvedFields = templateFields.map((field) => {
    // The company's image as placed on the template: nothing to prefill, and no
    // later step where someone could add it to this document.
    if (isCompanySignatureField(field)) {
      if (!companySignatureImagePath(companyId, field)) {
        missingCompanySignatures.push(field.label || field.id || 'Company Signature');
      }
      return { ...field };
    }
    const resolved = resolveFieldForPostSubmit(field, prefillContext);
    if (resolved.meta.shouldBlockMissingLockedRequired) {
      missingLockedRequired.push(field.label || field.id || 'Unnamed field');
    }
    return resolved.field;
  });

  if (missingLockedRequired.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `Template has locked required fields missing prefill values: ${missingLockedRequired.join(', ')}`
    );
  }
  if (missingCompanySignatures.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `Template has a company signature with no image: ${missingCompanySignatures.join(', ')}`
    );
  }
  return resolvedFields;
}

/**
 * Reads template `templateId` and fills it from `application`, refusing (and
 * writing nothing) a missing template, one without its file, a locked required
 * field the application cannot fill or a company signature without its image.
 * Returns the request's `title` and `build(delivery)`: the new request, with
 * the caller's `delivery` (source, send flags, sender) laid over it.
 */
async function preparePostApplicationRequest(db, {
  companyId, applicationId, templateId, application, companyName, appBaseUrl,
}) {
  const templateSnap = await db
    .collection('companies')
    .doc(companyId)
    .collection('templates')
    .doc(templateId)
    .get();
  if (!templateSnap.exists) {
    throw new HttpsError('not-found', 'Template not found.');
  }
  const template = templateSnap.data() || {};
  if (!template.storagePath || typeof template.storagePath !== 'string') {
    throw new HttpsError('failed-precondition', 'Template file is missing.');
  }

  const resolvedFields = resolveTemplateFields(
    companyId,
    template,
    buildPrefillContextFromApplication(application, companyName)
  );
  const title = normalizeString(template.title || 'Follow-up Document').trim();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const recipientName = normalizeString(
    `${application.firstName || ''} ${application.lastName || ''}`
  ).trim();

  const build = (delivery) => ({
    companyId,
    templateId,
    sourceApplicationId: applicationId,
    title,
    status: 'sent',
    storagePath: template.storagePath,
    fields: resolvedFields,
    // A Date Signed field has no value yet — it is stamped when the signer
    // submits — so it is deliberately absent here rather than seeded with its
    // own unresolved placeholder.
    fieldValues: resolvedFields.reduce((acc, field) => {
      if (!isCompanySignatureField(field) && isPresent(field.defaultValue) && resolveSignedDateValue(field) === null) {
        acc[field.id] = field.defaultValue;
      }
      return acc;
    }, {}),
    recipientName: recipientName || null,
    recipientEmail: normalizeString(application.email).trim() || null,
    recipientPhone: normalizeString(application.phone || application.phoneNumber).trim() || null,
    appBaseUrl: normalizeString(appBaseUrl).trim() || 'https://app.safehaul.io',
    createdAt: now,
    updatedAt: now,
    expiresAt: linkExpiry(),
    ...delivery,
  });

  return { title, build };
}

module.exports = {
  APPLICATION_TOKEN_FIELDS,
  COMPLETED_REQUEST_STATUSES,
  buildPostApplicationRequestId,
  buildPrefillContextFromApplication,
  isPostApplicationForm,
  linkExpiry,
  mintAccessToken,
  normalizePostSubmitTemplateConfig,
  normalizeString,
  postApplicationRequestRefs,
  preparePostApplicationRequest,
  resolveFieldForPostSubmit,
};
