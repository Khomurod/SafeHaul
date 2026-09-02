// src/config/applicationRules.test.js
//
// Three things are asserted here:
//
//   1. The browser copy's behaviour, through the vectors the server suite runs.
//   2. PARITY with the server. `applicationRules.js` / `applicationDates.js` and
//      their `functions/shared/` twins deploy in different bundles, so they are
//      separate files; the body between the markers must be byte-identical, and
//      both copies must return the same answer for every vector. Drift here means
//      a step lets an applicant continue into a submission the server refuses —
//      or the reverse — which is the defect this test exists to catch.
//   3. Helpers the wizard leans on: option filtering, vehicle wording, the
//      section-table adjustments.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import vectors from '../../functions/shared/applicationRules.vectors.json';
import {
    APPLICATION_RULES_CATALOG,
    applyRulesToSections,
    dateStatus,
    defaultApplicationRules,
    evaluateApplicationRules,
    isExperienceOptionOffered,
    issuesForStep,
    normalizeApplicationAnswers,
    parseApplicationDate,
    resolveApplicationRules,
    visibleVehicleCategories,
} from './applicationRules';
import STANDARD_SECTIONS from '../../functions/shared/applicationSections.json';
import { EXPERIENCE_OPTIONS } from './form-options';

const require = createRequire(import.meta.url);
const server = require('../../functions/shared/applicationRules.js');

const resolveFixtures = (formData) => Object.fromEntries(
    Object.entries(formData || {}).map(([key, value]) => [key, value === '$fullHistory' ? vectors.fullHistory : value]),
);

const bodyOf = (path) => {
    const source = readFileSync(resolve(__dirname, path), 'utf8');
    const start = source.indexOf('// --- body ---');
    const end = source.indexOf('// --- exports ---');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // The marker line names the other file; everything after it must match.
    return source.slice(start, end).split('\n').slice(2).join('\n');
};

describe('parity with functions/shared', () => {
    it('applicationRules.js has the same body as the server copy', () => {
        expect(bodyOf('./applicationRules.js')).toBe(bodyOf('../../functions/shared/applicationRules.js'));
    });

    it('applicationDates.js has the same body as the server copy', () => {
        expect(bodyOf('./applicationDates.js')).toBe(bodyOf('../../functions/shared/applicationDates.js'));
    });

    it.each(vectors.evaluate.map((vector) => [vector.name, vector]))('agrees with the server on: %s', (_name, vector) => {
        const input = {
            rules: vector.rules,
            applicationConfig: vector.applicationConfig,
            formData: resolveFixtures(vector.formData),
            today: vector.today || vectors.today,
        };
        expect(evaluateApplicationRules(input)).toEqual(server.evaluateApplicationRules(input));
    });

    it('agrees with the server on the catalog defaults', () => {
        expect(defaultApplicationRules()).toEqual(server.defaultApplicationRules());
    });
});

describe('evaluateApplicationRules (shared vectors)', () => {
    it.each(vectors.evaluate.map((vector) => [vector.name, vector]))('%s', (_name, vector) => {
        const result = evaluateApplicationRules({
            rules: vector.rules,
            applicationConfig: vector.applicationConfig,
            formData: resolveFixtures(vector.formData),
            today: vector.today || vectors.today,
        });
        expect(result.blocking.map((issue) => issue.code)).toEqual(vector.blocking);
        expect(result.warnings.map((issue) => issue.code)).toEqual(vector.warnings);
    });

    it('routes each issue to the page that collects the answer', () => {
        const worst = vectors.evaluate[vectors.evaluate.length - 1];
        const result = evaluateApplicationRules({ rules: worst.rules, formData: worst.formData, today: vectors.today });
        expect(issuesForStep(result, 'contact').map((i) => i.code)).toEqual(['previous-address-required']);
        expect(issuesForStep(result, 'license').map((i) => i.code))
            .toEqual(['expired-cdlExpiration', 'expired-medCardExpiration', 'previous-license-details-required']);
        expect(issuesForStep(result, 'violations').map((i) => i.code))
            .toEqual(['mvr-authorization-required', 'violation-details-required']);
        expect(issuesForStep(result, 'accidents').map((i) => i.code)).toEqual(['accident-details-required']);
        expect(issuesForStep(result, 'general').map((i) => i.code)).toEqual(['felony-explanation-required']);
    });

    it('re-evaluates from the answers alone, so changing an answer back and forth changes the verdict', () => {
        const rules = { requireViolationDetails: true };
        const yes = evaluateApplicationRules({ rules, formData: { 'has-violations': 'yes', employers: vectors.fullHistory }, today: vectors.today });
        const no = evaluateApplicationRules({ rules, formData: { 'has-violations': 'no', violations: [{ date: 'junk' }], employers: vectors.fullHistory }, today: vectors.today });
        expect(yes.blocking.map((i) => i.code)).toEqual(['violation-details-required']);
        // Switching to No drops the leftover rows, junk date included.
        expect(no.blocking).toEqual([]);
    });
});

