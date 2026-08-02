const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');

const DOUBLE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const SINGLE_TOKEN_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeTokenKey(value) {
  return normalizeString(value).trim().toLowerCase();
}

function normalizeContextKey(value) {
  const source = normalizeString(value);
  const withSnake = source.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return withSnake
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatDateForPlaceholder(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
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

function buildPrefillContextFromApplication(application = {}, companyName = '') {
  const firstName = normalizeString(application.firstName).trim();
  const lastName = normalizeString(application.lastName).trim();
  const fullName = normalizeString(`${firstName} ${lastName}`).trim();
  const email = normalizeString(application.email).trim();
  const phone = normalizeString(application.phone || application.phoneNumber).trim();

  const context = {
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    name: fullName,
    email,
    phone,
    company_name: normalizeString(companyName).trim(),
    current_date: formatDateForPlaceholder(),
    date: formatDateForPlaceholder(),
    address: normalizeString(application.street).trim(),
    city: normalizeString(application.city).trim(),
    state: normalizeString(application.state).trim(),
    zip: normalizeString(application.zip).trim(),
    cdl_number: normalizeString(application.cdlNumber).trim(),
    cdl_expiration: normalizeString(application.cdlExpiration).trim(),
    dob: normalizeString(application.dob).trim(),
  };

  for (const [key, value] of Object.entries(application || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    const normalized = normalizeContextKey(key);
    if (!normalized) continue;
    context[normalized] = normalizeString(value).trim();
  }

  return context;
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

  const hasResolvedValue = isPresent(resolved.value);
  const readOnly = policy === 'locked' && hasResolvedValue;
  const shouldBlockMissingLockedRequired =
    Boolean(field.required) && policy === 'locked' && !hasResolvedValue;

  return {
    field: {
      ...field,
      defaultValue: resolved.value,
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

exports.createPostApplicationSigningRequest = onCall({ cors: true }, async (request) => {
  const {
    companyId,
    applicationId,
    confirmationNumber,
    templateId,
    appBaseUrl,
  } = request.data || {};

  if (!companyId || typeof companyId !== 'string') {
    throw new HttpsError('invalid-argument', 'companyId is required.');
  }
  if (!applicationId || typeof applicationId !== 'string') {
    throw new HttpsError('invalid-argument', 'applicationId is required.');
  }
  if (!confirmationNumber || typeof confirmationNumber !== 'string') {
    throw new HttpsError('invalid-argument', 'confirmationNumber is required.');
  }
  if (!templateId || typeof templateId !== 'string') {
    throw new HttpsError('invalid-argument', 'templateId is required.');
  }

  const clientIp = request.rawRequest?.ip || 'unknown_guest';
  const allowed = await checkRateLimit(`post_submit_doc_${clientIp}`, 10, 60, 'closed');
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Please wait a minute and try again.');
  }

  await assertCompanyAcceptingIntake(db, companyId);

  const publicProfileSnap = await db.collection('public_profiles').doc(companyId).get();
  const enabledTemplates = normalizePostSubmitTemplateConfig(
    publicProfileSnap.exists ? publicProfileSnap.data()?.postApplicationTemplates : []
  );
  const isEnabled = enabledTemplates.some(
    (item) => item.templateId === templateId && item.enabled !== false
  );
  if (!isEnabled) {
    throw new HttpsError('permission-denied', 'This follow-up document is not enabled.');
  }

  const appRef = db
    .collection('companies')
    .doc(companyId)
    .collection('applications')
    .doc(applicationId);
  const appSnap = await appRef.get();
  if (!appSnap.exists) {
    throw new HttpsError('not-found', 'Application not found.');
  }
  const application = appSnap.data() || {};
  if (normalizeString(application.confirmationNumber).trim() !== confirmationNumber.trim()) {
    throw new HttpsError('permission-denied', 'Application verification failed.');
  }

  const templateRef = db
    .collection('companies')
    .doc(companyId)
    .collection('templates')
    .doc(templateId);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) {
    throw new HttpsError('not-found', 'Template not found.');
  }
  const template = templateSnap.data() || {};
  const templateFields = Array.isArray(template.fields) ? template.fields : [];
  if (!template.storagePath || typeof template.storagePath !== 'string') {
    throw new HttpsError('failed-precondition', 'Template file is missing.');
  }

  const prefillContext = buildPrefillContextFromApplication(
    application,
    application.companyName || publicProfileSnap.data()?.companyName || ''
  );

  const missingLockedRequired = [];
  const resolvedFields = templateFields.map((field) => {
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

  const mintToken = () => (globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const buildExpiry = () => admin.firestore.Timestamp.fromMillis(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  );
  const baseUrl = normalizeString(appBaseUrl).trim() || 'https://app.safehaul.io';
  const recipientName = normalizeString(
    `${application.firstName || ''} ${application.lastName || ''}`
  ).trim();

  // Idempotency: one deterministic request per (application, template) pair.
  // Repeat clicks reuse the pending request (and its token) instead of piling
  // up duplicates, and a completed request short-circuits to alreadyCompleted.
  const requestRef = db
    .collection('companies')
    .doc(companyId)
    .collection('signing_requests')
    .doc(buildPostApplicationRequestId(applicationId, templateId));
  const tokenRef = requestRef.collection('secrets').doc('token');
  const requestTitle = normalizeString(template.title || 'Follow-up Document').trim();

  const outcome = await db.runTransaction(async (txn) => {
    const existingSnap = await txn.get(requestRef);

    if (existingSnap.exists) {
      const existing = existingSnap.data() || {};
      const status = normalizeString(existing.status).trim();

      if (COMPLETED_REQUEST_STATUSES.has(status)) {
        return { kind: 'completed', title: existing.title || requestTitle };
      }
      if (status === 'voided') {
        return { kind: 'voided' };
      }

      // Pending ('sent' / self-healing 'processing'): reuse. Re-mint the token
      // when it is missing or the link has expired; the confirmation-number
      // check above is the applicant's proof of identity for re-issue.
      const tokenSnap = await txn.get(tokenRef);
      const storedToken = tokenSnap.exists ? tokenSnap.data().accessToken : null;
      const isExpired = existing.expiresAt && existing.expiresAt.toMillis() < Date.now();

      if (storedToken && !isExpired) {
        return { kind: 'reused', accessToken: storedToken, title: existing.title || requestTitle };
      }

      const accessToken = mintToken();
      txn.update(requestRef, {
        status: 'sent',
        expiresAt: buildExpiry(),
        updatedAt: now,
      });
      txn.set(tokenRef, { accessToken });
      return { kind: 'reissued', accessToken, title: existing.title || requestTitle };
    }

    const accessToken = mintToken();
    const requestDoc = {
      companyId,
      templateId,
      source: 'post_application_success',
      sourceApplicationId: applicationId,
      sourceConfirmationNumber: confirmationNumber,
      title: requestTitle,
      status: 'sent',
      storagePath: template.storagePath,
      fields: resolvedFields,
      fieldValues: resolvedFields.reduce((acc, field) => {
        if (isPresent(field.defaultValue)) acc[field.id] = field.defaultValue;
        return acc;
      }, {}),
      recipientName: recipientName || null,
      recipientEmail: normalizeString(application.email).trim() || null,
      recipientPhone: normalizeString(application.phone || application.phoneNumber).trim() || null,
      sendEmail: false,
      sendSms: false,
      deliveryMethod: 'in_app_post_submit',
      appBaseUrl: baseUrl,
      senderName: 'SafeHaul Auto-Followup',
      senderId: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: buildExpiry(),
    };
    txn.set(requestRef, requestDoc);
    txn.set(tokenRef, { accessToken });
    return { kind: 'created', accessToken, title: requestTitle };
  });

  // Structured diagnostics for support — ids only, never tokens or PII.
  console.log(
    `[createPostApplicationSigningRequest] outcome=${outcome.kind} companyId=${companyId} templateId=${templateId} requestId=${requestRef.id}`
  );

  if (outcome.kind === 'voided') {
    throw new HttpsError(
      'failed-precondition',
      'This document is no longer available. Please contact the company for a new copy.'
    );
  }

  if (outcome.kind === 'completed') {
    return {
      success: true,
      requestId: requestRef.id,
      alreadyCompleted: true,
      title: outcome.title,
    };
  }

  return {
    success: true,
    requestId: requestRef.id,
    accessToken: outcome.accessToken,
    title: outcome.title,
  };
});

exports.__private = {
  normalizeContextKey,
  buildPrefillContextFromApplication,
  resolveFieldForPostSubmit,
  normalizePostSubmitTemplateConfig,
  buildPostApplicationRequestId,
};

