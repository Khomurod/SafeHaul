// "Ask … for a new link": the call the public pages make. Artificial ids only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ e2e: false }));
const ask = vi.fn();
const httpsCallable = vi.fn(() => ask);

vi.mock('firebase/functions', () => ({ httpsCallable: (...args) => httpsCallable(...args) }));
vi.mock('@lib/firebase', () => ({ functions: { app: 'artificial' } }));
vi.mock('@lib/runtime/e2eMode', () => ({
    get isE2ETestMode() { return state.e2e; },
}));

import { requestNewLink } from './requestNewLink';

describe('requestNewLink', () => {
    beforeEach(() => {
        // Queues *Once values: reset, and the defaults put back.
        vi.resetAllMocks();
        httpsCallable.mockImplementation(() => ask);
        ask.mockImplementation(async () => ({ data: { ok: true } }));
        state.e2e = false;
    });

    it('asks the server, with exactly what the page passed', async () => {
        await expect(requestNewLink({ kind: 'verify', token: 'tok-1' })).resolves.toEqual({ ok: true });
        expect(httpsCallable).toHaveBeenCalledWith({ app: 'artificial' }, 'requestNewLink');
        expect(ask).toHaveBeenCalledWith({ kind: 'verify', token: 'tok-1' });
    });

    it("rejects with the server's refusal, for the screen to read", async () => {
        const refusal = Object.assign(new Error('You already asked.'), { code: 'functions/resource-exhausted' });
        ask.mockRejectedValueOnce(refusal);
        await expect(requestNewLink({ kind: 'review', token: 'tok-2' })).rejects.toBe(refusal);
    });

    it('asks nothing in a browser test, and answers as the server would', async () => {
        state.e2e = true;
        await expect(requestNewLink({ kind: 'sign', companyId: 'co-1', requestId: 'req-1' })).resolves.toEqual({ ok: true });
        expect(httpsCallable).not.toHaveBeenCalled();
        expect(ask).not.toHaveBeenCalled();
    });
});
