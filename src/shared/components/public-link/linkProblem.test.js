/**
 * Every refusal the four public pages' callables send, as the reason the person
 * is shown. The sentences are the servers' own (functions/publicSigning.js,
 * functions/employmentVerification/portal.js, functions/applicationChanges.js),
 * so a change to one of them that moves its reason shows up here.
 */
import { describe, expect, it } from 'vitest';
import { LINK_PROBLEM, isRetryableLinkProblem, linkProblemFromError } from './linkProblem';

const refusal = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

describe('linkProblemFromError', () => {
    it.each([
        // Signing room (getPublicEnvelope)
        ['sign: expired', refusal('deadline-exceeded', 'This signing link has expired. Please request a new one.'), LINK_PROBLEM.EXPIRED],
        ['sign: wrong, replaced or used token', refusal('permission-denied', 'Invalid Access Token.'), LINK_PROBLEM.UNOPENABLE],
        ['sign: no such document', refusal('not-found', 'Document not found.'), LINK_PROBLEM.NOT_FOUND],
        ['sign: link cut short', refusal('invalid-argument', 'Missing parameters.'), LINK_PROBLEM.NOT_FOUND],
        ['sign: submitted already', refusal('failed-precondition', 'This document has already been submitted or is no longer available.'), LINK_PROBLEM.USED],
        // Verification portal (getVerificationRequest)
        ['verify: expired', refusal('deadline-exceeded', 'This verification request has expired. Please contact the requesting company.'), LINK_PROBLEM.EXPIRED],
        ['verify: superseded', refusal('not-found', 'This request was replaced by a newer one. Please use the most recent email you received.'), LINK_PROBLEM.REPLACED],
        ['verify: wrong link', refusal('not-found', 'Verification request not found. The link may be invalid.'), LINK_PROBLEM.NOT_FOUND],
        // Change review (getChangeReview, submitChangeResolution)
        ['review: expired', refusal('failed-precondition', 'This review link has expired.'), LINK_PROBLEM.EXPIRED],
        ['review: revoked', refusal('failed-precondition', 'This review link was replaced by a newer one. Please use the latest link your recruiter sent.'), LINK_PROBLEM.REPLACED],
        ['review: complete', refusal('failed-precondition', 'This review is already complete.'), LINK_PROBLEM.USED],
        ['review: wrong link', refusal('not-found', 'This review link is invalid.'), LINK_PROBLEM.NOT_FOUND],
    ])('%s', (_label, error, reason) => {
        expect(linkProblemFromError(error)).toEqual({ reason });
    });

    it('could not check a link the server never answered for, and says so plainly', () => {
        // The browser gave up waiting: the code alone, no sentence of the server's.
        const timedOut = refusal('deadline-exceeded', 'deadline-exceeded');
        expect(linkProblemFromError(timedOut, 'This document could not be opened.')).toEqual({
            reason: LINK_PROBLEM.UNAVAILABLE,
            detail: 'This document could not be opened. Check your internet connection and try again.',
        });
    });

    it('passes on the words of a refusal written for the person, like too many tries', () => {
        const busy = refusal('resource-exhausted', 'Too many requests. Please wait and retry.');
        expect(linkProblemFromError(busy)).toEqual({
            reason: LINK_PROBLEM.UNAVAILABLE,
            detail: 'Too many requests. Please wait and retry.',
        });
    });

    it('never shows the text of an internal failure', () => {
        const internal = refusal('internal', 'Server permission error: Cannot sign URL.');
        const problem = linkProblemFromError(internal, 'This document could not be opened.');
        expect(problem.reason).toBe(LINK_PROBLEM.UNAVAILABLE);
        expect(problem.detail).not.toMatch(/Cannot sign URL/);
        expect(problem.detail).toMatch(/^This document could not be opened\./);
    });

    it('leaves who to contact to the screen, which names the sender', () => {
        // plainErrorMessage closes an unnamed failure with "contact support"; the
        // screen closes with "contact <sender>", and the two must not both show.
        const internal = refusal('internal', 'internal');
        expect(linkProblemFromError(internal, 'The review could not be opened.')).toEqual({
            reason: LINK_PROBLEM.UNAVAILABLE,
            detail: 'The review could not be opened. Please try again.',
        });
    });

    it('reads no reason into an internal failure that happens to say "expired"', () => {
        const internal = refusal('internal', 'token expired in upstream');
        expect(linkProblemFromError(internal).reason).toBe(LINK_PROBLEM.UNAVAILABLE);
    });

    it('treats an offline failure as a link it could not check', () => {
        const offline = new TypeError('Failed to fetch');
        expect(linkProblemFromError(offline, 'The review could not be opened.')).toEqual({
            reason: LINK_PROBLEM.UNAVAILABLE,
            detail: 'The review could not be opened. Check your internet connection and try again.',
        });
    });
});

describe('isRetryableLinkProblem', () => {
    it('offers a retry only for a link that could not be checked', () => {
        expect(isRetryableLinkProblem(LINK_PROBLEM.UNAVAILABLE)).toBe(true);
        for (const reason of [
            LINK_PROBLEM.EXPIRED, LINK_PROBLEM.REPLACED, LINK_PROBLEM.USED,
            LINK_PROBLEM.NOT_FOUND, LINK_PROBLEM.UNOPENABLE,
        ]) {
            expect(isRetryableLinkProblem(reason)).toBe(false);
        }
    });
});
