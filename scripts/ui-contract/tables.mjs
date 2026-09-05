/**
 * The native-table exception, checked rather than trusted.
 *
 * The roadmap approves native tables for editable matrices, so a `<table>` is not
 * a violation by itself. This is what stops that approval becoming a blanket one:
 * an approved table still has to carry the contract token, and this parses the
 * file to find out rather than grepping for it.
 *
 * The parsing itself — which attribute sets the class, and which expressions can
 * be proved to yield a given class — lives in `./jsx.mjs`, shared with the
 * hoisted-class-list rule. What stays here is the one thing specific to tables:
 * the token, and what counts as carrying it.
 */

import { certainlyText, lastClassSetter, parseModule, walkAst } from './jsx.mjs';

export function tablesOffContract(source, contractToken) {
    const ast = parseModule(source);

    /* A token counts only as a whole class, delimited by whitespace or an edge. */
    const tokenIn = (text) => String(text).split(/\s+/).filter(Boolean).includes(contractToken);

    const offContract = [];
    let total = 0;
    walkAst(ast.program, (node) => {
        if (node.type !== 'JSXOpeningElement') return;
        if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'table') return;
        total += 1;
        const setter = lastClassSetter(node);
        if (setter?.spread || !certainlyText(setter?.value, tokenIn)) {
            offContract.push(node.loc?.start?.line ?? 0);
        }
    });
    return { offContract, total };
}
