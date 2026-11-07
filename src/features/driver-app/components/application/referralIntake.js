/**
 * The codes an apply link carries, and the driver referral link's quick form.
 *
 * A driver referral link is `/apply/<slug>?ref=<code>`; a recruiter's personal
 * link is `/apply/<slug>?r=<code>` (a `recruiter_links` code), or
 * `?recruiter=<uid>` from older links. Each code travels in the answers, as
 * `referralCode` and `recruiterCode`, so it stays with a draft the driver
 * continues later — in another session, from a continuation link or on another
 * device — and the submission sends it from there. The link clicked last wins:
 * every restore puts the address's codes back over the ones a draft saved. The
 * server looks each code up itself; nothing here decides who the driver is
 * assigned to.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { email as emailRule, phone as phoneRule, required } from '@shared/utils/fieldValidators';
import { isWellFormedEmail } from '@shared/utils/validation';

/** The shape `newShortCode()` makes: 8 characters, no look-alike letters or digits. */
const REFERRAL_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** What the server takes as a recruiter code (`functions/shared/recruiterAssignment.js`). */
const RECRUITER_CODE = /^[A-Za-z0-9_-]{1,128}$/;

/** The code from the page address, or null when there is none or it is malformed. */
export function referralCodeFrom(searchParams) {
  const raw = (searchParams?.get?.('ref') || '').trim().toUpperCase();
  return REFERRAL_CODE.test(raw) ? raw : null;
}

/** A recruiter's code from the page address (`r`, else `recruiter`), or null when there is none or it is malformed. */
export function recruiterCodeFrom(searchParams) {
  const raw = (searchParams?.get?.('r') || searchParams?.get?.('recruiter') || '').trim();
  return RECRUITER_CODE.test(raw) ? raw : null;
}

/** No link codes, as one object, so a hook given none gains no new dependency each render. */
export const NO_LINK_CODES = Object.freeze({});

/** The codes the page address carries, as answers: only those present and well formed. */
export function linkCodesFrom(searchParams) {
  const referralCode = referralCodeFrom(searchParams);
  const recruiterCode = recruiterCodeFrom(searchParams);
  return { ...(referralCode && { referralCode }), ...(recruiterCode && { recruiterCode }) };
}

/** Whether the answers already hold every code in `codes`. */
export const holdsLinkCodes = (answers, codes) => Object.entries(codes || {})
  .every(([key, code]) => answers?.[key] === code);

/** Puts the link's codes into the answers; called after any draft restore, so the link clicked wins. */
export function adoptLinkCodes(searchParams, setFormData) {
  const codes = linkCodesFrom(searchParams);
  if (Object.keys(codes).length > 0) setFormData((previous) => ({ ...previous, ...codes }));
}

/** What the driver agrees to. The same words as `consentText` in `functions/referrals/submitReferralInterest.js`. */
export function referralConsentText(companyName) {
  return `I agree that ${companyName} may contact me by phone call, text message (SMS) and email about driving jobs. `
    + 'Message and data rates may apply. Reply STOP to opt out.';
}

const requiredEmail = emailRule('Email');

/** The callable's own rule (`functions/shared/isValidEmail.js`), so it refuses nothing the form let through. */
const email = (value) => requiredEmail(value)
  || (isWellFormedEmail(String(value).trim()) ? null : 'Please enter a valid email address.');

const CHECKS = Object.freeze({
  firstName: required('First name'),
  lastName: required('Last name'),
  phone: phoneRule('Phone'),
  email,
});

/** The quick form's problems by field; empty when it can be sent. */
export function findQuickInterestGaps(answers) {
  const gaps = {};
  for (const [name, check] of Object.entries(CHECKS)) {
    const problem = check(answers?.[name]);
    if (problem) gaps[name] = problem;
  }
  if (answers?.contactConsent !== true) gaps.contactConsent = 'Please agree to be contacted so a recruiter can reach you.';
  return gaps;
}

/** The server's own words for a refusal it explains; anything else is a plain retry message. */
export function quickInterestErrorMessage(error) {
  const code = String(error?.code || '');
  if ((code.endsWith('invalid-argument') || code.endsWith('resource-exhausted') || code.endsWith('failed-precondition'))
    && error?.message) {
    return error.message;
  }
  return 'We could not send your details. Please check your connection and try again.';
}

/** The four answers the quick form sends, as sent. Its consent is not among them. */
export function quickInterestContact(answers) {
  return {
    firstName: String(answers?.firstName || '').trim(),
    lastName: String(answers?.lastName || '').trim(),
    phone: String(answers?.phone || '').trim(),
    email: String(answers?.email || '').trim(),
  };
}

export async function sendQuickInterest({ companyId, referralCode, answers }) {
  const send = httpsCallable(functions, 'submitReferralInterest');
  await send({
    companyId,
    referralCode,
    ...quickInterestContact(answers),
    contactConsent: answers.contactConsent === true,
  });
}

/**
 * The application's answers with the quick form's four filled in where page one
 * is still empty: the driver typed them a moment ago and is not asked twice.
 *
 * Only those four keys, which page one uses under the same names. Nothing else the
 * quick form holds comes across: its consent to be contacted is not the
 * application's SMS answer or any of its agreements. An answer already there — a
 * restored copy of an earlier application — is kept, so a saved draft wins.
 */
export function prefillFromQuickInterest(previous, contact) {
  const filled = quickInterestContact(contact);
  let next = previous;
  for (const [key, value] of Object.entries(filled)) {
    const current = previous?.[key];
    if (!value || (typeof current === 'string' ? current.trim() : current)) continue;
    next = { ...next, [key]: value };
  }
  return next;
}
