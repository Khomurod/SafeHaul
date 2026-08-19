/**
 * The browser half of "a resumed application must still carry every required
 * answer".
 *
 * Two properties matter more than any single case here:
 *
 *   1. **The list is derived, not written.** If a field stops being persisted, or
 *      the schema gains a never-persisted gated field, this check has to cover it
 *      without anyone remembering to edit it. The first two tests fail loudly if
 *      that coupling is broken.
 *   2. **The two runtimes must agree.** The wizard tells the applicant what is
 *      missing; the server refuses the submission. If those disagree, the
 *      applicant is either blocked on something the server would accept, or shown
 *      a green path to a submission the server rejects. The parity test compares
 *      the browser resolver against the real Cloud Functions one, on the same
 *      configurations.
 */
import { describe, it, expect } from 'vitest';
import STANDARD_SECTIONS from '../../../../../functions/shared/applicationSections.json';
import { NEVER_STORED } from './applicationDraftStorage';
import {
    getMissingRequiredUnpersistedFields,
    NEVER_STORED_FIELD_STEP,
} from './requiredUnpersistedFields';

// The Cloud Functions modules, required directly: the point is to compare against
// what actually runs on the server, not against a copy of it.
const serverDraft = require('../../../../../functions/shared/applicationDraft.js');
const serverDoc = require('../../../../../functions/shared/buildApplicationDoc.js');

/** Fields that are both never persisted and gated — the whole population here. */
const neverStoredGatedFields = STANDARD_SECTIONS
    .flatMap((section) => section.fields || [])
    .filter((field) => field.gate && NEVER_STORED.includes(field.id));

describe('requiredUnpersistedFields', () => {
    describe('derivation', () => {
        it('keeps the browser and server strip lists identical', () => {
            // Not cosmetic: the browser decides what to re-ask for and the server
            // decides what to refuse. Diverging lists mean one of them is wrong
            // about which values a draft can bring back.
            expect([...NEVER_STORED].sort()).toEqual([...serverDraft.NEVER_STORED].sort());
        });

        it('records the collecting step for every never-persisted gated field', () => {
            // The guard that keeps `NEVER_STORED_FIELD_STEP` honest. Adding a
            // never-persisted gated field to the schema fails here until whoever
            // added it records which wizard page asks for it — otherwise the
            // applicant is routed to a page that does not collect their field.
            const unmapped = neverStoredGatedFields
                .map((field) => field.id)
                .filter((id) => !NEVER_STORED_FIELD_STEP[id]);
            expect(unmapped).toEqual([]);
        });

        it('covers the SSN, which is the field this exists for', () => {
            // A canary for the derivation itself: if a refactor made the schema
            // walk silently produce nothing, every other test would still pass
            // because "nothing is missing" is also the happy answer.
            expect(neverStoredGatedFields.map((field) => field.id)).toContain('ssn');
        });
    });

    describe('what it reports', () => {
        it('reports a missing SSN with its label and collecting step', () => {
            expect(getMissingRequiredUnpersistedFields({}, {})).toEqual([
                { id: 'ssn', label: 'Social Security Number', semanticStep: 'contact' },
            ]);
        });

        it.each([
            ['undefined', undefined],
            ['null', null],
            ['an empty string', ''],
            ['whitespace', '   '],
        ])('treats %s as missing', (_label, value) => {
            expect(getMissingRequiredUnpersistedFields({}, { ssn: value }))
                .toHaveLength(1);
        });

        it('reports nothing when the value is present', () => {
            expect(getMissingRequiredUnpersistedFields({}, { ssn: '123-45-6789' })).toEqual([]);
        });

        it('reports nothing when the company marks the field optional', () => {
            expect(getMissingRequiredUnpersistedFields({ ssn: { required: false } }, {})).toEqual([]);
        });

        it('reports nothing when the company hides the field', () => {
            expect(getMissingRequiredUnpersistedFields({ ssn: { hidden: true } }, {})).toEqual([]);
        });

        it('lets hidden beat required, so no configuration is unsubmittable', () => {
            const config = { ssn: { hidden: true, required: true } };
            expect(getMissingRequiredUnpersistedFields(config, {})).toEqual([]);
        });

        it('reports the field when the company explicitly requires it', () => {
            const config = { ssn: { hidden: false, required: true } };
            expect(getMissingRequiredUnpersistedFields(config, {})).toHaveLength(1);
        });

        it('does not report the signature, which has its own gate in the wizard', () => {
            // `signature` is never persisted either, but it is not a gated schema
            // field: it is collected on the consent step and already blocked
            // there and on the server. It must not appear here as well, or the
            // applicant would be sent to page one for it.
            const missing = getMissingRequiredUnpersistedFields({}, { ssn: '1' });
            expect(missing.map((field) => field.id)).not.toContain('signature');
        });

        it.each([
            ['undefined form data', undefined],
            ['null form data', null],
            ['a non-object', 'nonsense'],
        ])('tolerates %s without throwing', (_label, formData) => {
            expect(() => getMissingRequiredUnpersistedFields({}, formData)).not.toThrow();
        });

        it('tolerates a missing company config by falling back to the defaults', () => {
            // A profile that has never been configured resolves to
            // GATE_DEFAULT_REQUIRED, where the SSN is required.
            expect(getMissingRequiredUnpersistedFields(undefined, {})).toHaveLength(1);
        });
    });

    describe('parity with the server enforcement', () => {
        const CONFIGS = [
            ['unconfigured', undefined],
            ['empty', {}],
            ['explicitly required', { ssn: { hidden: false, required: true } }],
            ['optional', { ssn: { hidden: false, required: false } }],
            ['hidden', { ssn: { hidden: true } }],
            ['hidden and required', { ssn: { hidden: true, required: true } }],
        ];

        it.each(CONFIGS)('agrees with the server on a blank value (%s)', (_label, config) => {
            const browser = getMissingRequiredUnpersistedFields(config, {});
            const server = serverDoc.getMissingRequiredUnpersistedFields(config, {});
            expect(browser.map((field) => field.label)).toEqual(server);
        });

        it.each(CONFIGS)('agrees with the server on a supplied value (%s)', (_label, config) => {
            const formData = { ssn: '123-45-6789' };
            const browser = getMissingRequiredUnpersistedFields(config, formData);
            const server = serverDoc.getMissingRequiredUnpersistedFields(config, formData);
            expect(browser.map((field) => field.label)).toEqual(server);
            expect(server).toEqual([]);
        });
    });
});
