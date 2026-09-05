/**
 * An approved native table must apply the native-table contract.
 *
 * The roadmap has always said both halves of this: a native `<table>` is
 * approved for an editable matrix or per-row interactive rows, AND "a native
 * table is not a licence to style a table by hand". Only the first half was
 * checked. Measured on 2026-08-25: seven of the eleven approved native tables
 * referenced no `--ds-table-*` role at all, and their inline cell padding had
 * drifted to three different values (24px, 20px, 16px) against a contract of
 * 20px. They looked right because `bg-ds-surface-subtle` happens to be what
 * the header role resolves to — a coincidence a re-tuned role would break in
 * silence.
 *
 * `ds-native-table` is that contract, so requiring the class is how the
 * second half of the permission becomes enforceable.
 *
 * ## The allowlist entry ARMS this check; it does not satisfy it
 *
 * Note the shape of the loop below: it iterates the *allowlist*, and skips any
 * file without a numeric `raw-table`. Writing `"raw-table": N` is therefore what
 * opts a file IN to being parsed, not what exempts it. That makes this the one
 * rule an allowlist entry cannot buy its way past — a `<table>` with no entry
 * fails as an uncovered violation, and a `<table>` with an entry must prove the
 * contract on every branch.
 *
 * ## Per table, not per file
 *
 * The first version of this asked whether the *file* mentioned
 * `ds-native-table` anywhere, which a file with three tables satisfies by
 * putting the class on one of them. `AnalyticsView.jsx` is exactly that
 * shape — three approved `<table>` elements — so the weaker check was one
 * edit away from passing a hand-styled table again, which is the finding
 * this rule was written for. It counts tables now.
 *
 * ## No carve-out for a hidden table, since round eight
 *
 * There used to be one: `AnalyticsView`'s `sr-only` chart-equivalent table was
 * exempt, on the reasoning that something invisible has no appearance to put on
 * contract. The reasoning was fine and the *inference* was not — deciding
 * "is this hidden?" from a class list means deciding it across Tailwind's
 * whole variant space, and `className="sr-only xl:not-sr-only"` is hidden on a
 * phone and visible on a desktop. That pattern is already in this repository
 * (`DossierHeader.jsx`), so it was not hypothetical.
 *
 * Rather than guard an open-ended axis, the axis is gone: **every** approved
 * `<table>` must carry the class, the hidden one included. Measured in a real
 * browser with the built stylesheet before doing it — `sr-only` keeps
 * `position:absolute` and `clip:rect(0,0,0,0)`, so the element stays invisible
 * whatever the contract does to its box (10x20 -> 47x39, `visible: false`
 * both ways). An invisible table carrying a visual contract costs nothing;
 * inferring invisibility from classes cost four rounds of review.
 *
 * ## And it parses, rather than matching text
 *
 * This rule went through four review rounds, each closing a bypass the
 * previous fix left: a `[^>]*` tag match truncating at the `>` in `=>`, an
 * `includes()` class match accepting `ds-native-table-broken`, a whole-slice
 * search accepting a `data-testid` that named the contract, and finally
 * `className={enabled ? 'ds-native-table' : 'other'}` — where the token IS in
 * the text and the rendered table is off-contract half the time.
 *
 * That last one is why it now asks `@babel/parser`. No amount of careful
 * string matching answers it, because the question is not "does this text
 * appear" but "is this true on every branch", which is a question about
 * structure. See `tablesOffContract`.
 */

import { tablesOffContract } from './tables.mjs';

export const NATIVE_TABLE_CONTRACT = 'ds-native-table';

/**
 * @param {object} allowlist the loaded allowlist document
 * @param {(file: string) => string} readSource resolves an allowlist key to source
 * @returns {string[]} human-readable findings, empty when every table is tethered
 */
export function untetheredTables(allowlist, readSource) {
    const untethered = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        if (typeof allowed['raw-table'] !== 'number') continue;
        /*
         * `DataTable` IS the display-table contract; it does not consume the
         * native one.
         *
         * Matched as a PATH SEGMENT, not a prefix. This read
         * `startsWith('design-system/')` until allowlist v2 moved the keys to
         * repo-relative, at which point `src/design-system/…` stopped matching
         * and `DataTable.jsx` was reported as an untethered table. It failed
         * closed, which is the survivable direction — but a hardcoded prefix
         * that a key-format change can invalidate is the defect either way, and
         * the next format change would reintroduce it. §T6 pins both spellings.
         */
        if (/(?:^|\/)design-system\//.test(file)) continue;
        let result;
        try {
            result = tablesOffContract(readSource(file), NATIVE_TABLE_CONTRACT);
        } catch (error) {
            // A parse failure is a failure. Falling back to a text match here is
            // how the four bypasses this rule now parses for would come back.
            untethered.push(`${file} (could not be parsed: ${error.message})`);
            continue;
        }
        if (result.offContract.length > 0) {
            untethered.push(
                `${file} (${result.offContract.length} of ${result.total}, `
                + `line${result.offContract.length > 1 ? 's' : ''} ${result.offContract.join(', ')})`,
            );
        }
    }
    return untethered;
}
