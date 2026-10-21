/**
 * `ds/native-table` — display tables are `DataTable`; a native `<table>` is
 * approved only where roadmap §5 records it, and an approved one carries
 * `ds-native-table`.
 *
 * The exception ARMS the second check rather than satisfying it: a `<table>`
 * in a file with no `raw-table` exception is refused outright, and every
 * `<table>` in a file with one must prove the contract class on every branch
 * of the attribute that decides its class list (`./jsx.mjs`). There is no
 * carve-out for a hidden table — whether a class list is hidden at every
 * breakpoint is not decidable, and the class costs an invisible table nothing.
 *
 * `src/design-system/` is where the contract lives: `DataTable` IS the
 * display-table contract and does not consume the native one, so an approved
 * table there is not asked for the class. Matched as a path segment, so a
 * feature file that merely has the words in its name is still asked.
 */

import {
    exceptedChecks, fileKey, optionsSchema,
} from './context.mjs';
import { certainlyText, elementName, lastClassSetter } from './jsx.mjs';

export const NATIVE_TABLE_CONTRACT = 'ds-native-table';

/** The token counts only as a whole class, delimited by whitespace or an edge. */
const carriesContract = (text) => String(text).split(/\s+/).includes(NATIVE_TABLE_CONTRACT);

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Refuse a native <table> outside the approved list, and an approved one off the ds-native-table contract (roadmap §3, §5).' },
        schema: optionsSchema(),
        messages: {
            'raw-table': 'A raw `<table>`. Use `DataTable` for a display table. A native table is approved '
                + 'only for an editable matrix or per-row interactive rows, by an exception naming this file '
                + '(roadmap §5), and it must then carry `ds-native-table`.',
            'off-contract': 'This approved native `<table>` does not certainly carry `ds-native-table`. Put the '
                + 'class on the last attribute that sets the class list, on every branch: a string, a '
                + 'conditional or `||`/`??` with it on both sides, or a template where it is a whole class. '
                + '`&&`, a call, an array, concatenation, a bare name or a later spread cannot be proved.',
        },
    },
    create(context) {
        const approved = exceptedChecks(context).has('raw-table');
        const contractHome = /(?:^|\/)design-system\//.test(fileKey(context));
        return {
            JSXOpeningElement(node) {
                if (elementName(node) !== 'table') return;
                if (!approved) {
                    context.report({ node, messageId: 'raw-table' });
                    return;
                }
                if (contractHome) return;
                const setter = lastClassSetter(node);
                if (setter?.spread || !certainlyText(setter?.value, carriesContract)) {
                    context.report({ node, messageId: 'off-contract' });
                }
            },
        };
    },
};
