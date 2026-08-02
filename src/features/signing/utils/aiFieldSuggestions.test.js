// AI Field Assistant suggestion vocabulary, validation and application rules.
// Every suggestion, field and label below is artificial.
import { describe, expect, it } from 'vitest';
import {
    HIGH_CONFIDENCE_THRESHOLD,
    MANUAL_REVIEW_KINDS,
    SEMANTIC_FIELD_MAP,
    SUPPORTED_BINDING_KEYS,
    SUPPORTED_FIELD_TYPES,
    applySuggestionsToFields,
    buildSuggestionSet,
    normalizeManualReview,
    normalizeSuggestion,
    overlapRatio,
    selectHighConfidence,
    templateIdForCategory,
} from './aiFieldSuggestions';
import { FIELD_TEMPLATES } from '../components/envelope-creator/fieldDefinitions';
import { BINDING_LABELS, buildPrefillContext } from './prefillEngine';

const suggestion = (overrides = {}) => ({
    category: 'signature',
    label: 'Sign here',
    required: true,
    confidence: 0.9,
    page: 1,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    ...overrides,
});

const ids = () => {
    let n = 0;
    return () => {
        n += 1;
        return `id-${n}`;
    };
};

describe('canonical vocabulary', () => {
    it('only maps to signer field types the editor already persists', () => {
        const produced = new Set(Object.values(SEMANTIC_FIELD_MAP).map((entry) => entry.type));
        for (const type of produced) {
            expect(SUPPORTED_FIELD_TYPES).toContain(type);
        }
        // The palette is the canonical source of persisted types.
        const paletteTypes = new Set(Object.values(FIELD_TEMPLATES).map((t) => t.type));
        for (const type of produced) {
            expect(paletteTypes.has(type)).toBe(true);
        }
    });

    it('only uses binding keys the prefill engine resolves', () => {
        const context = buildPrefillContext({
            recipientName: 'Artificial Person',
            recipientEmail: 'nobody@example.invalid',
            recipientPhone: '5550000000',
            companyName: 'Artificial Freight Co',
        });
        for (const entry of Object.values(SEMANTIC_FIELD_MAP)) {
            expect(SUPPORTED_BINDING_KEYS).toContain(entry.bindingKey);
            if (entry.bindingKey) {
                expect(Object.prototype.hasOwnProperty.call(context, entry.bindingKey)).toBe(true);
                expect(BINDING_LABELS[entry.bindingKey]).toBeTruthy();
            }
        }
    });

    it('maps the documented semantic fields to the documented bindings', () => {
        expect(SEMANTIC_FIELD_MAP.full_name.bindingKey).toBe('full_name');
        expect(SEMANTIC_FIELD_MAP.first_name.bindingKey).toBe('first_name');
        expect(SEMANTIC_FIELD_MAP.last_name.bindingKey).toBe('last_name');
        expect(SEMANTIC_FIELD_MAP.email.bindingKey).toBe('email');
        expect(SEMANTIC_FIELD_MAP.phone.bindingKey).toBe('phone');
        expect(SEMANTIC_FIELD_MAP.company.bindingKey).toBe('company_name');
        expect(SEMANTIC_FIELD_MAP.address.bindingKey).toBe('address');
        expect(SEMANTIC_FIELD_MAP.city.bindingKey).toBe('city');
        expect(SEMANTIC_FIELD_MAP.state.bindingKey).toBe('state');
        expect(SEMANTIC_FIELD_MAP.zip.bindingKey).toBe('zip');
        expect(SEMANTIC_FIELD_MAP.date.bindingKey).toBe('current_date');
    });

    it('backs every category with an existing palette template', () => {
        for (const category of Object.keys(SEMANTIC_FIELD_MAP)) {
            const templateId = templateIdForCategory(category);
            expect(FIELD_TEMPLATES[templateId]).toBeTruthy();
            expect(FIELD_TEMPLATES[templateId].type).toBe(SEMANTIC_FIELD_MAP[category].type);
        }
    });
});

