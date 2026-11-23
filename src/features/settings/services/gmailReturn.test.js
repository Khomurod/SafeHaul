import { beforeEach, describe, expect, it, vi } from 'vitest';

const complete = vi.hoisted(() => vi.fn());

vi.mock('firebase/functions', () => ({ httpsCallable: () => complete }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { GMAIL_RETURN_EXPIRED, GMAIL_RETURN_REFUSED, gmailReturnOutcome, readGmailReturn } from './gmailReturn';

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('readGmailReturn', () => {
    it('reads the code, the state and an error, blank when absent', () => {
        expect(readGmailReturn('?code=C&state=S')).toEqual({ code: 'C', state: 'S', error: '' });
        expect(readGmailReturn('?error=access_denied')).toEqual({ code: '', state: '', error: 'access_denied' });
        expect(readGmailReturn('')).toEqual({ code: '', state: '', error: '' });
    });
});

describe('gmailReturnOutcome', () => {
    it('settles a return without a full code and state without calling the server', async () => {
        await expect(gmailReturnOutcome({ code: '', state: '', error: 'access_denied' })).resolves.toEqual({ kind: 'cancelled' });
        await expect(gmailReturnOutcome({ code: '', state: '', error: 'server_error' }))
            .resolves.toEqual({ kind: 'failed', message: GMAIL_RETURN_REFUSED });
        await expect(gmailReturnOutcome({ code: 'C', state: '', error: '' }))
            .resolves.toEqual({ kind: 'failed', message: GMAIL_RETURN_EXPIRED });
        await expect(gmailReturnOutcome({ code: '', state: 'S', error: '' }))
            .resolves.toEqual({ kind: 'failed', message: GMAIL_RETURN_EXPIRED });
        expect(complete).not.toHaveBeenCalled();
    });

    it('calls the server once per state, and an address already cleared joins the call still running', async () => {
        let answer;
        complete.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        const first = gmailReturnOutcome({ code: 'C-once', state: 'S-once', error: '' });
        const again = gmailReturnOutcome({ code: 'C-once', state: 'S-once', error: '' });
        const cleared = gmailReturnOutcome({ code: '', state: '', error: '' });
        answer({ data: { email: 'owner@example.test' } });

        await expect(Promise.all([first, again, cleared])).resolves.toEqual(
            Array(3).fill({ kind: 'connected', email: 'owner@example.test' }),
        );
        expect(complete).toHaveBeenCalledExactlyOnceWith({ state: 'S-once', code: 'C-once' });
        // Once settled, an empty address has nothing to finish.
        await expect(gmailReturnOutcome({ code: '', state: '', error: '' })).resolves.toEqual({ kind: 'nothing' });
    });

    it("never rejects: a refusal is the server's sentence, logged by its code only", async () => {
        complete.mockRejectedValue(Object.assign(new Error('This Gmail connection expired.'), { code: 'functions/failed-precondition' }));
        await expect(gmailReturnOutcome({ code: 'C-refused', state: 'S-refused', error: '' }))
            .resolves.toEqual({ kind: 'failed', message: 'This Gmail connection expired.' });
        expect(console.warn).toHaveBeenCalledExactlyOnceWith('[gmailReturn] Gmail was not connected:', 'functions/failed-precondition');
    });
});
