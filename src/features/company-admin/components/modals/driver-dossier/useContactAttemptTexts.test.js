/**
 * The dossier reads the company's Contact Attempt templates once, while the
 * picker is offered, and answers "may" until it knows or when it cannot read
 * them. Firestore is mocked; all ids are artificial.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ getDoc: vi.fn() }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    getDoc: (...args) => fx.getDoc(...args),
}));

import { useContactAttemptTexts } from './useContactAttemptTexts';

const settings = (data) => ({ exists: () => data !== null, data: () => data });
const record = { phone: '5550102030', 'sms-consent': 'yes' };
const render = (props = {}) => renderHook((p) => useContactAttemptTexts(p), {
    initialProps: { companyId: 'co-1', enabled: true, currentStatus: 'New', record, isLead: false, ...props },
});

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fx.getDoc.mockImplementation(async () => settings({ templateContactAttempt1: 'Hi {driver name}' }));
});

afterEach(() => vi.restoreAllMocks());

describe('useContactAttemptTexts', () => {
    it("reads the company's automated texts and answers from them", async () => {
        const { result } = render();

        // Until the templates arrive, the dossier does not know.
        expect(result.current('Contact Attempt 1')).toBe('may');
        await waitFor(() => expect(result.current('Contact Attempt 1')).toBe('texts'));
        expect(result.current('Contact Attempt 2')).toBeNull();
        expect(fx.getDoc).toHaveBeenCalledTimes(1);
        expect(fx.getDoc.mock.calls[0][0]).toEqual({ path: 'companies/co-1/settings/automated_sms' });
    });

    it('answers that no stage texts when the company saved no template', async () => {
        fx.getDoc.mockImplementation(async () => settings(null));
        const { result } = render();

        await waitFor(() => expect(result.current('Contact Attempt 1')).toBeNull());
    });

    it('keeps "may" when the templates cannot be read', async () => {
        let fail;
        fx.getDoc.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
        const { result } = render();

        await act(async () => { fail(new Error('permission-denied (artificial)')); });
        expect(result.current('Contact Attempt 1')).toBe('may');
        expect(console.error).toHaveBeenCalled();
    });

    it('reads nothing while the picker is not offered', () => {
        const { result } = render({ enabled: false });

        expect(fx.getDoc).not.toHaveBeenCalled();
        expect(result.current('Contact Attempt 1')).toBe('may');
    });

    it("does not answer for one company from another's templates", async () => {
        const { result, rerender } = render();
        await waitFor(() => expect(result.current('Contact Attempt 1')).toBe('texts'));

        let arrive;
        fx.getDoc.mockImplementation(() => new Promise((resolve) => { arrive = resolve; }));
        rerender({ companyId: 'co-2', enabled: true, currentStatus: 'New', record, isLead: false });
        expect(result.current('Contact Attempt 1')).toBe('may');

        await act(async () => { arrive(settings({})); });
        expect(result.current('Contact Attempt 1')).toBeNull();
    });
});