describe('normalizeSuggestion', () => {
    it('rejects an unsupported category rather than inventing a field type', () => {
        expect(normalizeSuggestion(suggestion({ category: 'notary_seal' }))).toBeNull();
        expect(normalizeSuggestion(suggestion({ category: '' }))).toBeNull();
        expect(normalizeSuggestion(null)).toBeNull();
    });

    it('rejects non-finite and zero-size geometry', () => {
        expect(normalizeSuggestion(suggestion({ x: NaN }))).toBeNull();
        expect(normalizeSuggestion(suggestion({ y: 'top' }))).toBeNull();
        expect(normalizeSuggestion(suggestion({ width: 0 }))).toBeNull();
        expect(normalizeSuggestion(suggestion({ height: 0 }))).toBeNull();
        expect(normalizeSuggestion(suggestion({ width: 0.2 }))).toBeNull();
    });

    it('rejects an invalid page and honours the allowed-page set', () => {
        expect(normalizeSuggestion(suggestion({ page: 0 }))).toBeNull();
        expect(normalizeSuggestion(suggestion({ page: 1.5 }))).toBeNull();
        expect(normalizeSuggestion(suggestion({ page: 4 }), { allowedPages: new Set([1, 2]) })).toBeNull();
        expect(normalizeSuggestion(suggestion({ page: 2 }), { allowedPages: new Set([1, 2]) })).toBeTruthy();
    });

    it('clamps coordinates into 0-100 and keeps the box on the page', () => {
        const normalized = normalizeSuggestion(suggestion({ x: -30, y: -10, width: 200, height: 20 }));
        expect(normalized.x).toBe(0);
        expect(normalized.y).toBe(0);
        expect(normalized.x + normalized.width).toBeLessThanOrEqual(100);
    });

    it('drops a box that clamps down to nothing', () => {
        expect(normalizeSuggestion(suggestion({ x: 99.5, y: 10, width: 40, height: 5 }))).toBeNull();
    });

    it('clamps confidence and defaults a missing value to zero', () => {
        expect(normalizeSuggestion(suggestion({ confidence: 5 })).confidence).toBe(1);
        expect(normalizeSuggestion(suggestion({ confidence: -1 })).confidence).toBe(0);
        expect(normalizeSuggestion(suggestion({ confidence: 'sure' })).confidence).toBe(0);
    });

    it('falls back to the mapped binding when an unsupported one is supplied', () => {
        expect(normalizeSuggestion(suggestion({ category: 'email', bindingKey: 'ssn' })).bindingKey).toBe('email');
        expect(normalizeSuggestion(suggestion({ category: 'text', bindingKey: 'city' })).bindingKey).toBe('city');
    });

    it('treats an unknown source as a visual guess', () => {
        expect(normalizeSuggestion(suggestion({ source: 'telepathy' })).source).toBe('vision');
        expect(normalizeSuggestion(suggestion({ source: 'pdf' })).source).toBe('pdf');
    });

    it('starts every suggestion pending, never accepted', () => {
        expect(normalizeSuggestion(suggestion()).status).toBe('pending');
    });
});

describe('overlapRatio', () => {
    it('is zero for boxes on different pages', () => {
        expect(overlapRatio({ page: 1, x: 0, y: 0, width: 10, height: 10 }, { page: 2, x: 0, y: 0, width: 10, height: 10 })).toBe(0);
    });

    it('is zero for disjoint boxes and 1 for identical ones', () => {
        const a = { page: 1, x: 0, y: 0, width: 10, height: 10 };
        expect(overlapRatio(a, { page: 1, x: 50, y: 50, width: 10, height: 10 })).toBe(0);
        expect(overlapRatio(a, { ...a })).toBe(1);
    });
});

describe('buildSuggestionSet', () => {
    it('counts what it dropped', () => {
        const { suggestions, stats } = buildSuggestionSet({
            rawSuggestions: [suggestion(), suggestion({ category: 'bogus' }), suggestion({ width: 0 })],
            idFactory: ids(),
        });
        expect(suggestions).toHaveLength(1);
        expect(stats).toMatchObject({ received: 3, rejected: 2, kept: 1 });
    });

    it('prefers measured PDF geometry over a vision guess for the same blank', () => {
        const { suggestions, stats } = buildSuggestionSet({
            rawSuggestions: [
                suggestion({ source: 'vision', confidence: 0.99, label: 'Guess' }),
                suggestion({ source: 'pdf', confidence: 0.5, label: 'Measured' }),
            ],
            idFactory: ids(),
        });
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].label).toBe('Measured');
        expect(stats.duplicates).toBe(1);
    });

    it('keeps distinct blanks of the same category', () => {
        const { suggestions } = buildSuggestionSet({
            rawSuggestions: [suggestion(), suggestion({ y: 60 })],
            idFactory: ids(),
        });
        expect(suggestions).toHaveLength(2);
    });

    it('flags a suggestion that lands on an existing manual field', () => {
        const { suggestions } = buildSuggestionSet({
            rawSuggestions: [suggestion()],
            existingFields: [{ id: 'manual-1', label: 'My signature', page: 1, x: 10, y: 10, width: 25, height: 5 }],
            idFactory: ids(),
        });
        expect(suggestions[0].overlapsFieldId).toBe('manual-1');
        expect(suggestions[0].overlapsFieldLabel).toBe('My signature');
    });

    it('does not flag a suggestion that merely sits nearby', () => {
        const { suggestions } = buildSuggestionSet({
            rawSuggestions: [suggestion()],
            existingFields: [{ id: 'manual-1', page: 1, x: 70, y: 70, width: 10, height: 5 }],
            idFactory: ids(),
        });
        expect(suggestions[0].overlapsFieldId).toBeUndefined();
    });
});

