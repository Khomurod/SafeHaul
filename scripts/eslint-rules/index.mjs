/**
 * The design-system lint rules, as the local ESLint plugin `ds`.
 *
 * The strict Tailwind theme refuses a default colour, type size, radius,
 * shadow or stacking layer by compiling nothing for it. What a theme cannot
 * refuse is held here, as errors under `src/` outside tests
 * (`eslint.config.js` scopes them):
 *
 * - `ds/no-raw-values`  — an arbitrary colour, type size or layer, a hex in a
 *   style, an SVG attribute or an assignment, a bare `zIndex`;
 * - `ds/native-table`   — a `<table>` outside the approved list, or an approved
 *   one without `ds-native-table`;
 * - `ds/use-primitive`  — a hand-styled control, a hand-rolled tab strip,
 *   toggle, current item or disclosure, a raw file input, `target="_blank"`,
 *   a `fixed inset-0` overlay, a JSX label on a primitive that throws on one.
 *
 * Exceptions are per file and per check, with the reason roadmap §5 records,
 * in `./exceptions.mjs`. `scripts/test-lint-rules.mjs` §O drives every rule on
 * fixtures, proves each reaches every file it governs, that no exception is
 * stale, and that no disable comment hides a violation.
 */

import nativeTable from './native-table.mjs';
import noRawValues from './no-raw-values.mjs';
import usePrimitive from './use-primitive.mjs';

export default {
    meta: { name: 'ds' },
    rules: {
        'no-raw-values': noRawValues,
        'native-table': nativeTable,
        'use-primitive': usePrimitive,
    },
};