describe('normalizeApplicationAnswers and dates (shared vectors)', () => {
    it.each(vectors.normalize.map((vector) => [vector.name, vector]))('%s', (_name, vector) => {
        const normalized = normalizeApplicationAnswers(vector.formData);
        for (const [key, expected] of Object.entries(vector.expect)) {
            expect(normalized[key] ?? null).toEqual(expected);
        }
    });

    it.each(vectors.dates.map((vector) => [vector.input, vector]))('parses %p', (_input, vector) => {
        expect(parseApplicationDate(vector.input)?.iso ?? null).toBe(vector.iso);
    });

    it.each(vectors.status.map((vector) => [vector.input, vector]))('judges %p', (_input, vector) => {
        expect(dateStatus(vector.input, vector.today)).toBe(vector.status);
    });
});

describe('what the wizard leans on', () => {
    it('offers every experience option until a company hides one', () => {
        for (const option of EXPERIENCE_OPTIONS) {
            expect(isExperienceOptionOffered({}, option.value)).toBe(true);
        }
        expect(isExperienceOptionOffered({ experienceOptionsHidden: ['New'] }, 'New')).toBe(false);
        expect(isExperienceOptionOffered({ experienceOptionsHidden: ['New'] }, '5+')).toBe(true);
    });

    it('the catalog experience set and the form options name the same values', () => {
        expect(APPLICATION_RULES_CATALOG.optionSets.experienceYears)
            .toEqual(EXPERIENCE_OPTIONS.map((option) => option.value));
    });

    it('shows the three historical vehicle categories by default, with company wording on request', () => {
        expect(visibleVehicleCategories({}).map((c) => c.id)).toEqual(['straightTruck', 'semiTrailer', 'twoTrailers']);
        // An explicit hidden list is the company's whole choice, which is how the
        // settings screen stores it — so 'other' is named here too.
        const renamed = visibleVehicleCategories({ vehicleExperienceHidden: ['twoTrailers', 'other'], vehicleExperienceLabels: { straightTruck: 'Box Truck' } });
        expect(renamed.map((c) => c.label)).toEqual(['Box Truck', 'Tractor + Semi Trailer']);
        // The saved keys never change, whatever the wording.
        expect(renamed[0].milesField).toBe('expStraightTruckMiles');
    });

    it('every vehicle category field exists in the shared table', () => {
        const ids = new Set(STANDARD_SECTIONS.flatMap((s) => s.fields.map((f) => f.id)));
        for (const category of APPLICATION_RULES_CATALOG.optionSets.vehicleCategories) {
            if (category.id === 'other') continue; // hidden by default; collected only when a company shows it
            expect(ids.has(category.milesField)).toBe(true);
            expect(ids.has(category.expField)).toBe(true);
        }
    });

    it('leaves every non-vehicle field of the table untouched', () => {
        const adjusted = applyRulesToSections(STANDARD_SECTIONS, { vehicleExperienceLabels: { semiTrailer: 'Big rig' } });
        const untouched = adjusted.filter((s) => s.id !== 'experience');
        expect(untouched).toEqual(STANDARD_SECTIONS.filter((s) => s.id !== 'experience'));
    });

    it('every catalog rule has a plain-language label and a default', () => {
        for (const rule of APPLICATION_RULES_CATALOG.rules) {
            expect(rule.label.length).toBeGreaterThan(10);
            expect(rule).toHaveProperty('default');
            expect(resolveApplicationRules({})[rule.id]).toEqual(rule.default);
        }
    });
});
