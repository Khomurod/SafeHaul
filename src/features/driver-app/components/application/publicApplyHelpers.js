/**
 * Pure helpers for the public (guest) application flow.
 * Extracted verbatim from PublicApplyHandler.jsx — behavior unchanged.
 */

import { GATE_DEFAULT_REQUIRED, resolveApplicationGate } from '@/config/applicationGates';

/**
 * Resolve a company application gate.
 *
 * Delegates to the single gate resolver so every wizard step, this handler and
 * the server-side validator apply the same defaults and the same legacy-key
 * aliases. `defaultRequired` is honoured only for keys that are not declared
 * gates, which keeps ad-hoc callers working.
 */
export const getFieldConfig = (applicationConfig, fieldId, defaultRequired = true) => {
  if (Object.prototype.hasOwnProperty.call(GATE_DEFAULT_REQUIRED, fieldId)) {
    const gate = resolveApplicationGate(applicationConfig, fieldId);
    return { hidden: gate.hidden, required: gate.required };
  }
  const config = applicationConfig?.[fieldId];
  return {
    hidden: Boolean(config?.hidden),
    required: config !== undefined ? Boolean(config.required) : defaultRequired
  };
};

export const hasUploadedFile = (value) => {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') {
    return Boolean(value.url || value.storagePath || value.name);
  }
  return false;
};

export const AUTO_FILL_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export const normalizePostApplicationTemplates = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (typeof item === 'string') {
        const templateId = item.trim();
        if (!templateId) return null;
        // Legacy string entries predate the required flag: default REQUIRED.
        return { templateId, title: 'Complete Form', enabled: true, required: true, order: index };
      }
      if (!item || typeof item !== 'object') return null;
      const templateId = String(item.templateId || item.id || '').trim();
      if (!templateId) return null;
      return {
        templateId,
        title: String(item.title || 'Complete Form').trim(),
        enabled: item.enabled !== false,
        // Backward compatible: templates without an explicit required flag are
        // REQUIRED; companies must explicitly mark a form optional.
        required: item.required !== false,
        order: typeof item.order === 'number' ? item.order : index,
      };
    })
    .filter((item) => item && item.enabled !== false)
    .sort((a, b) => a.order - b.order);
};

/**
 * Map a createPostApplicationSigningRequest failure to a safe, actionable
 * applicant-facing message. Callable HttpsError codes arrive as
 * "functions/<code>" from the web SDK.
 */
export const buildPostApplyDocErrorMessage = (error) => {
  const code = String(error?.code || '');
  if (code.includes('resource-exhausted')) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (code.includes('not-found')) {
    return 'This document is not available right now. Please contact the company or try again later.';
  }
  if (code.includes('permission-denied')) {
    return 'We could not verify your application for this document. Please refresh the page and try again.';
  }
  if (code.includes('failed-precondition')) {
    return error?.message || 'This document is not ready to be signed yet. Please contact the company.';
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('internal')) {
    return 'We hit a network problem while opening the document. Please try again.';
  }
  return error?.message || 'Could not open this form. Please try again.';
};

/**
 * What to tell a driver whose carrier link would not open, and whether trying
 * again is worth their time.
 *
 * Built on the same vocabulary as `buildPostApplyDocErrorMessage` above, because
 * it is the same job on a neighbouring surface — the machinery existed and the
 * invite path simply was not using it. Until 2026-09-08 every failure resolved to
 * `null` and the driver was dropped into the ordinary application with nothing
 * said, so a rate-limited exchange, a Firestore hiccup (the limiter fails closed)
 * and a temporary outage were indistinguishable from having followed no link at
 * all.
 *
 * `unopenable` is deliberately one message for wrong, expired, already-submitted,
 * superseded and discarded. The server answers all of them identically on purpose
 * — "that link expired" and "that link is wrong" are different facts an attacker
 * would happily learn — and saying the same thing here is what keeps that promise
 * on this side of the wire. Nothing below reveals whether an application exists,
 * whose it is, or who prepared it.
 *
 * `retryable` is not cosmetic. A silent fall-through never stamps
 * `inviteClaimedAt`, so the carrier's locked employers go unenforced and it
 * receives a second, unprepared application — losing the 49 CFR 391.21 employment
 * history it had prepared. When the cause is transient, retrying is what prevents
 * that duplicate, so retry leads for those cases and continuing leads for the
 * ones that will never succeed.
 *
 * @returns {{message: string, retryable: boolean}|null} null when there is
 *   nothing to say — no link was followed, or one opened.
 */
export const buildApplyLinkOutcomeMessage = (outcome) => {
  switch (outcome?.status) {
    case 'unopenable':
      return {
        message: 'This application link cannot be opened. It may have expired, or a newer link may have '
          + 'replaced it. Ask the company to send you a new one.',
        retryable: false,
      };
    case 'invalid':
      return { message: 'That application link is not valid.', retryable: false };
    case 'throttled':
      // The frozen sentence from the post-application document flow, verbatim.
      return { message: 'Too many attempts. Please wait a minute and try again.', retryable: true };
    case 'closed':
      return {
        message: outcome.message
          || 'This company is not accepting applications right now. Please contact them directly.',
        retryable: true,
      };
    case 'unavailable':
      return {
        message: 'We hit a network problem opening your application link. Please try again.',
        retryable: true,
      };
    default:
      // `absent`, `opened`, `requires_identity` and `pending`. The first two have
      // nothing to report; `requires_identity` is not a failure — the driver is
      // asked for their details by the ordinary resume flow underneath.
      return null;
  }
};

export const parseIsoFromLooseDate = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mdY = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdY) {
    const m = Number(mdY[1]);
    const d = Number(mdY[2]);
    let y = Number(mdY[3]);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const written = new Date(text);
  if (!Number.isNaN(written.getTime())) {
    const y = written.getFullYear();
    const m = written.getMonth() + 1;
    const d = written.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return '';
};

export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read file.'));
  reader.readAsDataURL(file);
});

export const buildE2EPublicProfile = (slugValue) => ({
  id: 'e2e-company',
  companyName: 'E2E Logistics',
  appSlug: slugValue || 'e2e-company',
  customQuestions: [],
  applicationConfig: {
    cdlUpload: { hidden: false, required: true },
    medCardUpload: { hidden: false, required: true },
    showEmergencyContacts: false,
  },
  postApplicationTemplates: [
    {
      // No explicit `required` flag: exercises the backward-compat default
      // (configured post-application templates are required unless the company
      // explicitly marks them optional).
      templateId: 'e2e-post-template',
      title: 'Post-Application Form',
      enabled: true,
    },
    {
      templateId: 'e2e-post-template-2',
      title: 'Direct Deposit Form',
      enabled: true,
      required: true,
    },
    {
      templateId: 'e2e-post-template-optional',
      title: 'Optional Survey',
      enabled: true,
      required: false,
    },
  ],
});
