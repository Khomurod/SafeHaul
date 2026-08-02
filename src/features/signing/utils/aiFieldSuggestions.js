/**
 * AI Field Assistant — suggestion vocabulary, validation and application rules.
 *
 * Everything here is pure. Suggestions live in their own array and only become
 * real `fields` through `applySuggestionsToFields`, which never deletes,
 * overwrites or reorders a manually placed field.
 *
 * The semantic vocabulary MIRRORS `functions/shared/edocFieldSemantics.js`; the
 * two live on opposite sides of a deployment boundary and cannot import each
 * other. The persisted `type` and `bindingKey` values below are taken from the
 * canonical sources — FIELD_TEMPLATES (fieldDefinitions.jsx) and the prefill
 * engine's binding keys — and `aiFieldSuggestions.test.js` asserts that.
 */

import { FIELD_TEMPLATES } from '../components/envelope-creator/fieldDefinitions';

/** Persisted signer field types. No new type may ever be introduced here. */
export const SUPPORTED_FIELD_TYPES = Object.freeze(['signature', 'initial', 'date', 'text', 'checkbox']);

/**
 * Semantic category → persisted field. `type` and `bindingKey` are the contract
 * with the signing room, sealer, serializer and prefill engine.
 */
export const SEMANTIC_FIELD_MAP = Object.freeze({
    signature: { type: 'signature', bindingKey: '', label: 'Signature', required: true, defaultWidth: 25, defaultHeight: 5 },
    initials: { type: 'initial', bindingKey: '', label: 'Initial', required: true, defaultWidth: 15, defaultHeight: 4 },
    full_name: { type: 'text', bindingKey: 'full_name', label: 'Full name', required: true, defaultWidth: 30, defaultHeight: 5 },
    first_name: { type: 'text', bindingKey: 'first_name', label: 'First name', required: true, defaultWidth: 20, defaultHeight: 5 },
    last_name: { type: 'text', bindingKey: 'last_name', label: 'Last name', required: true, defaultWidth: 20, defaultHeight: 5 },
    date: { type: 'date', bindingKey: 'current_date', label: 'Date signed', required: true, defaultWidth: 20, defaultHeight: 5 },
    email: { type: 'text', bindingKey: 'email', label: 'Email', required: true, defaultWidth: 30, defaultHeight: 5 },
    phone: { type: 'text', bindingKey: 'phone', label: 'Phone', required: false, defaultWidth: 25, defaultHeight: 5 },
    company: { type: 'text', bindingKey: 'company_name', label: 'Company', required: false, defaultWidth: 30, defaultHeight: 5 },
    address: { type: 'text', bindingKey: 'address', label: 'Address', required: false, defaultWidth: 35, defaultHeight: 5 },
    city: { type: 'text', bindingKey: 'city', label: 'City', required: false, defaultWidth: 20, defaultHeight: 5 },
    state: { type: 'text', bindingKey: 'state', label: 'State', required: false, defaultWidth: 10, defaultHeight: 5 },
    zip: { type: 'text', bindingKey: 'zip', label: 'ZIP code', required: false, defaultWidth: 12, defaultHeight: 5 },
    checkbox: { type: 'checkbox', bindingKey: '', label: 'Checkbox', required: false, defaultWidth: 4, defaultHeight: 3 },
    text: { type: 'text', bindingKey: '', label: 'Text', required: false, defaultWidth: 30, defaultHeight: 5 },
});

export const SEMANTIC_CATEGORIES = Object.freeze(Object.keys(SEMANTIC_FIELD_MAP));

/** Binding keys the prefill engine can resolve. `''` means "no binding". */
export const SUPPORTED_BINDING_KEYS = Object.freeze([
    '',
    'full_name',
    'first_name',
    'last_name',
    'email',
    'phone',
    'company_name',
    'address',
    'city',
    'state',
    'zip',
    'current_date',
]);

/** Structures the signer field model cannot represent losslessly. */
export const MANUAL_REVIEW_KINDS = Object.freeze([
    'radio_group',
    'dropdown',
    'multiline',
    'repeating_rows',
    'table',
]);

