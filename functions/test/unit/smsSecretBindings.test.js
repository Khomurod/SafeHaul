const fs = require('fs');
const path = require('path');

/**
 * Guard: every Cloud Function that decrypts SMS provider credentials / JWTs (or SMTP
 * passwords) at runtime MUST bind the SMS_ENCRYPTION_KEY secret, or process.env
 * .SMS_ENCRYPTION_KEY is undefined inside that function and decrypt() throws
 * "SMS_ENCRYPTION_KEY ... is not set" -> sends silently fail.
 *
 * This is exactly how bulk campaigns broke: processBulkBatch (and the automated
 * contact-attempt SMS trigger) decrypted credentials but never bound the secret, while
 * the config/test-send functions did -- so Super Admin showed the line as working while
 * actual campaign sends failed at adapter init.
 */
const ROOT = path.resolve(__dirname, '../..');

// Function-defining files that load the SMS adapter and/or decrypt() and therefore need
// the secret bound on their trigger options.
const SENDER_FILES = [
    'bulkActions/workers/batchWorker.js',     // processBulkBatch (bulk SMS + email campaigns)
    'atsContactSms.js',                        // automated contact-attempt SMS triggers
    'integrations/services/smsService.js',     // sendTestSMS / sendSMS
    // configController.js was split by concern; each function-defining file must
    // bind the secret on its own onCall options.
    'integrations/controllers/config/providerConfigController.js',  // save / verify provider config
    'integrations/controllers/config/lineConnectionController.js',  // test / verify line connection
    'integrations/controllers/config/lineInventoryController.js',   // add / remove line
    'integrations/controllers/config/lineAssignmentsController.js', // recruiter line assignments
    'notifySignerSMS.js',                      // e-doc signer SMS
    'resendSignerOnCorrection.js',             // e-doc signer SMS after a correction
    // Super Admin Environment & Integrations vault: reveals decrypt stored
    // company credentials, and the inventory reports whether the Secret
    // Manager-backed keys are configured. Without the binding every one of
    // those rows would report "missing", which looks like an outage.
    'environmentVault/index.js',
];

// Every function that reads a company's stored SMTP password (shared/smtpSettings.js),
// to send through emailService.js or to verify it. A password stored encrypted
// (`enc:v1:`) is decrypted in the calling function, so each binds the secret on
// its own trigger options: without it the decrypt throws and nothing is sent.
const SMTP_PASSWORD_READERS = [
    ['notifySigner.js', 'notifySigner'],                                         // signing-request email
    ['resendSignerOnCorrection.js', 'resendSignerOnCorrection'],                 // the same, after a correction
    ['companyAdmin.js', 'sendAutomatedEmail'],                                   // the "no answer" email
    ['notificationTriggers.js', 'onNewApplicationEmailConfirmation'],            // the applicant's confirmation
    ['employmentVerification/requests.js', 'sendVerificationRequest'],           // the PEV request
    ['employmentVerification/responses.js', 'submitVerificationResponse'],       // "verification complete" to the carrier
    ['employmentVerification/reminders.js', 'processVerificationReminders'],     // PEV reminders and "no response"
    ['saveEmailSettings.js', 'saveEmailSettings'],                               // verifies the settings it saves
];

/** The text from `exports.<name> =` to the function's handler: its options, in every SDK form. */
function definitionHead(src, name) {
    const start = src.indexOf(`exports.${name} =`);
    return start === -1 ? null : src.slice(start, src.indexOf('async', start));
}

describe('SMS_ENCRYPTION_KEY secret bindings', () => {
    test.each(SMTP_PASSWORD_READERS)('%s: %s binds SMS_ENCRYPTION_KEY on its own options', (rel, name) => {
        const head = definitionHead(fs.readFileSync(path.join(ROOT, rel), 'utf8'), name);
        expect(head).not.toBeNull();
        expect(head).toMatch(/secrets:\s*\[[^\]]*['"]SMS_ENCRYPTION_KEY['"]/);
    });

    test.each(SENDER_FILES)('%s binds SMS_ENCRYPTION_KEY', (rel) => {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        expect(src).toMatch(/secrets:\s*\[[^\]]*['"]SMS_ENCRYPTION_KEY['"]/);
    });

    it('processBulkBatch declares the secret on its onRequest options (regression for broken campaigns)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'bulkActions/workers/batchWorker.js'), 'utf8');
        // The secret must be on the same onRequest({...}) options object that defines the worker.
        const m = src.match(/onRequest\(\s*\{([^}]*)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/SMS_ENCRYPTION_KEY/);
    });

    it('atsContactSms triggers declare the secret', () => {
        const src = fs.readFileSync(path.join(ROOT, 'atsContactSms.js'), 'utf8');
        const m = src.match(/triggerOpts\s*=\s*\{([^}]*)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/SMS_ENCRYPTION_KEY/);
    });
});
