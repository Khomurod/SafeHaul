// src/config/applicationDefinition.test.js
//
// The browser resolves the application; the server freezes it into the preserved
// record and prints it into the PDF. If those two disagree about what a field is
// called, which column a row has, or whether a question was even asked, then the
// screen a driver confirms and the document a recruiter reads are describing
// different applications — and nothing would say so.
//
// The section TABLE is shared outright (`functions/shared/applicationSections.json`,
// imported by both), so drift there is impossible by construction. What this file
// asserts is that the two RESOLVERS agree about what to do with it, and that the
// browser's own presentation rules hold.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

import {
    STANDARD_SECTIONS,
    buildApplicationReview,
    buildRepeatingRows,
    formatAnswerForDisplay,
    wasPresented,
} from './applicationDefinition';

const require = createRequire(import.meta.url);
const serverDefinition = require('../../functions/shared/applicationDefinition.js');
const serverSnapshot = require('../../functions/shared/submissionSnapshot.js');

describe('the section table is genuinely shared', () => {
    it('is the identical object the server resolves', () => {
        expect(STANDARD_SECTIONS).toEqual(serverDefinition.STANDARD_SECTIONS);
    });

    it('declares columns for every repeating field, so no renderer has to guess', () => {
        const repeating = STANDARD_SECTIONS
            .flatMap((section) => section.fields)
            .filter((field) => field.repeating);

        expect(repeating.length).toBeGreaterThan(5);
        for (const field of repeating) {
            expect(Array.isArray(field.columns)).toBe(true);
            expect(field.columns.length).toBeGreaterThan(0);
            for (const column of field.columns) {
                expect(typeof column.id).toBe('string');
                expect(typeof column.label).toBe('string');
                expect(column.label.trim()).not.toBe('');
            }
        }
    });

    it('gives every field a human label, never an id standing in for one', () => {
        for (const section of STANDARD_SECTIONS) {
            expect(section.title.trim()).not.toBe('');
            for (const field of section.fields) {
                expect(field.label.trim()).not.toBe('');
                expect(field.label).not.toBe(field.id);
            }
        }
    });
});

