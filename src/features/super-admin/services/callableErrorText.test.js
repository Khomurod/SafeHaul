import { describe, expect, it } from 'vitest';
import { callableErrorText, serverMessage, serverReason } from './callableErrorText';
import { describeAiError } from './aiIntegrations';
import { describeAlertsError } from './platformAlerts';
import { describeLeadsError } from './websiteLeads';
import { describeReleaseError } from './releaseManagement';
import { describeVaultError } from './environmentVault';

const failure = (code, message) => ({ code: `functions/${code}`, message });

describe('callableErrorText', () => {
    it('gives the common sentence for the common codes', () => {
        expect(callableErrorText(failure('unauthenticated', 'x'), 'Fallback.'))
            .toBe('Your session has ended. Sign in again to continue.');
        expect(callableErrorText(failure('permission-denied', 'x'), 'Fallback.'))
            .toBe('Super Admin access is required for this action.');
        expect(callableErrorText(failure('resource-exhausted', 'x'), 'Fallback.'))
            .toBe('Too many requests. Wait a moment and try again.');
    });

    it("passes the server's reason through for invalid-argument and failed-precondition, without its prefix", () => {
        expect(callableErrorText(failure('failed-precondition', 'FAILED_PRECONDITION: Set the account id first.'), 'Fallback.'))
            .toBe('Set the account id first.');
        expect(callableErrorText(failure('invalid-argument', ''), 'Fallback.')).toBe('Fallback.');
    });

    it("answers a console's own sentence first, and the fallback for anything unmapped", () => {
        const texts = { 'not-found': 'Gone.', 'permission-denied': 'Owner only.' };
        expect(callableErrorText(failure('not-found'), 'Fallback.', texts)).toBe('Gone.');
        expect(callableErrorText(failure('permission-denied'), 'Fallback.', texts)).toBe('Owner only.');
        expect(callableErrorText(failure('internal', 'stack trace'), 'Fallback.', texts)).toBe('Fallback.');
        expect(callableErrorText(null, 'Fallback.', texts)).toBe('Fallback.');
    });

    it('maps only callable codes: a bare code or no code falls to `default`, else the fallback', () => {
        expect(callableErrorText({ code: 'permission-denied', message: 'x' }, 'Fallback.')).toBe('Fallback.');
        expect(callableErrorText(new TypeError('Failed to fetch'), 'Fallback.')).toBe('Fallback.');
        expect(callableErrorText(new TypeError('Failed to fetch'), 'Fallback.', { default: serverMessage }))
            .toBe('Failed to fetch');
    });

    it('runs a function text with the error and the fallback', () => {
        expect(serverReason({ message: 'Precondition: Busy.' }, 'F')).toBe('Busy.');
        expect(serverMessage({ message: '' }, 'F')).toBe('F');
    });
});

describe('the consoles keep their own sentences', () => {
    it('AI, vault, release, alerts and leads', () => {
        expect(describeAiError(failure('not-found'))).toBe('That provider or credential field is not recognised.');
        expect(describeVaultError(failure('already-exists'))).toBe('That key already has a stored value.');
        expect(describeReleaseError(failure('aborted', ''))).toBe('A release is already running.');
        expect(describeReleaseError(failure('internal'))).toBe('That release action could not be completed.');
        expect(describeAlertsError(failure('resource-exhausted', 'Wait 30 seconds.'))).toBe('Wait 30 seconds.');
        expect(describeLeadsError(failure('internal', 'Archive offline.'))).toBe('Archive offline.');
        expect(describeLeadsError(failure('unauthenticated'))).toBe('Sign in again to continue.');
    });
});
