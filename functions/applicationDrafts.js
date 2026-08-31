/**
 * Autosave, resume and start-over for an in-progress driver application.
 *
 * ## The problem
 *
 * Nothing existed server-side until an applicant pressed Submit on the ninth
 * page. A driver filling the form on a phone at a truck stop who lost signal, or
 * closed the tab, or hit a failing CDL scan, lost everything they had typed —
 * while the licence and medical-card images they had already uploaded sat in
 * Cloud Storage connected to nobody.
 *
 * ## The shape of the fix
 *
 * `saveApplicationProgress` after each successful Next, into a server-only
 * subcollection keyed by the **existing** deterministic applicant key. Two
 * further callables let a returning applicant find and restore that draft, and a
 * fourth discards it deliberately.
 *
 * See `./shared/applicationDraft.js` for why drafts do not live in
 * `applications` (four triggers, one of which emails the applicant to say their
 * application was received) and why no Social Security Number is stored.
 *
 * ## Why resuming is two callables, not one
 *
 * `findResumableApplication` answers only "is there something to continue?" and
 * `resumeApplicationDraft` exchanges a token for the data. Splitting them means
 * the answer to a *matching* attempt carries no application data at all, so a
 * wrong guess learns nothing beyond a boolean — and that boolean is identical
 * whether nothing exists or something exists and the guess did not match it.
 *
 * ## What a resume actually requires
 *
 * The applicant's last name, date of birth and Social Security Number — combined
 * into a keyed HMAC, never stored raw — **and** an email or phone that the stored
 * draft already holds. Knowing three facts about a person is not enough; the bar
 * is three facts plus one of their contact details. Both halves are rate-limited
 * fail-closed, per caller and per identity, and every attempt is audited without
 * recording what was attempted.
 *
 * App Check is deliberately absent from this project (it broke real drivers'
 * uploads in production), so these guards are the compensating controls, in the
 * same spirit as the rest of the guest intake surface.
 */

// The handlers live in `drafts/`, split by what they do to a draft: identify,
// save, resume, list. This module is the deployment surface and nothing else —
// `index.js` reads these names off it, so **the export names here are the
// contract** and a rename is a redeployment.
const { LIMITS, NO_MATCH } = require('./drafts/runtime');
const {
    applicantKeyOf, docId, findByToken, supersedeOtherDrafts, text,
} = require('./drafts/identity');
const { saveApplicationProgress } = require('./drafts/save');
const {
    findResumableApplication, resumeApplicationDraft, startNewApplication,
} = require('./drafts/resume');
const { listApplicationDrafts } = require('./drafts/list');

exports.saveApplicationProgress = saveApplicationProgress;
exports.findResumableApplication = findResumableApplication;
exports.resumeApplicationDraft = resumeApplicationDraft;
exports.startNewApplication = startNewApplication;
exports.listApplicationDrafts = listApplicationDrafts;

exports.__private = {
    LIMITS, NO_MATCH, findByToken, supersedeOtherDrafts, text, docId, applicantKeyOf,
};
