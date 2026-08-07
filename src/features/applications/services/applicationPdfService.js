// src/features/applications/services/applicationPdfService.js
//
// Fetches the PRESERVED original application PDF.
//
// WHAT THIS REPLACES
// ------------------
// `@shared/utils/pdfGenerator`, which built the "official" PDF in the browser
// with jsPDF, from whatever the application document happened to say at that
// moment, and called `doc.save()`. Nothing about it was an original: it read
// mutable data, carried its own copy of the legal text, printed custom-question
// ids as labels, stamped one signature onto all four agreement pages, and
// invented accident figures nobody had been asked for. Two downloads a month
// apart could legitimately differ.
//
// The document is now rendered once on the server from the frozen submission
// record and stored. This module asks for the stored bytes. It cannot render, it
// cannot fall back to rendering, and there is deliberately no second code path:
// if no preserved original exists, the caller is told so.

import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/** Raised when the application predates preserved originals. */
export class NoPreservedPdfError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NoPreservedPdfError';
    }
}

/**
 * Resolve a short-lived download link for a preserved application PDF.
 *
 * Every call is authorized and audited server-side: this document may carry the
 * applicant's full Social Security Number, and there is no unaudited path to it.
 *
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string} opts.applicationId
 * @param {string} [opts.snapshotId] Defaults to the ORIGINAL (`v1`).
 * @returns {Promise<{url: string, fileName: string, isOriginal: boolean}>}
 */
export async function fetchPreservedApplicationPdf({ companyId, applicationId, snapshotId }) {
    if (!companyId || !applicationId) {
        throw new Error('A company and an application are required.');
    }

    const callable = httpsCallable(functions, 'getApplicationOriginalPdfUrl');
    try {
        const { data } = await callable({ companyId, applicationId, snapshotId });
        return {
            url: data.url,
            fileName: data.fileName,
            isOriginal: Boolean(data.isOriginal),
            snapshotId: data.snapshotId,
        };
    } catch (error) {
        const code = String(error?.code || '');
        if (code.includes('not-found')) {
            throw new NoPreservedPdfError(
                'No preserved application PDF exists for this submission. It was submitted '
                + 'before applications were archived as documents.',
            );
        }
        if (code.includes('permission-denied')) {
            throw new Error('You do not have permission to open this application document.');
        }
        throw new Error('Could not open the application document. Please try again.');
    }
}

/**
 * Fetch and hand the preserved original to the browser as a download.
 *
 * Navigates rather than opening a tab: the link is a one-time, short-lived
 * download URL with a `Content-Disposition` of its own, so the browser saves the
 * file and stays where it was. A popup blocker cannot silently swallow it, and
 * the URL never becomes a bookmark or a history entry someone can re-share.
 */
export async function downloadPreservedApplicationPdf(args, { navigate = defaultNavigate } = {}) {
    const result = await fetchPreservedApplicationPdf(args);
    navigate(result.url);
    return result;
}

function defaultNavigate(url) {
    const anchor = document.createElement('a');
    anchor.href = url;
    // The server already sets the filename via Content-Disposition; `download`
    // is belt-and-braces for browsers that honour it on cross-origin responses.
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}
