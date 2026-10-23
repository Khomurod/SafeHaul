/**
 * A driver referral link: `/apply/<slug>?ref=<code>`.
 *
 * The code travels in the answers as `referralCode`, so it stays with a draft
 * the driver continues later, and the server looks the link up itself; nothing
 * here decides who the driver is assigned to.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { email as emailRule, phone as phoneRule, required } from '@shared/utils/fieldValidators';
import { isWellFormedEmail } from '@shared/utils/validation';

/** The shape `newShortCode()` makes: 8 characters, no look-alike letters or digits. */
const REFERRAL_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** The code from the page address, or null when there is none or it is malformed. */
export function referralCodeFrom(searchParams) {
  const raw = (searchParams?.get?.('ref') || '').trim().toUpperCase();
  return REFERRAL_CODE.test(raw) ? raw : null;
}

/** Puts the link's code into the answers; called after any draft restore, so the link clicked wins. */
export function adoptReferralCode(searchParams, setFormData) {
  const code = referralCodeFrom(searchParams);
  if (code) setFormData((previous) => ({ ...previous, referralCode: code }));
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

export async function sendQuickInterest({ companyId, referralCode, answers }) {
  const send = httpsCallable(functions, 'submitReferralInterest');
  await send({
    companyId,
    referralCode,
    firstName: answers.firstName.trim(),
    lastName: answers.lastName.trim(),
    phone: answers.phone.trim(),
    email: answers.email.trim(),
    contactConsent: answers.contactConsent === true,
  });
}
