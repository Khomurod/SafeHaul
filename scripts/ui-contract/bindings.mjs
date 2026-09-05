/**
 * A class list hoisted into a variable.
 *
 * The styled-control rules read the characters inside an opening tag and ask
 * whether they carry geometry or colour. That works for the way a class list is
 * usually written, and it is blind to the way it is sometimes written:
 *
 *     const commonClasses = "w-full rounded-ds-md border bg-ds-surface p-ds-3";
 *     <input className={commonClasses} />
 *
 * Nothing between `<input` and `/>` says anything about geometry, so the rule
 * saw a bare, unstyled control — while the rendered element is exactly the
 * second control contract the rule exists to refuse. Measured before this
 * module: the hoisted form counted 0, the identical inline form counted 1.
 *
 * ## Why it is a parser and not a wider regex
 *
 * The regex would have to answer "what is this identifier bound to", which is a
 * question about the whole file rather than about a run of characters. A regex
 * that guesses reads `className={props.className}` — a pass-through, styling
 * nothing — as a violation on every component that forwards one.
 *
 * ## What it deliberately refuses to judge
 *
 * Proof, not suspicion. A name is resolved only when the file binds it exactly
 * once, that binding is a variable declarator with an initialiser, and the
 * initialiser can be proved to yield styling text down every path
 * (`certainlyText`). Two declarations, a later assignment, a function parameter
 * of the same name, an import, a destructure — any of those and the name is
 * unresolvable and nothing is counted. That is deliberately conservative: this
 * rule may under-report, and must never fire on a control it cannot prove is
 * styled.
 */

import { certainlyText, lastClassSetter, parseModule, walkAst } from './jsx.mjs';
import { STYLING_SIGNAL } from './rules.mjs';

/**
 * The cheap question asked before the expensive one.
 *
 * `className={someIdentifier}` is the only shape this module can ever count, and
 * most files have none — so a file without it is never parsed at all. Same
 * arrangement as the table rule, and the same reason: a parse per file is the
 * cost, and it should be paid only where there is something to find.
 */
export const HOISTED_CLASS_NAME = /className\s*=\s*\{\s*[A-Za-z_$][\w$]*\s*\}/;

const isStyling = (text) => STYLING_SIGNAL.test(text);

/** Every name a pattern binds — `{a, b: {c}}`, `[d, ...e]`, `f = 1`. */
function patternNames(node, out) {
    if (!node || typeof node !== 'object') return out;
    switch (node.type) {
        case 'Identifier': out.push(node.name); break;
        case 'ObjectPattern': node.properties.forEach((p) => patternNames(p.value ?? p.argument, out)); break;
        case 'ArrayPattern': node.elements.forEach((e) => patternNames(e, out)); break;
        case 'AssignmentPattern': patternNames(node.left, out); break;
        case 'RestElement': patternNames(node.argument, out); break;
        default: break;
    }
    return out;
}

/**
 * How many times the file binds or rebinds each name, and the initialiser when
 * the single binding is a plain `const`/`let`/`var` declarator.
 *
 * Counting every binding form — not just declarators — is what makes "exactly
 * one" mean it. A parameter named `commonClasses` in another function shadows
 * the module-level one inside that function, and this module does no scope
 * analysis; refusing the name outright is the honest answer, and it costs
 * nothing because the shape does not occur.
 */
function collectBindings(ast) {
    const bindings = new Map();
    const note = (name, init) => {
        const seen = bindings.get(name);
        bindings.set(name, { count: (seen?.count ?? 0) + 1, init: init ?? seen?.init ?? null });
    };
    walkAst(ast.program, (node) => {
        switch (node.type) {
            case 'VariableDeclarator':
                if (node.id?.type === 'Identifier') note(node.id.name, node.init);
                else patternNames(node.id, []).forEach((name) => note(name, null));
                break;
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                if (node.id?.type === 'Identifier') note(node.id.name, null);
                node.params?.forEach((param) => patternNames(param, []).forEach((n) => note(n, null)));
                break;
            case 'ClassDeclaration':
            case 'ClassExpression':
                if (node.id?.type === 'Identifier') note(node.id.name, null);
                break;
            case 'CatchClause':
                patternNames(node.param, []).forEach((name) => note(name, null));
                break;
            case 'ImportSpecifier':
            case 'ImportDefaultSpecifier':
            case 'ImportNamespaceSpecifier':
                if (node.local?.type === 'Identifier') note(node.local.name, null);
                break;
            case 'AssignmentExpression':
                // A rebind is a second binding for this purpose: `x = f()` after
                // `const x = "p-3"` makes the rendered class list unknowable.
                if (node.left?.type === 'Identifier') note(node.left.name, null);
                break;
            case 'UpdateExpression':
                if (node.argument?.type === 'Identifier') note(node.argument.name, null);
                break;
            default: break;
        }
    });
    return bindings;
}

/**
 * The host elements whose class list is styling text held in a variable, and
 * which the text scanner therefore cannot see.
 *
 * The second half of that sentence is load-bearing, and it is why this returns
 * only the elements the text scanner MISSES rather than every hoisted-styled
 * element: an element carrying inline styling as well
 * (`<input className={c} className2... p-ds-3 ...>`) is already one violation,
 * and reporting it here too would count one control twice. The test for "would
 * the text scanner have seen it" is the text scanner's own test, run on the same
 * attribute text, so the two cannot disagree.
 *
 * @param {string} source a JSX module
 * @returns {string[]} one lowercase tag name per off-contract element
 */
export function hoistedStyledElements(source) {
    if (!HOISTED_CLASS_NAME.test(source)) return [];
    const ast = parseModule(source);
    const bindings = collectBindings(ast);
    const found = [];

    walkAst(ast.program, (node) => {
        if (node.type !== 'JSXOpeningElement') return;
        if (node.name?.type !== 'JSXIdentifier') return;
        const tag = node.name.name;
        // Host elements only. A capitalised name is a component, and what it
        // does with a `className` prop is that component's contract, not this one.
        if (!/^[a-z]/.test(tag)) return;

        const setter = lastClassSetter(node);
        // A spread may set or replace the class list, so nothing is provable.
        if (!setter || setter.spread) return;
        if (setter.value?.type !== 'JSXExpressionContainer') return;
        if (setter.value.expression?.type !== 'Identifier') return;

        const binding = bindings.get(setter.value.expression.name);
        if (!binding || binding.count !== 1 || !binding.init) return;
        if (!certainlyText(binding.init, isStyling)) return;

        const attributes = source.slice(node.name.end, node.end);
        if (STYLING_SIGNAL.test(attributes)) return; // already counted inline
        found.push(tag);
    });

    return found;
}
