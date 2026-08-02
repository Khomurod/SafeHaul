/**
 * Status vocabulary guard
 * =======================
 * Firestore rules cannot import JS, and the Facebook lead-ingestion Cloud
 * Function lives in a separate package, so the canonical frontend status
 * constants are cross-checked here against those sources' literals.
 *
 * These are STORED values: renaming any of them breaks existing documents
 * and/or gets writes rejected by firestore.rules. If one of these tests
 * fails, the constant was renamed — that is a behavior change, not a
 * refactor.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    ATS_PIPELINE_STATUSES,
    ATS_STATUS_DROPDOWN_OPTIONS,
    ATS_STATUS_NEW,
    LEAD_DEFAULT_STATUS,
    APPLICATION_DEFAULT_STATUS,
    OFFER_ACCEPTED_STATUS,
    OFFER_DECLINED_STATUS,
} from '@shared/constants/atsStatus';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

describe('canonical status values (stored data — must not change)', () => {
    it('creation defaults keep their persisted spellings', () => {
        expect(ATS_STATUS_NEW).toBe('New');
        expect(LEAD_DEFAULT_STATUS).toBe('New Lead');
        expect(APPLICATION_DEFAULT_STATUS).toBe('New Application');
        expect(OFFER_ACCEPTED_STATUS).toBe('Offer Accepted');
        expect(OFFER_DECLINED_STATUS).toBe('Offer Declined');
    });

    it('quick-add pipeline status is a recruiter-selectable pipeline status', () => {
        expect(ATS_PIPELINE_STATUSES).toContain(ATS_STATUS_NEW);
        expect(ATS_STATUS_DROPDOWN_OPTIONS).toContain(ATS_STATUS_NEW);
    });

    it('application default status stays selectable in the ATS dropdown', () => {
        expect(ATS_STATUS_DROPDOWN_OPTIONS).toContain(APPLICATION_DEFAULT_STATUS);
    });
});

describe('firestore.rules stays in sync with frontend-created statuses', () => {
    const rules = read('src/firestore.rules');

    it('driver self-update whitelist accepts exactly the offer response statuses', () => {
        // The application status vocabulary still includes these offer response
        // statuses; the rules whitelist them for the driver self-update path.
        const whitelist = rules.match(/request\.resource\.data\.status in \[([^\]]*)\]/);
        expect(whitelist).toBeTruthy();
        expect(whitelist[1]).toContain(`'${OFFER_ACCEPTED_STATUS}'`);
        expect(whitelist[1]).toContain(`'${OFFER_DECLINED_STATUS}'`);
    });
});

describe('backend lead ingestion stays in sync with the frontend lead status', () => {
    it('Facebook lead ingestion writes the same default lead status', () => {
        const facebook = read('functions/integrations/facebook.js');
        expect(facebook).toContain(`status: '${LEAD_DEFAULT_STATUS}'`);
    });
});
