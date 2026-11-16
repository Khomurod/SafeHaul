import { describe, it, expect } from 'vitest';
import { ATS_LEGACY_STATUS_ALIASES, ATS_STATUS_DROPDOWN_OPTIONS } from '@shared/constants/atsStatus';
import {
    APPLICATION_IN_PROCESS_STATUSES,
    APPLICATION_STATUS_GROUPS,
    normalizeApplicationStatus,
    getStatusesForSegment,
    statusMatchesSegment,
    applicationStatusLabel,
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

describe('applicationStatusLabel', () => {
    it.each([
        ['New', 'New'],
        ['New Application', 'New'],
        [' new application ', 'New'],
        ['Hired', 'Hired'],
        ['Approved', 'Hired'],
        ['Terminated', 'Terminated'],
        ['Declined', 'Declined'],
        ['Rejected', 'Declined'],
    ])('shows %j as its group name %j', (raw, label) => {
        expect(applicationStatusLabel(raw)).toBe(label);
    });

    it('shows any other status as stored, and nothing for none', () => {
        expect(applicationStatusLabel('Contact Attempt 1')).toBe('Contact Attempt 1');
        expect(applicationStatusLabel(' Background Check ')).toBe('Background Check');
        expect(applicationStatusLabel(undefined)).toBe('');
    });
});

describe('the In process segment (Д14)', () => {
    const IN_PROCESS = [
        'Contact Attempt 1', 'Contact Attempt 2', 'Contact Attempt 3', 'Interested', 'In Process',
        'Contacted', 'Attempted', 'In Review', 'Background Check', 'Qualified', 'Hold', 'Offer Accepted',
    ];

    it('asks for the contact attempts, Interested, In Process and the older stages between them', () => {
        expect(getStatusesForSegment('in_process')).toEqual(IN_PROCESS);
        expect([...APPLICATION_IN_PROCESS_STATUSES]).toEqual(IN_PROCESS);
    });

    it('leaves out New, Hired, Terminated, Declined, every spelling of them, and the closed older stages', () => {
        const left = [...Object.values(APPLICATION_STATUS_GROUPS).flat(), 'New Lead', 'Disqualified', 'Stale', 'Offer Declined'];
        for (const status of left) {
            expect(getStatusesForSegment('in_process')).not.toContain(status);
            expect(statusMatchesSegment(status, 'in_process')).toBe(false);
        }
    });

    it('places every status the picker offers or a record may hold in exactly one segment, or none when closed', () => {
        const closed = new Set(['Disqualified', 'Stale', 'Offer Declined']);
        const segments = ['new', 'in_process', 'hired', 'terminated', 'declined'];
        for (const status of [...ATS_STATUS_DROPDOWN_OPTIONS, ...ATS_LEGACY_STATUS_ALIASES, 'Contacted', 'Attempted', 'Disqualified']) {
            const matched = segments.filter((segment) => statusMatchesSegment(status, segment));
            expect(matched).toHaveLength(closed.has(status) ? 0 : 1);
        }
    });

    it('matches stored values exactly, as the query does', () => {
        expect(statusMatchesSegment('In Process', 'in_process')).toBe(true);
        expect(statusMatchesSegment('in process', 'in_process')).toBe(false);
        expect(statusMatchesSegment(undefined, 'in_process')).toBe(false);
    });

    it('keeps each of its stages under its own name and outside the other groups', () => {
        for (const status of IN_PROCESS) {
            expect(normalizeApplicationStatus(status)).toBe('other');
            expect(applicationStatusLabel(status)).toBe(status);
        }
    });

    it('stays inside Firestore\'s 30 alternatives with room for a State filter', () => {
        expect(IN_PROCESS.length * 2).toBeLessThanOrEqual(30);
    });
});
