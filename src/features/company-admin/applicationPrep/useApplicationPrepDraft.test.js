/**
 * The carrier's side of a prepared application.
 *
 * What matters here is the identity — the email and phone key the draft and the
 * application it becomes — and the lock list, which is what the driver will not be
 * able to edit. Identity lives in `formData` (the schema edits it), not a state of
 * its own, so `save` reads the key straight off the answers.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({ httpsCallable: vi.fn(), call: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: callables.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { describeError, useApplicationPrepDraft } from './useApplicationPrepDraft';

const ACME = { companyName: 'Acme Trucking', dotNumber: 'USDOT 123456' };

beforeEach(() => {
    vi.clearAllMocks();
    callables.httpsCallable.mockReturnValue(callables.call);
    callables.call.mockResolvedValue({ data: { saved: true, applicantKey: 'key-1', lockedEmployers: [] } });
});

describe('preparing an application', () => {
    it('reads the key off the answers and sends them together', async () => {
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));

        // Email/phone are ordinary fields now — the same `updateField` the schema
        // editor calls, not a separate identity state.
        act(() => result.current.updateField('firstName', 'Dana'));
        act(() => result.current.updateField('lastName', 'Alvarez'));
        act(() => result.current.updateField('email', 'dana@example.test'));
        act(() => result.current.updateField('phone', '2145550147'));
        act(() => result.current.updateField('cdlNumber', 'TX1234567'));
        await act(async () => { await result.current.save(); });

        expect(callables.httpsCallable).toHaveBeenCalledWith({}, 'saveCompanyPreparedApplication');
        const payload = callables.call.mock.calls[0][0];
        expect(payload).toMatchObject({ companyId: 'co-1', email: 'dana@example.test', phone: '2145550147' });
        expect(payload.formData).toMatchObject({ firstName: 'Dana', lastName: 'Alvarez', cdlNumber: 'TX1234567' });
        expect(result.current.applicantKey).toBe('key-1');
    });

    it('gates the save until there is an email or phone to key the draft', () => {
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));

        expect(result.current.identityComplete).toBe(false);
        act(() => result.current.updateField('email', 'dana@example.test'));
        expect(result.current.identityComplete).toBe(true);
    });

    it('locks an employer by identity, and does not lock the same one twice', async () => {
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));

        act(() => result.current.lockEmployers([ACME]));
        act(() => result.current.lockEmployers([{ companyName: 'Acme Trucking Inc', dotNumber: '123456' }]));

        expect(result.current.lockedEmployers).toEqual([
            { signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' },
        ]);
    });

    it('refuses to lock a row it cannot identify', () => {
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));
        act(() => result.current.lockEmployers([{ companyName: '', dotNumber: '' }]));
        expect(result.current.lockedEmployers).toEqual([]);
    });

    it('unlocks by signature, leaving the row itself alone', () => {
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));
        act(() => result.current.lockEmployers([ACME]));
        act(() => result.current.unlockEmployer('dot:123456'));
        expect(result.current.lockedEmployers).toEqual([]);
    });

    it("surfaces the server's own words when a driver already has an application", async () => {
        const conflict = new Error('This driver already has an application in progress.');
        conflict.code = 'functions/already-exists';
        callables.call.mockRejectedValueOnce(conflict);
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));

        await act(async () => { await result.current.save(); });

        expect(result.current.error).toBe('This driver already has an application in progress.');
        expect(result.current.applicantKey).toBeNull();
    });
});

describe('opening one back up', () => {
    it('restores the answers while the carrier is still the author', async () => {
        callables.call.mockResolvedValue({
            data: {
                applicantKey: 'key-1', status: 'sent', readable: true,
                firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', phone: '2145550147',
                formData: { cdlNumber: 'TX1234567' },
                lockedEmployers: [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }],
            },
        });
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));

        await act(async () => { await result.current.load('key-1'); });

        expect(result.current.formData.cdlNumber).toBe('TX1234567');
        expect(result.current.lockedEmployers).toHaveLength(1);
        expect(result.current.status).toBe('sent');
    });

    it('keeps the form empty once the driver has taken it over', async () => {
        callables.call.mockResolvedValue({
            data: {
                applicantKey: 'key-1', status: 'driver_in_progress', readable: false,
                firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', phone: '2145550147',
                formData: null, lockedEmployers: [],
            },
        });
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));

        const loaded = await act(async () => result.current.load('key-1'));

        expect(loaded.readable).toBe(false);
        // No answers — only the contact/name, so the header stays meaningful while
        // the screen shows a read-only notice in place of the editor.
        expect(result.current.formData).toEqual({
            firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', phone: '2145550147',
        });
        expect(result.current.formData.cdlNumber).toBeUndefined();
    });
});

describe('moving on to another driver', () => {
    it('holds nothing from the last application', async () => {
        callables.call.mockResolvedValue({
            data: {
                applicantKey: 'key-1', status: 'sent', readable: true,
                firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', phone: '2145550147',
                formData: { cdlNumber: 'TX1234567', 'psp-report-upload': { name: 'psp.pdf' } },
                lockedEmployers: [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }],
            },
        });
        const { result } = renderHook(() => useApplicationPrepDraft('co-1'));
        await act(async () => { await result.current.load('key-1'); });

        act(() => { result.current.reset(); });

        // Every one of these is keyed to an applicant, and the email/phone in
        // formData is what keys the draft — so a leftover here files one driver's
        // answers and documents under the next driver's key.
        expect(result.current.formData).toEqual({});
        expect(result.current.identityComplete).toBe(false);
        expect(result.current.lockedEmployers).toEqual([]);
        expect(result.current.applicantKey).toBeNull();
        expect(result.current.status).toBe('draft');
        expect(result.current.error).toBeNull();
    });
});

describe('describeError', () => {
    it.each([
        ['functions/permission-denied', /do not have access/],
        ['functions/unauthenticated', /session has ended/],
        ['functions/resource-exhausted', /Too many saves/],
        ['functions/not-found', /could not be found/],
    ])('turns %s into something a recruiter can act on', (code, expected) => {
        expect(describeError({ code, message: 'raw' })).toMatch(expected);
    });
});
