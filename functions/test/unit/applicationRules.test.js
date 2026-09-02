/**
 * Application Rules — the server copy, driven by the shared vectors.
 *
 * `src/config/applicationRules.test.js` runs the same vectors through the
 * browser copy and compares the two bodies byte for byte, so a change to either
 * file without the other fails somewhere.
 */
const vectors = require('../../shared/applicationRules.vectors.json');
const rules = require('../../shared/applicationRules');
const dates = require('../../shared/applicationDates');

const resolveFixtures = (formData) => Object.fromEntries(
    Object.entries(formData || {}).map(([key, value]) => [key, value === '$fullHistory' ? vectors.fullHistory : value]),
);

describe('evaluateApplicationRules (shared vectors)', () => {
    it.each(vectors.evaluate.map((vector) => [vector.name, vector]))('%s', (_name, vector) => {
        const result = rules.evaluateApplicationRules({
            rules: vector.rules,
            applicationConfig: vector.applicationConfig,
            formData: resolveFixtures(vector.formData),
            today: vector.today || vectors.today,
        });
        expect(result.blocking.map((issue) => issue.code)).toEqual(vector.blocking);
        expect(result.warnings.map((issue) => issue.code)).toEqual(vector.warnings);
    });

    it('every issue names a wizard step and a field, and carries a sentence', () => {
        const worst = vectors.evaluate[vectors.evaluate.length - 1];
        const result = rules.evaluateApplicationRules({ rules: worst.rules, formData: worst.formData, today: vectors.today });
        for (const issue of result.issues) {
            expect(['contact', 'qualifications', 'license', 'violations', 'accidents', 'employment', 'general']).toContain(issue.semanticStep);
            expect(typeof issue.fieldId).toBe('string');
            expect(issue.message).toMatch(/[.!]$/);
        }
    });
});

describe('normalizeApplicationAnswers (shared vectors)', () => {
    it.each(vectors.normalize.map((vector) => [vector.name, vector]))('%s', (_name, vector) => {
        const normalized = rules.normalizeApplicationAnswers(vector.formData);
        for (const [key, expected] of Object.entries(vector.expect)) {
            expect(normalized[key] ?? null).toEqual(expected);
        }
    });

    it('does not mutate the answers it is given', () => {
        const input = { 'has-violations': 'no', violations: [{ date: '2025-01-01' }] };
        rules.normalizeApplicationAnswers(input);
        expect(input.violations).toHaveLength(1);
    });
});

describe('dates (shared vectors)', () => {
    it.each(vectors.dates.map((vector) => [vector.input, vector]))('parses %p', (_input, vector) => {
        const parsed = dates.parseApplicationDate(vector.input);
        expect(parsed ? parsed.iso : null).toBe(vector.iso);
    });

    it.each(vectors.status.map((vector) => [vector.input, vector]))('judges %p against today', (_input, vector) => {
        expect(dates.dateStatus(vector.input, vector.today)).toBe(vector.status);
    });
});

describe('resolveApplicationRules', () => {
    it('reproduces the pre-rules behaviour when nothing is configured', () => {
        expect(rules.resolveApplicationRules(undefined)).toEqual(rules.defaultApplicationRules());
        expect(rules.defaultApplicationRules()).toMatchObject({
            expiredCdl: 'allow',
            expiredMedicalCard: 'allow',
            mvrAuthorization: 'optional',
            employmentHistoryEnforcement: 'warn',
            employmentHistoryMinimumYears: 3,
            requireFelonyExplanation: false,
            hoursOfServiceStatement: 'off',
        });
    });

    it('refuses values the catalog does not permit', () => {
        const resolved = rules.resolveApplicationRules({
            expiredCdl: 'explode',
            employmentHistoryMinimumYears: 99,
            experienceOptionsHidden: ['New', 'not-an-option', 5],
            vehicleExperienceLabels: { straightTruck: '  Box truck ', bogus: 'x', semiTrailer: '' },
            mvrAuthorization: 'sometimes',
            unknownRule: true,
        });
        expect(resolved.expiredCdl).toBe('allow');
        expect(resolved.employmentHistoryMinimumYears).toBe(10);
        expect(resolved.experienceOptionsHidden).toEqual(['New']);
        expect(resolved.vehicleExperienceLabels).toEqual({ straightTruck: 'Box truck' });
        expect(resolved.mvrAuthorization).toBe('optional');
        expect(resolved).not.toHaveProperty('unknownRule');
    });

    it('treats an explicit empty hidden list as a choice, not as unset', () => {
        expect(rules.resolveApplicationRules({ vehicleExperienceHidden: [] }).vehicleExperienceHidden).toEqual([]);
        expect(rules.resolveApplicationRules({}).vehicleExperienceHidden).toEqual(['other']);
    });

    it('knows when a company has changed a rule', () => {
        expect(rules.isRuleConfigured({ expiredCdl: 'block' }, 'expiredCdl')).toBe(true);
        expect(rules.isRuleConfigured({ expiredCdl: 'allow' }, 'expiredCdl')).toBe(false);
        expect(rules.isRuleConfigured({}, 'expiredCdl')).toBe(false);
    });
});

describe('applyRulesToSections', () => {
    it('renames a vehicle category with the company wording and keeps the saved keys', () => {
        const sections = rules.applyRulesToSections(
            require('../../shared/applicationDefinition').STANDARD_SECTIONS,
            { vehicleExperienceLabels: { straightTruck: 'Box Truck' } },
        );
        const experience = sections.find((section) => section.id === 'experience');
        const miles = experience.fields.find((field) => field.id === 'expStraightTruckMiles');
        expect(miles.label).toBe('Box Truck — Miles Driven');
        expect(miles.presentWhenAnswered).toBe(false);
    });

    it('shows a hidden category only when it was answered', () => {
        const sections = rules.applyRulesToSections(
            require('../../shared/applicationDefinition').STANDARD_SECTIONS,
            { vehicleExperienceHidden: ['twoTrailers'] },
        );
        const experience = sections.find((section) => section.id === 'experience');
        expect(experience.fields.find((field) => field.id === 'expTwoTrailersExp').presentWhenAnswered).toBe(true);
        expect(experience.fields.find((field) => field.id === 'expSemiTrailerExp').presentWhenAnswered).toBe(false);
    });
});
