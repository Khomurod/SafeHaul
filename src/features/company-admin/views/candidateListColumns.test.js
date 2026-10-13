/**
 * The candidate list's Added Date is the day a record was created: the day the
 * date filter finds it by. An application the driver sent again later keeps its
 * creation day there, not the day of its latest submission.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatAddedDate } from './candidateListColumns';

let zone;

beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
});

afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

const at = (iso) => ({ seconds: Date.parse(iso) / 1000 });

describe('formatAddedDate', () => {
    it('shows the day the record was created, the day the date filter finds it by', () => {
        // Artificial: created on 5 October, submitted again on 12 October.
        expect(formatAddedDate({ createdAt: at('2026-10-05T15:00:00Z'), submittedAt: at('2026-10-12T15:00:00Z') }))
            .toBe('10/05/2026');
    });

    it('shows the submission day of a record with no creation day', () => {
        expect(formatAddedDate({ submittedAt: at('2026-10-12T15:00:00Z') })).toBe('10/12/2026');
    });

    it('shows nothing for a record with neither', () => {
        expect(formatAddedDate({})).toBeNull();
    });
});
