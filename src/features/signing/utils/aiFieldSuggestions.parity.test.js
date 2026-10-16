// src/features/signing/utils/aiFieldSuggestions.parity.test.js
//
// PARITY with the server. The e-doc field vocabulary is written twice: here, and
// in `functions/shared/edocFieldSemantics.js`, which tells the AI field-placement
// model what it may return and turns what it returns into fields. `functions/` is
// CommonJS and deployed on its own, so they cannot be one module. If they
// drifted, the server could hand the editor a suggestion this copy rejects, or a
// field the review panel cannot show. The server module holds data only, so its
// exports are what is compared. Two differences are by design and are pinned
// exactly, so any other difference fails.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

import * as site from './aiFieldSuggestions';

const require = createRequire(import.meta.url);
const server = require('../../../../functions/shared/edocFieldSemantics.js');

/** The box size the editor places a new field at: the site's alone, of no use to the server. */
const BOX_SIZE = ['defaultWidth', 'defaultHeight'];
const withoutBoxSize = (map) => Object.fromEntries(Object.entries(map).map(([category, field]) => [
    category,
    Object.fromEntries(Object.entries(field).filter(([key]) => !BOX_SIZE.includes(key))),
]));

describe('parity with functions/shared/edocFieldSemantics.js', () => {
    it('persists the same field types', () => {
        expect(site.SUPPORTED_FIELD_TYPES).toEqual(server.SUPPORTED_FIELD_TYPES);
    });

    it('offers the same categories, in the same order', () => {
        expect(site.SEMANTIC_CATEGORIES).toEqual(server.SEMANTIC_CATEGORIES);
    });

    it('maps every category to the same type, binding, label and requirement', () => {
        expect(withoutBoxSize(site.SEMANTIC_FIELD_MAP)).toEqual(server.SEMANTIC_FIELD_MAP);
    });

    it('names the same binding keys, after the review panel\'s "No prefill"', () => {
        // '' is the reviewer's "No prefill" choice here; the server lists only the
        // keys the prefill engine resolves. Both maps use '' for "no binding".
        expect(site.SUPPORTED_BINDING_KEYS).toEqual(['', ...server.SUPPORTED_BINDING_KEYS]);
    });

    it('asks for review of the same structures', () => {
        expect(site.MANUAL_REVIEW_KINDS).toEqual(server.MANUAL_REVIEW_KINDS);
    });
});
