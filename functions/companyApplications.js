/**
 * Driver applications a carrier starts on the driver's behalf.
 *
 * ## The problem
 *
 * A recruiter often has a driver's paperwork — licence, medical card, PSP report,
 * motor vehicle record — before the driver has typed anything. Until now the only
 * way into an application was the driver's own nine-page wizard, so all of that
 * was retyped by the person least likely to have the documents in front of them.
 *
 * ## The shape of the fix
 *
 * The carrier prepares the application as a *draft* (`saveCompanyPreparedApplication`),
 * reads it back to proofread it (`getCompanyPreparedDraft`), tracks what it has
 * started (`listCompanyPreparedApplications`), and sends the driver a link. The
 * driver completes, reviews and signs it through the same public wizard and the
 * same `submitGuestApplication` as anyone else — nothing about consent, agreements,
 * the immutable snapshot or the preserved PDF changes.
 *
 * See `./shared/companyPreparedDraft.js` for why a prepared application is a draft
 * and not an application, who may read its answers and until when, and why locked
 * employers are recorded beside the form data rather than inside it.
 */

// The handlers live in `companyApplications/`, split by what they do. This module
// is the deployment surface and nothing else — `index.js` reads these names off
// it, so **the export names here are the contract** and a rename is a redeployment.
const { saveCompanyPreparedApplication } = require('./companyApplications/prepare');
const { getCompanyPreparedDraft, listCompanyPreparedApplications } = require('./companyApplications/read');
const { mintApplicationInvite, exchangeApplicationInvite } = require('./companyApplications/invite');

exports.saveCompanyPreparedApplication = saveCompanyPreparedApplication;
exports.getCompanyPreparedDraft = getCompanyPreparedDraft;
exports.listCompanyPreparedApplications = listCompanyPreparedApplications;
exports.mintApplicationInvite = mintApplicationInvite;
exports.exchangeApplicationInvite = exchangeApplicationInvite;
