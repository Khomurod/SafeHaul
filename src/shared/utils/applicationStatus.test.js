import { describe, it, expect } from 'vitest';
import {
    APPLICATION_STATUS_GROUPS,
    normalizeApplicationStatus,
    getStatusesForSegment,
    statusMatchesSegment,
} from './applicationStatus';

describe('normalizeApplicationStatus', () => {
    it.each([
        ['New', 'new'],
        ['New Application', 'new'],
        ['new application', 'new'],
        ['  NEW  ', 'new'],
        ['Hired', 'hired'],
        ['Approved', 'hired'],
        ['Terminated', 'terminated'],
        ['Declined', 'declined'],
        ['Rejected', 'declined'],
        ['rejected', 'declined'],
    ])('maps stored variant %s to segment %s', (raw, segment) => {
        expect(normalizeApplicationStatus(raw)).toBe(segment);
    });

    it.each([
        ['In Process'],
        ['Contact Attempt 1'],
        ['Offer Accepted'],
        ['New Lead'], // lead vocabulary must NOT leak into application segments
        [''],
        [null],
        [undefined],
        ['validation_error'],
    ])('maps %s to other', (raw) => {
        expect(normalizeApplicationStatus(raw)).toBe('other');
    });
});

describe('getStatusesForSegment', () => {
    it('returns the raw STORED variants for each segment (query vocabulary)', () => {
        expect(getStatusesForSegment('new')).toEqual(['New', 'New Application']);
        expect(getStatusesForSegment('hired')).toEqual(['Hired', 'Approved']);
        expect(getStatusesForSegment('terminated')).toEqual(['Terminated']);
        expect(getStatusesForSegment('declined')).toEqual(['Declined', 'Rejected']);
    });

    it('returns null for all/unknown so no constraint is applied', () => {
        expect(getStatusesForSegment('all')).toBeNull();
        expect(getStatusesForSegment('bogus')).toBeNull();
        expect(getStatusesForSegment(undefined)).toBeNull();
    });

    it('returns a copy — mutating the result cannot poison the groups', () => {
        const first = getStatusesForSegment('new');
        first.push('HACKED');
        expect(getStatusesForSegment('new')).toEqual(['New', 'New Application']);
        expect(APPLICATION_STATUS_GROUPS.new).toEqual(['New', 'New Application']);
    });
});

describe('statusMatchesSegment', () => {
    it('every raw variant matches its own segment and no other', () => {
        for (const [segment, variants] of Object.entries(APPLICATION_STATUS_GROUPS)) {
            for (const variant of variants) {
                expect(statusMatchesSegment(variant, segment)).toBe(true);
                for (const otherSegment of Object.keys(APPLICATION_STATUS_GROUPS)) {
                    if (otherSegment === segment) continue;
                    expect(statusMatchesSegment(variant, otherSegment)).toBe(false);
                }
            }
        }
    });

    it('all segment matches everything', () => {
        expect(statusMatchesSegment('Whatever', 'all')).toBe(true);
        expect(statusMatchesSegment(null, 'all')).toBe(true);
    });
});
