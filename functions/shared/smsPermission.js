// functions/shared/smsPermission.js
//
// Whether a text that no person presses Send for may go to a driver: the one
// rule the Contact Attempt SMS (`atsContactSms.js`), campaigns
// (`bulkActions/workers/sendLoop.js`) and the signing-link text
// (`notifySignerSMS.js`) share. A text a recruiter sends by hand is not one.
//
// - Consent. Page one of the application asks "Can we send you SMS messages?"
//   (`sms-consent`, 'yes' or 'no', optional). An application is texted
//   automatically only after an explicit "yes": "no" or no answer stops it.
//   Leads were never asked (the referral form alone writes 'yes'), so the
//   consent rule is for applications only.
// - Opt-out. A number on the company's or the global opt-out list
//   (`isBlacklisted`, `blacklist.js`) is not texted automatically.

const { isBlacklisted } = require('../blacklist');
const { normalizePhone } = require('./normalizePhone');

const SMS_CONSENT_FIELD = 'sms-consent';

/** Whether an application's driver answered "Yes" to the SMS question. */
function agreedToSms(application) {
    return String(application?.[SMS_CONSENT_FIELD] || '').trim().toLowerCase() === 'yes';
}

/**
 * Whether a number is on the company's or the global opt-out list. A number
 * that cannot be read has no opt-out to look up, so it is not on the list; the
 * sender decides what an unusable number means (`isBlacklisted` alone treats it
 * as blocked).
 */
async function onOptOutList(companyId, phone) {
    if (!normalizePhone(phone)) return false;
    return isBlacklisted(companyId, phone);
}

module.exports = { SMS_CONSENT_FIELD, agreedToSms, onOptOutList };
