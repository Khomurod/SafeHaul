// src/shared/utils/applicationStatus.parity.test.js
//
// PARITY with the server. Which stored statuses mean a hired driver is one rule
// written twice: here (`APPLICATION_STATUS_GROUPS.hired`, which the Hired
// segment queries) and in `functions/shared/applicationStatus.js`, which the
// dashboard's Hired number and its "Needs attention" read. `functions/` is
// CommonJS and deployed on its own, so they cannot be one module.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

import { APPLICATION_STATUS_GROUPS, getStatusesForSegment } from './applicationStatus';

const require = createRequire(import.meta.url);
const server = require('../../../functions/shared/applicationStatus.js');

describe('hired statuses, browser and server', () => {
    it('list the same stored values, in the same order', () => {
        expect([...server.HIRED_STATUSES]).toEqual([...APPLICATION_STATUS_GROUPS.hired]);
        expect([...server.HIRED_STATUSES]).toEqual(getStatusesForSegment('hired'));
    });

    it('match a status exactly as stored, as the segment\'s query does', () => {
        for (const status of APPLICATION_STATUS_GROUPS.hired) expect(server.isHiredStatus(status)).toBe(true);
        for (const status of ['hired', ' Hired', 'Offer Sent', 'Declined', '', null, undefined]) {
            expect(server.isHiredStatus(status)).toBe(false);
        }
    });
});