export const MANUAL_REVIEW_MESSAGES = Object.freeze({
    radio_group:
        'Single-choice (radio) group — the signer field model has no mutually exclusive group. Plain checkboxes would let the signer tick more than one. Place these by hand.',
    dropdown: 'Dropdown / select list — not a supported signer field. Place a text field by hand if a free answer is acceptable.',
    multiline: 'Multi-line free-text area — supported text fields are single-line. Review the size by hand.',
    repeating_rows: 'Repeating rows — each row needs its own fields. Review by hand.',
    table: 'Complex table — cell placement is not reliable. Review by hand.',
});

/** Confidence at or above which a suggestion counts as "high confidence". */
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;

/** Smallest usable field, in page percent. Mirrors the backend's floor. */
export const MIN_FIELD_WIDTH_PCT = 1.5;
export const MIN_FIELD_HEIGHT_PCT = 1;

/** Fraction of overlap above which a suggestion is flagged against a field. */
export const OVERLAP_FLAG_RATIO = 0.35;

const toFiniteNumber = (value) => {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : null;
};

const clampPercent = (value) => {
    const num = toFiniteNumber(value);
    if (num === null) return null;
    return Math.min(100, Math.max(0, num));
};

const normalizeText = (value) => (value === null || value === undefined ? '' : String(value));

/** Intersection area of two percent rects as a fraction of the smaller one. */
export function overlapRatio(a, b) {
    if (!a || !b || a.page !== b.page) return 0;
    const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
    const intersection = overlapWidth * overlapHeight;
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    if (smaller <= 0) return 0;
    return intersection / smaller;
}

/**
 * Validate and normalize one raw suggestion (from the AI callable or from the
 * deterministic PDF inspector) into the canonical suggestion shape.
 *
 * @returns {object|null} null when the suggestion cannot be trusted.
 */
export function normalizeSuggestion(raw, { allowedPages = null, idFactory } = {}) {
    if (!raw || typeof raw !== 'object') return null;

    const category = normalizeText(raw.category).trim();
    const mapping = SEMANTIC_FIELD_MAP[category];
    if (!mapping) return null;

    const page = toFiniteNumber(raw.page);
    if (page === null || !Number.isInteger(page) || page < 1) return null;
    if (allowedPages && !allowedPages.has(page)) return null;

    const x = clampPercent(raw.x);
    const y = clampPercent(raw.y);
    let width = clampPercent(raw.width);
    let height = clampPercent(raw.height);
    if (x === null || y === null || width === null || height === null) return null;
    if (width < MIN_FIELD_WIDTH_PCT || height < MIN_FIELD_HEIGHT_PCT) return null;

    if (x + width > 100) width = 100 - x;
    if (y + height > 100) height = 100 - y;
    if (width < MIN_FIELD_WIDTH_PCT || height < MIN_FIELD_HEIGHT_PCT) return null;

    const rawConfidence = toFiniteNumber(raw.confidence);
    const confidence = rawConfidence === null ? 0 : Math.min(1, Math.max(0, rawConfidence));

    // An explicit binding from the reviewer wins (including an explicit ''
    // meaning "no binding"); an absent or unsupported one falls back to the
    // category's canonical binding.
    const hasExplicitBinding = Object.prototype.hasOwnProperty.call(raw, 'bindingKey');
    const requestedBinding = normalizeText(raw.bindingKey);
    const bindingKey =
        hasExplicitBinding && SUPPORTED_BINDING_KEYS.includes(requestedBinding)
            ? requestedBinding
            : mapping.bindingKey;

    const makeId =
        idFactory || (() => `ai_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`);

    return {
        suggestionId: normalizeText(raw.suggestionId).trim() || makeId(),
        category,
        type: mapping.type,
        bindingKey,
        label: normalizeText(raw.label).trim().slice(0, 60) || mapping.label,
        required: typeof raw.required === 'boolean' ? raw.required : mapping.required,
        confidence,
        // Where the suggestion came from: 'pdf' (embedded form data / text
        // geometry) or 'vision'. Deterministic sources outrank visual guesses.
        source: raw.source === 'pdf' ? 'pdf' : 'vision',
        page,
        x,
        y,
        width,
        height,
        status: 'pending',
    };
}

/**
 * Merge deterministic (PDF) and vision suggestions into one reviewed set.
 *
 * Rules, in order:
 *  1. every suggestion is validated (invalid ones are dropped and counted);
 *  2. near-duplicates of the same category on the same page collapse, with the
 *     `pdf` source winning over `vision` regardless of confidence — embedded
 *     form geometry is measured, not guessed;
 *  3. a suggestion overlapping an existing manual field is flagged, never
 *     applied silently, and never replaces that field.
 */