describe('the two resolvers agree', () => {
    const FORM = {
        firstName: 'Ada', lastName: 'Driver', ssn: '123-45-6789', dob: '1990-01-01',
        street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701',
        'has-twic': 'yes', twicExpiration: '2030-06-01',
        'has-felony': 'no',
        employers: [{ companyName: 'Acme Freight', position: 'Driver', startDate: '2020-01', endDate: '2024-01' }],
        'cdl-front': { name: 'front.jpg' },
    };

    /** Every displayable answer the server froze, as `label → value`. */
    const serverAnswers = (applicationConfig) => {
        const definition = serverDefinition.buildApplicationDefinition({
            company: { companyName: 'Acme', applicationConfig },
        });
        const sections = serverSnapshot.buildSections(definition, FORM);
        const out = {};
        for (const section of sections) {
            for (const answer of section.answers) {
                if (!answer.presented || answer.repeating) continue;
                out[answer.label] = answer.displayValue;
            }
        }
        return out;
    };

    /** The same, from the browser. */
    const browserAnswers = (applicationConfig) => {
        const { sections } = buildApplicationReview({ applicationConfig, formData: FORM });
        const out = {};
        for (const section of sections) {
            for (const answer of section.answers) {
                if (answer.repeating) continue;
                out[answer.label] = answer.isMissing ? null : answer.value;
            }
        }
        return out;
    };

    it('produces the same labelled values for the default configuration', () => {
        expect(browserAnswers({})).toEqual(serverAnswers({}));
    });

    it('produces the same labelled values when a company hides questions', () => {
        const config = { ssn: { hidden: true }, addressHistory: { hidden: true } };
        expect(browserAnswers(config)).toEqual(serverAnswers(config));
    });

    it('resolves repeating rows identically', () => {
        const definition = serverDefinition.buildApplicationDefinition({ company: { applicationConfig: {} } });
        const employers = serverDefinition.visibleFields(definition).find((f) => f.id === 'employers');
        expect(buildRepeatingRows(FORM.employers, employers.columns))
            .toEqual(serverSnapshot.buildRepeatingRows(FORM.employers, employers.columns));
    });

    it('formats dates, files, lists and yes/no identically', () => {
        const cases = [
            ['2026-07-14', { type: 'date' }],
            ['2026-07', { type: 'date' }],
            ['companies/c/a/guest_uploads/9ab-cdl.jpg?token=x', { type: 'file' }],
            [{ name: 'medcard.pdf' }, { type: 'file' }],
            [['H', 'N'], {}],
            ['yes', {}],
            ['NO', {}],
            ['', {}],
            [null, {}],
        ];
        for (const [value, field] of cases) {
            expect(formatAnswerForDisplay(value, field))
                .toEqual(serverSnapshot.formatAnswerForDisplay(value, field));
        }
    });

    it('agrees about whether a conditional question was presented', () => {
        const field = { id: 'twicExpiration', dependsOn: { field: 'has-twic', equals: 'yes' } };
        for (const data of [{ 'has-twic': 'yes' }, { 'has-twic': 'no' }, {}, { 'has-twic': 'YES' }]) {
            expect(wasPresented(field, data)).toBe(serverSnapshot.wasPresented(field, data));
        }
    });

    it('agrees about a field only some intake paths collect', () => {
        const field = { id: 'businessName', presentWhenAnswered: true };
        for (const data of [{}, { businessName: '' }, { businessName: 'Acme LLC' }]) {
            expect(wasPresented(field, data)).toBe(serverSnapshot.wasPresented(field, data));
        }
    });
});

describe('buildApplicationReview', () => {
    it('omits a hidden question rather than showing it unanswered', () => {
        const { sections } = buildApplicationReview({
            applicationConfig: { ssn: { hidden: true } },
            formData: { firstName: 'Ada', ssn: '123-45-6789' },
        });
        const labels = sections.flatMap((s) => s.answers.map((a) => a.label));
        expect(labels).not.toContain('Social Security Number');
    });

    it('drops a section that ends up with nothing in it', () => {
        const { sections } = buildApplicationReview({ applicationConfig: {}, formData: {} });
        for (const section of sections) {
            expect(section.answers.length).toBeGreaterThan(0);
        }
    });

    it('never returns a raw object as a value', () => {
        const { sections } = buildApplicationReview({
            applicationConfig: {},
            formData: { employers: [{ companyName: 'Acme' }] },
        });
        for (const section of sections) {
            for (const answer of section.answers) {
                if (answer.repeating) continue;
                expect(typeof answer.value).toBe('string');
            }
        }
    });

    it('describes a custom question with no wording instead of printing its id', () => {
        const { customAnswers } = buildApplicationReview({
            applicationConfig: {},
            formData: { customAnswers: { 'a-uuid': 'Yes' } },
            customQuestions: [{ id: 'a-uuid', type: 'shortAnswer' }],
        });
        expect(customAnswers[0].label).toBe('Question wording not recorded');
        expect(customAnswers[0].labelUnavailable).toBe(true);
        // `key` is React identity and is never rendered; everything a human
        // reads must be free of the id.
        expect(customAnswers[0].label).not.toMatch(/a-uuid/);
        expect(customAnswers[0].value).not.toMatch(/a-uuid/);
    });

    it('marks an unanswered custom question as missing rather than blank', () => {
        const { customAnswers } = buildApplicationReview({
            applicationConfig: {},
            formData: {},
            customQuestions: [{ id: 'q1', label: 'Why apply?' }],
        });
        expect(customAnswers[0]).toMatchObject({ label: 'Why apply?', value: 'Not provided', isMissing: true });
    });
});
