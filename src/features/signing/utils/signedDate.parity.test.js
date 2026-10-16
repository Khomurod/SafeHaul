// src/features/signing/utils/signedDate.parity.test.js
//
// PARITY with the server. `signedDate.js` and `functions/shared/signedDate.js`
// are one rule written twice: `functions/` is CommonJS and deployed on its own,
// so they cannot be one module. The server stamps the Date Signed a signer sees
// and the one that is sealed; this copy answers the same question for the
// recruiter's send and preview and for the signing room's re-check across UTC
// midnight. If the two drifted, a screen could show one day and the sealed PDF
// print another. Both copies run here over one table of inputs and must give the
// same answer, a thrown error included, whatever zone the device is in.
// `rollSignedDateFields` exists only here; `signedDate.test.js` covers it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

import * as site from './signedDate';

const require = createRequire(import.meta.url);
const server = require('../../../../functions/shared/signedDate.js');

/** What a call did: the value it returned, or the kind of error it threw. */
const outcome = (fn, ...args) => {
    try {
        return { returned: fn(...args) };
    } catch (error) {
        return { threw: error.name };
    }
};

// A device west of UTC, in it, and east of it. Near UTC midnight a copy that
// formatted in the device's zone would print another day in one of them.
const ZONES = ['America/Los_Angeles', 'UTC', 'Pacific/Kiritimati'];

// Either side of UTC midnight; the same instants as a signer west or east of UTC
// writes them (still the 11th, already the 12th); a leap day, the turn of a
// year, the epoch; and a date that is no date at all.
const INSTANTS = [
    '2026-09-11T23:59:59.999Z',
    '2026-09-12T00:00:00.000Z',
    '2026-09-11T19:30:00-05:00',
    '2026-09-12T08:30:00+09:00',
    '2028-02-29T23:59:59.999Z',
    '2027-01-01T00:00:00.000Z',
    '1970-01-01T00:00:00.000Z',
    'not a date',
];
const DATES = INSTANTS.map((instant) => new Date(instant));

const FIELDS = [
    undefined, null, 0, '', '{{current_date}}', {},
    { bindingKey: 'current_date' },
    { bindingKey: 'CURRENT_DATE' },
    { bindingKey: ' current_date\n' },
    { bindingKey: 'currentDate' },
    { bindingKey: null, defaultValue: null },
    // A date an older send baked in, and a binding over other text.
    { bindingKey: 'current_date', defaultValue: 'May 7, 2026' },
    { bindingKey: 'current_date', defaultValue: '{{full_name}}' },
    { bindingKey: 'dob', defaultValue: 'January 2, 1980' },
    { bindingKey: 'dob', defaultValue: '{{current_date}}' },
    { defaultValue: '{{current_date}}' },
    { defaultValue: '{{  Current_Date\t}}' },
    { defaultValue: 'Signed on {{current_date}} at the terminal' },
    { defaultValue: '{{full_name}} signed {{current_date}} and {{CURRENT_DATE}}' },
    { defaultValue: '{{full_name}}' },
    { defaultValue: '{{date}}' },
    { defaultValue: '{current_date}' },
    { defaultValue: '{{current-date}}' },
    { defaultValue: '{{{current_date}}}' },
    { defaultValue: 12345, bindingKey: 'current_date' },
];

describe.each(ZONES)('parity with functions/shared/signedDate.js on a device in %s', (zone) => {
    let previous;

    beforeEach(() => {
        previous = process.env.TZ;
        process.env.TZ = zone;
    });

    afterEach(() => {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    });

    it.each(INSTANTS)('formats %s as the same day', (instant) => {
        const date = new Date(instant);
        expect(site.formatSignedDate(date)).toBe(server.formatSignedDate(date));
    });

    it.each(FIELDS.map((field) => [field]))('resolves %j the same way at every instant', (field) => {
        for (const now of [...DATES, null]) {
            expect(outcome(site.resolveSignedDateValue, field, now))
                .toEqual(outcome(server.resolveSignedDateValue, field, now));
        }
    });

    it('stamps a list the same way and returns the same entries untouched', () => {
        for (const fields of [[], FIELDS]) {
            for (const now of DATES) {
                const fromSite = site.stampSignedDateFields(fields, now);
                const fromServer = server.stampSignedDateFields(fields, now);
                expect(fromSite).toEqual(fromServer);
                expect(fromSite.map((field, i) => field === fields[i]))
                    .toEqual(fromServer.map((field, i) => field === fields[i]));
            }
        }
    });
});

describe('parity with functions/shared/signedDate.js', () => {
    it('names the same key and placeholder', () => {
        expect(site.SIGNING_DATE_KEY).toBe(server.SIGNING_DATE_KEY);
        expect(site.SIGNING_DATE_PLACEHOLDER).toBe(server.SIGNING_DATE_PLACEHOLDER);
    });

    it('fails the same way when the date is not a Date', () => {
        for (const notADate of [null, '2026-09-11', 1789171200000]) {
            expect(outcome(site.formatSignedDate, notADate)).toEqual(outcome(server.formatSignedDate, notADate));
        }
    });

    // Anything but a list is no fields at all, on both sides.
    it('answers the same when the list is missing or not an array', () => {
        const notArrays = [undefined, null, 'text', {}];
        expect(notArrays.map((fields) => outcome(site.stampSignedDateFields, fields, DATES[0])))
            .toEqual(notArrays.map((fields) => outcome(server.stampSignedDateFields, fields, DATES[0])));
    });
});
