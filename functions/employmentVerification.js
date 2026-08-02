/**
 * Employment Verification Cloud Functions
 * =========================================
 * Implements FMCSA 49 CFR §391.23 compliant Previous Employment Verification (PEV)
 * with a secure, tokenized public response portal.
 *
 * Architecture:
 *  - Company admin triggers PEV → generates a unique token → stores verification_requests doc
 *  - Email is sent with a "Complete Verification Online" button linking to /verify/:token
 *  - Previous employer clicks link → lands on public React form (no login)
 *  - Form submission calls submitVerificationResponse → stores response, generates PDF, notifies carrier
 *  - Scheduled function sends automated reminders at 5/15/20/30 day intervals
 *
 * Implementation modules (one responsibility each; this file only aggregates):
 *  - ./employmentVerification/requests.js       — verification request creation
 *  - ./employmentVerification/portal.js         — public token portal reads + open tracking
 *  - ./employmentVerification/responses.js      — verification response processing
 *  - ./employmentVerification/reminders.js      — scheduled reminders / 30-day no-response
 *  - ./employmentVerification/emailTemplates.js — email HTML builders
 *  - ./employmentVerification/pdf.js            — DQ-file PDF generation
 *  - ./employmentVerification/notifications.js  — reminder + carrier notification senders
 */

exports.sendVerificationRequest = require('./employmentVerification/requests').sendVerificationRequest;
exports.getVerificationRequest = require('./employmentVerification/portal').getVerificationRequest;
exports.trackVerificationOpen = require('./employmentVerification/portal').trackVerificationOpen;
exports.submitVerificationResponse = require('./employmentVerification/responses').submitVerificationResponse;
exports.processVerificationReminders = require('./employmentVerification/reminders').processVerificationReminders;
