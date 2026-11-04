/**
 * A call result and the pipeline stage (owner decision Д3, 2026-11-04): only
 * "Interested" moves a record, to `Interested`; "Not Interested" and "Wrong
 * Number" move it to `Declined`; every other result (No Answer, Left Voicemail,
 * a scheduled callback, Not Qualified, Hired Elsewhere) keeps the stage. Every
 * call is still recorded as the last call, which the list's "Last call" column
 * shows (`candidateListColumns.jsx`).
 *
 * Before Д3 a call wrote `Contacted`, `Attempted`, `Disqualified` or `Rejected`:
 * values outside the funnel, so a lead left its tab and an application's
 * "status changed" notice went to the whole team after a mere No Answer.
 *
 * All names below are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastCallOf } from '@features/company-admin/views/candidateListColumns';

const fb = vi.hoisted(() => ({
    record: { exists: true, data: {} },
    updateDoc: vi.fn(async () => {}),
    setDoc: vi.fn(async () => {}),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    functions: {},
    auth: { currentUser: { uid: 'recruiter-1', displayName: 'Rita Recruiter', email: 'rita@example.com' } },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    collection: (_db, ...segments) => ({ path: segments.join('/') }),
    serverTimestamp: () => 'ts',
    getDoc: async (ref) => (ref.path.startsWith('companies/co-1/')
        ? { exists: () => fb.record.exists, data: () => fb.record.data }
        : { exists: () => true, data: () => ({ appSlug: 'blue-line' }) }),
    setDoc: (...args) => fb.setDoc(...args),
    updateDoc: (...args) => fb.updateDoc(...args),
    addDoc: async () => ({ id: 'log-1' }),
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => async () => ({ data: { success: true } }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import { useCallOutcome } from './useCallOutcome';

const LEAD = { id: 'lead-1', firstName: 'Ivan', lastName: 'Driver', phone: '5551234567', email: 'ivan@example.com' };
const APPLICATION = { ...LEAD, id: 'app-1', submittedAt: { seconds: 1 } };

async function logCall(outcome, { record = LEAD, status = 'In Process' } = {}) {
    fb.record = { exists: true, data: { ...record, status } };
    const { result } = renderHook(() => useCallOutcome(record, 'co-1', vi.fn(), vi.fn()));
    act(() => {
        result.current.setOutcome(outcome);
        if (outcome === 'callback') {
            result.current.setCallbackDate('2026-11-05');
            result.current.setCallbackTime('10:00');
        }
    });
    await act(() => result.current.handleSave());
    expect(fb.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = fb.updateDoc.mock.calls[0];
    return { path: ref.path, data };
}

beforeEach(() => {
    vi.resetAllMocks();
    fb.updateDoc.mockImplementation(async () => {});
    fb.setDoc.mockImplementation(async () => {});
});

describe('a call result and the pipeline stage', () => {
    it.each([
        ['interested', 'Interested'],
        ['not_interested', 'Declined'],
        ['wrong_number', 'Declined'],
    ])('%s moves the record to %s, and says when it got there', async (outcome, stage) => {
        const { data } = await logCall(outcome);

        expect(data.status).toBe(stage);
        // As a stage change in the dossier writes it (`useAppActions`).
        expect(data.statusEnteredAt).toBe('ts');
    });

    it.each(['no_answer', 'voicemail', 'callback', 'not_qualified', 'hired_elsewhere'])(
        '%s keeps the stage', async (outcome) => {
            const { data } = await logCall(outcome);

            expect(data).not.toHaveProperty('status');
            expect(data).not.toHaveProperty('statusEnteredAt');
        },
    );

    it.each([
        ['interested', 'Connected / Interested', 'Interested'],
        ['callback', 'Connected / Scheduled Callback', 'Scheduled Callback'],
        ['not_qualified', 'Connected / Not Qualified', 'Not Qualified'],
        ['not_interested', 'Connected / Not Interested', 'Not Interested'],
        ['hired_elsewhere', 'Connected / Hired Elsewhere', 'Hired Elsewhere'],
        ['voicemail', 'Left Voicemail', 'Left Voicemail'],
        ['no_answer', 'No Answer', 'No Answer'],
        ['wrong_number', 'Wrong Number', 'Wrong Number'],
    ])('%s is still recorded as the last call, which the list shows', async (outcome, label, shown) => {
        const { data } = await logCall(outcome);

        expect(data).toMatchObject({
            lastCallOutcome: label,
            lastContactedAt: 'ts',
            lastContactedBy: 'recruiter-1',
        });
        expect(lastCallOf(data)).toBe(shown);
    });

    it('writes to the application itself when the record is an application', async () => {
        const { path, data } = await logCall('no_answer', { record: APPLICATION });

        expect(path).toBe('companies/co-1/applications/app-1');
        expect(data).not.toHaveProperty('status');
    });

    it.each([
        // Already there: no second stage change, so no "status changed" notice.
        ['interested', 'Interested'],
        ['not_interested', 'Declined'],
        // The older spelling of Declined, which the Declined tab also lists.
        ['wrong_number', 'Rejected'],
    ])('%s leaves a record already in %s as it is', async (outcome, status) => {
        const { data } = await logCall(outcome, { record: APPLICATION, status });

        expect(data).not.toHaveProperty('status');
        expect(data).not.toHaveProperty('statusEnteredAt');
    });

    it.each(['Hired', 'Approved', 'Terminated'])(
        'never moves a record out of %s', async (status) => {
            const { data } = await logCall('interested', { record: APPLICATION, status });

            expect(data).not.toHaveProperty('status');
        },
    );

    // A declined record is archived; moving it to Interested would leave an
    // archived Interested record. The recruiter changes the stage by hand.
    it.each(['Declined', 'Rejected'])(
        'keeps a record in %s, and archived, when the call says Interested', async (status) => {
            const { data } = await logCall('interested', { record: APPLICATION, status });

            expect(data).not.toHaveProperty('status');
            expect(data).not.toHaveProperty('statusEnteredAt');
            expect(data).not.toHaveProperty('archived');
            expect(data).toMatchObject({ lastCallOutcome: 'Connected / Interested' });
        },
    );

    it.each([
        ['not_interested', true],
        ['wrong_number', true],
        ['not_qualified', false],
        ['hired_elsewhere', false],
        ['no_answer', false],
        ['interested', false],
    ])('%s archives the record: %s (only a move to Declined does)', async (outcome, archived) => {
        const { data } = await logCall(outcome);

        if (archived) {
            expect(data).toMatchObject({ archived: true, archivedAt: 'ts' });
        } else {
            expect(data).not.toHaveProperty('archived');
            expect(data).not.toHaveProperty('archivedAt');
        }
    });
});

describe('a call that moves the stage says who moved it', () => {
    // So the bell does not tell the recruiter about their own change
    // (`functions/shared/notificationAudience.js`).
    it.each([
        ['interested', LEAD],
        ['not_interested', APPLICATION],
    ])('%s stamps the recruiter in the same write', async (outcome, record) => {
        const { data } = await logCall(outcome, { record });

        expect(data).toMatchObject({ statusChangedBy: 'recruiter-1', statusChangedAt: 'ts' });
    });

    it.each(['no_answer', 'callback'])('%s keeps the stage and stamps nothing', async (outcome) => {
        const { data } = await logCall(outcome, { record: APPLICATION });

        expect(data).not.toHaveProperty('statusChangedBy');
        expect(data).not.toHaveProperty('statusChangedAt');
    });
});
