import { describe, expect, it } from 'vitest';

import {
    describeCheckReason,
    describeLaneStatus,
    describeServiceState,
    describeVersionResult,
    formatCheckedAt,
} from './aiModelVersionsPresentation';

describe('the model versions table\'s words', () => {
    it.each([
        ['ok', 'success', 'Working'],
        ['failing', 'danger', 'Failing'],
        ['unknown', 'warning', 'Not confirmed'],
        ['skipped', 'neutral', 'Chosen by hand'],
        [null, 'neutral', 'Not checked yet'],
        ['something new', 'neutral', 'Not checked yet'],
    ])('names a lane that is %s', (status, tone, label) => {
        expect(describeLaneStatus(status)).toEqual({ tone, label });
    });

    it('notes every check result that is not a pass, and nothing for one that is', () => {
        expect(describeVersionResult('passed')).toBeNull();
        expect(describeVersionResult(null)).toBeNull();
        for (const result of ['misread', 'gone', 'refused', 'busy', 'key', 'quota', 'error']) {
            expect(describeVersionResult(result)).toEqual(expect.any(String));
        }
    });

    it('says why a service is not checked before what its account answered', () => {
        expect(describeServiceState({ state: 'off', account: 'key' })).toMatchObject({ label: 'Off' });
        expect(describeServiceState({ state: 'not_set_up', account: null })).toMatchObject({ label: 'Not set up' });
        expect(describeServiceState({ state: 'ready', account: 'key' })).toMatchObject({ tone: 'danger', label: 'Key refused' });
        expect(describeServiceState({ state: 'ready', account: 'quota' })).toMatchObject({ tone: 'danger', label: 'Allowance used up' });
        expect(describeServiceState({ state: 'ready', account: null })).toEqual({ tone: 'success', label: 'On', note: null });
    });

    it('names why the last check ran, and refuses a time that is not one', () => {
        expect(describeCheckReason('requested')).toBe('Check now');
        expect(describeCheckReason('whenever')).toBeNull();
        expect(formatCheckedAt('not a date')).toBeNull();
        expect(formatCheckedAt(null)).toBeNull();
        expect(formatCheckedAt('2026-10-08T08:25:00.000Z')).toEqual(expect.any(String));
    });
});