describe('normalizeManualReview', () => {
    it('keeps only known kinds and attaches an explanation', () => {
        const entry = normalizeManualReview({ kind: 'radio_group', page: 2, detail: 'Marital status' });
        expect(entry.kind).toBe('radio_group');
        expect(entry.message).toMatch(/mutually exclusive/i);
        expect(normalizeManualReview({ kind: 'hologram', page: 1 })).toBeNull();
        expect(normalizeManualReview(null)).toBeNull();
    });

    it('has an explanation for every documented kind', () => {
        for (const kind of MANUAL_REVIEW_KINDS) {
            expect(normalizeManualReview({ kind, page: 1, detail: '' }).message).toBeTruthy();
        }
    });
});

describe('applySuggestionsToFields', () => {
    const existing = [{ id: 'manual-1', type: 'text', label: 'Kept', page: 1, x: 5, y: 5, width: 10, height: 5 }];

    it('appends without touching existing manual fields', () => {
        const { fields, previousFields, appended } = applySuggestionsToFields({
            fields: existing,
            suggestions: [normalizeSuggestion(suggestion({ category: 'email' }), { idFactory: ids() })],
            idFactory: ids(),
        });

        expect(fields).toHaveLength(2);
        expect(fields[0]).toBe(existing[0]);
        expect(previousFields).toBe(existing);
        expect(appended).toHaveLength(1);
    });

    it('produces a field shaped like a manually placed one', () => {
        const { appended } = applySuggestionsToFields({
            fields: [],
            suggestions: [normalizeSuggestion(suggestion({ category: 'full_name' }), { idFactory: ids() })],
            idFactory: ids(),
        });

        expect(appended[0]).toMatchObject({
            type: 'text',
            bindingKey: 'full_name',
            defaultValue: '{{full_name}}',
            prefillPolicy: 'editable',
            readOnly: false,
            fontSize: 'Auto',
            placedByAi: true,
        });
    });

    it('never marks an AI-placed field locked, even for a locked-by-default template', () => {
        const { appended } = applySuggestionsToFields({
            fields: [],
            // date_signed is `locked` in the palette; an unreviewed lock would
            // block the send on missing prefill data.
            suggestions: [normalizeSuggestion(suggestion({ category: 'date' }), { idFactory: ids() })],
            idFactory: ids(),
        });
        expect(FIELD_TEMPLATES.date_signed.prefillPolicy).toBe('locked');
        expect(appended[0].prefillPolicy).toBe('editable');
        expect(appended[0].readOnly).toBe(false);
    });

    it('carries the reviewed geometry and label, not the palette defaults', () => {
        const reviewed = normalizeSuggestion(
            suggestion({ category: 'text', label: 'Trailer number', x: 12, y: 34, width: 22, height: 4 }),
            { idFactory: ids() },
        );
        const { appended } = applySuggestionsToFields({ fields: [], suggestions: [reviewed], idFactory: ids() });
        expect(appended[0]).toMatchObject({ label: 'Trailer number', x: 12, y: 34, width: 22, height: 4 });
    });

    it('gives every applied field a unique id', () => {
        const { appended } = applySuggestionsToFields({
            fields: [],
            suggestions: [
                normalizeSuggestion(suggestion(), { idFactory: ids() }),
                normalizeSuggestion(suggestion({ y: 50 }), { idFactory: ids() }),
            ],
            idFactory: ids(),
        });
        expect(new Set(appended.map((f) => f.id)).size).toBe(2);
    });
});

describe('selectHighConfidence', () => {
    const build = (overrides) => normalizeSuggestion(suggestion(overrides), { idFactory: ids() });

    it('takes only confident, non-overlapping, non-rejected suggestions', () => {
        const confident = build({ confidence: 0.95 });
        const unsure = build({ confidence: 0.4, y: 30 });
        const rejected = { ...build({ confidence: 0.99, y: 50 }), status: 'rejected' };
        const overlapping = { ...build({ confidence: 0.99, y: 70 }), overlapsFieldId: 'manual-1' };

        const selected = selectHighConfidence([confident, unsure, rejected, overlapping]);
        expect(selected).toEqual([confident]);
    });

    it('uses a threshold that excludes a coin-flip guess', () => {
        expect(HIGH_CONFIDENCE_THRESHOLD).toBeGreaterThan(0.5);
        expect(selectHighConfidence([build({ confidence: HIGH_CONFIDENCE_THRESHOLD })])).toHaveLength(1);
        expect(selectHighConfidence([build({ confidence: HIGH_CONFIDENCE_THRESHOLD - 0.01 })])).toHaveLength(0);
    });
});
