/**
 * Composing the reader's two passes.
 *
 * The bug this pins was a shallow spread. The second call answers only for the
 * documents the model reported as unreadable, so it returns a complete shape that
 * is mostly empty — and spread over the first pass, `carriers: []` and an empty
 * `license` erased everything a readable PSP report and a readable licence had
 * already produced. One unreadable medical card cost the recruiter every other
 * field, silently, with a success message on screen.
 *
 * Found in review on 2026-09-03.
 */
import { describe, expect, it } from 'vitest';

import { mergeExtractionResults } from './mergeExtractionResults';

const TEXT_PASS = Object.freeze({
    driver: { firstName: 'Dana', lastName: 'Alvarez', dateOfBirth: '1988-03-11' },
    license: { cdlNumber: 'TX1234567', cdlState: 'TX', medCardExpiration: '' },
    carriers: [{ carrierName: 'Acme Trucking', usdotNumber: '123456' }],
    violations: [{ description: 'Speeding', source: 'psp' }],
    unreadable: ['medical'],
});

/** What a medical-card vision read comes back as: one field, everything else empty. */
const MEDICAL_VISION_PASS = Object.freeze({
    driver: {},
    license: { medCardExpiration: '2027-04-30' },
    carriers: [],
    violations: [],
    unreadable: [],
});

describe('merging the vision pass into the text pass', () => {
    it('keeps the carriers the readable report produced', () => {
        const merged = mergeExtractionResults(TEXT_PASS, MEDICAL_VISION_PASS);

        expect(merged.carriers).toHaveLength(1);
        expect(merged.carriers[0].carrierName).toBe('Acme Trucking');
    });

    it('keeps the violations, the driver and the licence', () => {
        const merged = mergeExtractionResults(TEXT_PASS, MEDICAL_VISION_PASS);

        expect(merged.violations).toHaveLength(1);
        expect(merged.driver.firstName).toBe('Dana');
        expect(merged.license.cdlNumber).toBe('TX1234567');
    });

    it('takes the value the second pass actually read', () => {
        const merged = mergeExtractionResults(TEXT_PASS, MEDICAL_VISION_PASS);

        expect(merged.license.medCardExpiration).toBe('2027-04-30');
    });

    it('lets the second pass correct a value the first pass got from garbage', () => {
        // A document only reaches the second pass because the model said its text
        // was unreadable — and OCR fails by producing plausible nonsense. So a
        // value the first pass reported for that document is the one not to trust.
        const merged = mergeExtractionResults(
            { ...TEXT_PASS, license: { ...TEXT_PASS.license, medCardExpiration: '2019-01-01' } },
            MEDICAL_VISION_PASS,
        );

        expect(merged.license.medCardExpiration).toBe('2027-04-30');
    });

    it('joins the lists when the second pass re-read a report', () => {
        const merged = mergeExtractionResults(TEXT_PASS, {
            ...MEDICAL_VISION_PASS,
            carriers: [{ carrierName: 'Blue Line Freight', usdotNumber: '654321' }],
            violations: [{ description: 'Logbook', source: 'psp' }],
        });

        // Duplicates are the expected cost of joining, and `applyExtractedFields`
        // checks each incoming row against the ones already on the application.
        expect(merged.carriers).toHaveLength(2);
        expect(merged.violations).toHaveLength(2);
    });

    it('keeps the first pass\'s record of what it could not read', () => {
        const merged = mergeExtractionResults(TEXT_PASS, MEDICAL_VISION_PASS);

        expect(merged.unreadable).toEqual(['medical']);
    });

    it('survives a missing or empty pass on either side', () => {
        expect(mergeExtractionResults(TEXT_PASS, null).carriers).toHaveLength(1);
        expect(mergeExtractionResults(null, MEDICAL_VISION_PASS).license.medCardExpiration).toBe('2027-04-30');
        expect(mergeExtractionResults(null, null)).toEqual({
            driver: {}, license: {}, carriers: [], violations: [], unreadable: [],
        });
    });
});