export function buildSuggestionSet({
    rawSuggestions = [],
    existingFields = [],
    allowedPages = null,
    idFactory,
} = {}) {
    const normalized = [];
    let rejected = 0;

    for (const raw of rawSuggestions) {
        const suggestion = normalizeSuggestion(raw, { allowedPages, idFactory });
        if (suggestion) normalized.push(suggestion);
        else rejected += 1;
    }

    // Deterministic first so the dedupe below always keeps the measured box.
    normalized.sort((a, b) => {
        if (a.source === b.source) return b.confidence - a.confidence;
        return a.source === 'pdf' ? -1 : 1;
    });

    const deduped = [];
    let duplicates = 0;
    for (const candidate of normalized) {
        const clash = deduped.find(
            (kept) =>
                kept.page === candidate.page &&
                kept.category === candidate.category &&
                overlapRatio(kept, candidate) > 0.6,
        );
        if (clash) {
            duplicates += 1;
            continue;
        }
        deduped.push(candidate);
    }

    const withOverlaps = deduped.map((suggestion) => {
        const collidingField = existingFields.find(
            (field) => overlapRatio(suggestion, field) >= OVERLAP_FLAG_RATIO,
        );
        if (!collidingField) return suggestion;
        return {
            ...suggestion,
            overlapsFieldId: collidingField.id,
            overlapsFieldLabel: collidingField.label || collidingField.type || 'an existing field',
        };
    });

    return {
        suggestions: withOverlaps,
        stats: { received: rawSuggestions.length, rejected, duplicates, kept: withOverlaps.length },
    };
}

/** Normalize a raw manual-review warning into a displayable entry. */
export function normalizeManualReview(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = normalizeText(raw.kind).trim();
    if (!MANUAL_REVIEW_KINDS.includes(kind)) return null;
    const page = toFiniteNumber(raw.page);
    return {
        kind,
        page: page !== null && Number.isInteger(page) && page >= 1 ? page : null,
        detail: normalizeText(raw.detail).trim().slice(0, 160),
        message: MANUAL_REVIEW_MESSAGES[kind],
    };
}

/**
 * Convert accepted suggestions into editor fields and append them.
 *
 * Never mutates, replaces or removes an existing field: the result is always
 * `[...fields, ...newlyPlaced]`. Returns the previous array too so the caller
 * can offer a one-level undo without re-deriving it.
 */
export function applySuggestionsToFields({ fields = [], suggestions = [], idFactory }) {
    const makeId =
        idFactory || (() => `fld_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`);

    const appended = suggestions.map((suggestion) => {
        const template = FIELD_TEMPLATES[templateIdForCategory(suggestion.category)] || {};
        return {
            // Template first so the suggestion's reviewed values always win.
            ...template,
            id: makeId(suggestion),
            type: suggestion.type,
            label: suggestion.label,
            page: suggestion.page,
            x: suggestion.x,
            y: suggestion.y,
            width: suggestion.width,
            height: suggestion.height,
            required: suggestion.required,
            bindingKey: suggestion.bindingKey,
            // AI-placed fields are always signer-editable: locking a field the
            // sender never reviewed would block the send on missing prefill.
            prefillPolicy: 'editable',
            readOnly: false,
            defaultValue: suggestion.bindingKey ? `{{${suggestion.bindingKey}}}` : '',
            fontSize: 'Auto',
            placedByAi: true,
        };
    });

    return { fields: [...fields, ...appended], previousFields: fields, appended };
}

/**
 * Palette template id backing a semantic category, so applied fields inherit
 * exactly the same shape a manually placed field would have.
 */
export function templateIdForCategory(category) {
    switch (category) {
        case 'signature':
            return 'signature';
        case 'initials':
            return 'initial';
        case 'date':
            return 'date_signed';
        case 'full_name':
            return 'name';
        case 'email':
            return 'email_field';
        case 'company':
            return 'company';
        case 'checkbox':
            return 'checkbox';
        default:
            return 'text';
    }
}

/** Suggestions the "Apply high-confidence" action would take. */
export function selectHighConfidence(suggestions = [], threshold = HIGH_CONFIDENCE_THRESHOLD) {
    return suggestions.filter(
        (suggestion) =>
            suggestion.status !== 'rejected' &&
            !suggestion.overlapsFieldId &&
            suggestion.confidence >= threshold,
    );
}
