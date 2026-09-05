#!/usr/bin/env node
/**
 * The four rules that read a control's STATE, its identity or its place —
 * `hand-rolled-toggle`, `hand-rolled-current`, `hand-rolled-avatar` and
 * `hand-rolled-disclosure`.
 *
 * Split out of `test-ui-contract.mjs` on 2026-09-05, when the avatar rule took
 * that file to 528 lines and past the 500-line maximum. The split is by
 * responsibility and not by line count: these share one difficulty that none of
 * the other fifteen rules has, which is that **the correct shape and the wrong
 * one are nearly the same markup**. A `<Button aria-pressed>` and a
 * `<button aria-pressed>` differ by a capital letter; a person's avatar and an
 * empty-state medallion are both a centred round box with a fixed size; a
 * disclosure trigger and a menu trigger are both a button wearing
 * `aria-expanded`, and what tells them apart is the element WRAPPING it. Every
 * assertion here is about that boundary, and each was driven by a mutation that
 * moved it.
 *
 * The suite chain in `package.json` is asserted off DISK by
 * `test-ui-contract-ci.mjs` §W6, so this file cannot go unrun by being
 * forgotten.
 */

import { COUNTERS, countViolations } from './ui-contract/counting.mjs';
import { JSX_RULE_NAMES } from './ui-contract/rules.mjs';
import { CONTRACT_EXEMPT_RULES, STORY_RULE_NAMES, rulesFor } from './ui-contract/source-text.mjs';

let failures = 0;
function assert(name, condition, detail = '') {
    if (condition) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/*
 * Every rule here is counter-backed rather than pattern-backed, because each
 * needs to read an element name or a body that a regex over the attribute
 * cannot see. If one ever loses its counter it has silently stopped counting.
 */
assert('P0. all four state rules are counter-backed',
    ['hand-rolled-toggle', 'hand-rolled-current', 'hand-rolled-avatar', 'hand-rolled-disclosure']
        .every((rule) => typeof COUNTERS[rule] === 'function'));

/* ========================================================================== */
console.log('\nP. The rules that read a control\'s state');

const toggles = (code) => countViolations(code)['hand-rolled-toggle'] ?? 0;

// P1. The shape the rule exists for.
assert('P1. a raw <button aria-pressed> is one violation',
    toggles('<button type="button" aria-pressed={on}>Hired</button>') === 1);

/*
 * P2. The whole difficulty of this rule in one assertion. Nineteen live call
 * sites pass `aria-pressed` straight through to `Button` or `IconButton`, and
 * they are correct — the state is being handed to the contract. The wrong shape
 * differs by ONE CAPITAL LETTER, which a regex over the attribute cannot see, so
 * the counter reads the element name off the open tag instead.
 * Mutation: make `openTagAttributes`'s start pattern case-insensitive and this
 * goes to 2.
 */
assert('P2. a component carrying aria-pressed is silent',
    toggles('<Button aria-pressed={on}>SMS</Button><IconButton aria-pressed={on} label="x"/>') === 0);

/*
 * P3. `<button[^>]*aria-pressed` stops at the first `>`, including the one in
 * `=>`, so prop ORDER would decide whether a toggle is visible. That defect is
 * recorded twice already in `counting.mjs`; this is the third rule it would
 * have hit.
 */
assert('P3. an arrow function before the attribute does not hide it',
    toggles('<button onClick={() => go()} aria-pressed={on}>x</button>') === 1);

// P4. Anchors count — `aria-pressed` on a link is invalid ARIA. Elements whose
// name merely STARTS with `a` do not: the tag reader requires `[\s/>]` after it.
assert('P4. an anchor counts and an abbr does not',
    toggles('<a href="/x" aria-pressed={on}>x</a>') === 1
    && toggles('<abbr aria-pressed="true">x</abbr><article aria-pressed="true"/>') === 0);

// P5. The migration target has to be silent, or the rule refuses its own remedy.
assert('P5. Chip and ChipGroup are silent',
    toggles('<ChipGroup ariaLabel="Stage"><Chip pressed={on}>Hired</Chip></ChipGroup>') === 0);

/*
 * P6. The design system is exempt from this rule and NOTHING else.
 *
 * `SegmentedControl` IS the `role="group"` of `<button aria-pressed>` the rule
 * points people at, so the rule cannot fire on it. The exemption is a named list
 * rather than a path skip precisely so it cannot quietly widen: this asserts the
 * set difference is exactly one name, and that every other rule still reaches
 * inside `src/design-system/`.
 * Mutation: add a name that is not a rule, or drop a rule from the routing
 * without dropping it from the list, and these fail.
 */
const contractRules = rulesFor('src/design-system/components/segmented/SegmentedControl.jsx');
/*
 * Not "exactly N rules" — that assertion has to be edited every time the list
 * legitimately changes, and an assertion people edit routinely stops being read.
 * What must hold whatever the length is: the exempt names are a subset of the
 * real rules (so a typo cannot exempt nothing while looking like it exempts
 * something), and the difference between the full JSX set and what the design
 * system gets is EXACTLY that list and nothing more.
 */
assert('P6a. every exempt name is a real rule',
    CONTRACT_EXEMPT_RULES.every((name) => JSX_RULE_NAMES.includes(name)),
    CONTRACT_EXEMPT_RULES.filter((name) => !JSX_RULE_NAMES.includes(name)).join(', '));
assert('P6b. and the design system keeps every other JSX rule',
    JSX_RULE_NAMES.filter((name) => !contractRules.includes(name)).sort().join(',')
    === [...CONTRACT_EXEMPT_RULES].sort().join(','));
assert('P6c. so the primitive itself does not trip it',
    (countViolations('<button aria-pressed={on} className="ds-segmented__option"/>', contractRules)['hand-rolled-toggle'] ?? 0) === 0);

/*
 * P7. A story is held to it, by the same argument `raw-z-index` is: the catalog
 * is the design system's published example, and one hand-rolling a control is
 * teaching the shape rather than merely containing it. Stories are routed before
 * the contract-root branch, so the exemption must NOT reach them.
 *
 * Driven over `CONTRACT_EXEMPT_RULES` rather than over one name. The first
 * version named `hand-rolled-toggle` alone, and a mutation proved that: dropping
 * `hand-rolled-current` from the story set passed. An exemption and its catalog
 * counterpart are two halves of one decision, so the assertion has to be over
 * the set, not over a member of it.
 */
const storyRules = rulesFor('src/design-system/stories/Chip.stories.jsx');
assert('P7. every rule the design system is exempt from still binds its catalog',
    CONTRACT_EXEMPT_RULES.every(
        (name) => STORY_RULE_NAMES.includes(name) && storyRules.includes(name),
    ),
    CONTRACT_EXEMPT_RULES.filter((name) => !storyRules.includes(name)).join(', '));

/*
 * P8. `JSX_RULE_NAMES` is what the exemption subtracts FROM, so if it ever
 * covered less than `only === null` does, a design-system file would silently
 * skip the difference — a hole opened by a list drifting out of date rather than
 * by anybody deciding anything. Driven on a fixture that trips four different
 * rule kinds at once: a pattern rule, a counter rule, a styled-control rule and
 * a class-list rule.
 * Mutation: drop STYLED_CONTROL_RULES from JSX_RULE_NAMES and this fails.
 */
const everyKind = '<div className="bg-blue-500" style={{ color: \'#ff0000\' }} />'
    + '<button className="rounded-ds-md bg-ds-surface px-ds-3" aria-pressed={on}>x</button>'
    + '<input type="file" />';
assert('P8. the named JSX rule set covers exactly what `null` covers',
    JSON.stringify(countViolations(everyKind, JSX_RULE_NAMES))
    === JSON.stringify(countViolations(everyKind)));

const currents = (code) => countViolations(code)['hand-rolled-current'] ?? 0;

/*
 * P9. `hand-rolled-current` is `hand-rolled-toggle`'s sibling and asks a
 * different question, so the two must not answer for each other: a `pressed`
 * control is not a `current` one and counting it as both would double every
 * toggle in the tree.
 */
assert('P9. current and pressed are counted separately',
    currents('<button aria-current="page">3</button>') === 1
    && toggles('<button aria-current="page">3</button>') === 0
    && currents('<button aria-pressed={on}>x</button>') === 0);

/*
 * P10. Scoped to `<button>` on purpose, and this is the assertion that keeps it
 * honest. Three raw `aria-current` sites in the tree are non-interactive
 * progress displays — a `<li>` step indicator, a `<span>` step chip — which are
 * CORRECT markup with no primitive behind them. A rule firing there would be
 * demanding a component nobody has built; the roadmap gap table is where that
 * belongs.
 * Mutation: widen the counter to `li|span` and this fails.
 */
assert('P10. a non-interactive step indicator is not a hand-rolled control',
    currents('<li aria-current="step">2. Map</li><span aria-current="step">3. Send</span>') === 0);

assert('P11. a component carrying aria-current is silent',
    currents('<SelectableCard current /><SectionNavigation aria-current="page" />') === 0);

// P12. The migration target, and the design system's own rail that the remedy
// names — neither may trip the rule that points at them.
assert('P12. the design system is exempt from both state rules',
    CONTRACT_EXEMPT_RULES.length === 2
    && CONTRACT_EXEMPT_RULES.includes('hand-rolled-toggle')
    && CONTRACT_EXEMPT_RULES.includes('hand-rolled-current')
    && (countViolations('<button aria-current="page" />', contractRules)['hand-rolled-current'] ?? 0) === 0);

const discs = (code) => countViolations(code)['hand-rolled-avatar'] ?? 0;

const RAW_AVATAR = '<span aria-hidden="true" className="flex h-10 w-10 items-center '
    + 'justify-center rounded-ds-full bg-ds-surface-subtle">{memberName.charAt(0)}</span>';

// P13. The shape the rule exists for — one of the eight this slice migrated.
assert('P13. a disc holding a person\'s initial is one violation',
    discs(RAW_AVATAR) === 1);

/*
 * P14. The assertion that keeps the rule honest, and the reason it reads the
 * disc's CONTENT rather than its shape. The obvious "round box with a fixed
 * size" rule was measured first: 25 matches, of which only 8 were avatars. The
 * other seventeen are a glyph medallion, an unread-count badge, a numbered step
 * marker, a radio dot and a selection indicator — and `Avatar` is the wrong
 * remedy for every one.
 * Mutation: drop the content test and this goes to 5.
 */
assert('P14. the four other things that are also circles are left alone',
    discs('<span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-ds-full"><Rocket /></span>') === 0
    && discs('<span className="min-w-5 h-5 items-center justify-center rounded-ds-full flex">{unreadCount}</span>') === 0
    && discs('<span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-ds-full">{index + 1}</span>') === 0
    && discs('<span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-ds-full border" />') === 0
    && discs('<span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-ds-full">{getIcon(log.type)}</span>') === 0);

// P15. All three spellings a name-derived initial takes in this tree.
assert('P15. it reads every way an initial is derived here',
    discs('<div className="w-9 h-9 rounded-ds-full flex items-center justify-center">{initials}</div>') === 1
    && discs('<span className="flex h-5 w-5 items-center justify-center rounded-ds-full">{item.assignedToName.charAt(0)}</span>') === 1
    && discs('<span className="flex h-10 w-10 items-center justify-center rounded-ds-full">{name[0] || \'?\'}</span>') === 1);

// P16. The migration target has to be silent, or the rule refuses its own remedy.
assert('P16. Avatar is silent',
    discs('<Avatar size="md" tone="neutral">{initials}</Avatar>') === 0);

/*
 * P17. A disc that is round and centred but NOT sized is a pill or an ornament,
 * not an avatar — the shape test needs all three parts or it starts matching
 * every rounded badge in the tree.
 */
assert('P17. all three shape signals are required',
    discs('<span className="rounded-ds-full items-center flex">{initials}</span>') === 0
    && discs('<span className="h-10 w-10 items-center flex">{initials}</span>') === 0);

const sections = (code) => countViolations(code)['hand-rolled-disclosure'] ?? 0;

const RAW_DISCLOSURE = '<h3 className="m-0"><button type="button" aria-expanded={showGuide} '
    + 'aria-controls="guide" className="flex w-full items-center">Title</button></h3>';

// P18. The shape the rule exists for — the one site this slice migrated.
assert('P18. a <button aria-expanded> inside a heading is one violation',
    sections(RAW_DISCLOSURE) === 1);

/*
 * P19. The assertion that makes this rule right, and the reason it reads the
 * enclosing HEADING rather than the attribute. "A raw `<button aria-expanded>`"
 * was written first and measured at two matches in the whole tree — the site
 * above and a bottom app-bar tab that would then have needed a recorded reason.
 * Meanwhile eleven live sites wear `aria-expanded`, and ten of them are menus,
 * a combobox, a navigation group, a drawer trigger, a filter toggle and a row
 * expander. `Disclosure` replaces none of them.
 * Mutation: drop the heading scope and every one of these lights up.
 */
assert('P19. the same button outside a heading is left alone',
    sections('<nav><button type="button" aria-expanded={openSheet === key}>Open Fields</button></nav>') === 0
    && sections('<div className="relative"><button aria-expanded={isOpen} aria-haspopup="menu" /></div>') === 0
    && sections('<input type="text" aria-expanded={open} aria-autocomplete="list" />') === 0);

/*
 * P20. The same capital-letter boundary P2 records, one rule over: a DS
 * `<Button aria-expanded>` inside a heading is a correct call site handing the
 * state to the contract.
 * Mutation: make `openTagAttributes`'s start pattern case-insensitive.
 */
assert('P20. a <Button aria-expanded> inside a heading is silent',
    sections('<h2><Button aria-expanded={rulesOpen} aria-controls="rules">Rules</Button></h2>') === 0);

/*
 * P21. `Disclosure` itself renders exactly the shape this rule points at, and
 * yet needs no entry in `CONTRACT_EXEMPT_RULES` — it spells the heading as
 * `<Heading>`, a capitalised binding for the caller's level, and the counter
 * reads lowercase `h1`-`h6` only. That is worth pinning, because an exemption
 * is the thing to be suspicious of and this rule avoided needing one.
 */
assert('P21. the primitive is silent by its own structure, with no exemption',
    sections('<Heading id={headingId}><button aria-expanded={isOpen} /></Heading>') === 0
    && CONTRACT_EXEMPT_RULES.length === 2
    && !CONTRACT_EXEMPT_RULES.includes('hand-rolled-disclosure'));

/*
 * P22. A self-closing heading, and the reason it needs its own branch. Without
 * one, its region runs on to the NEXT heading's close tag and counts that
 * heading's trigger a SECOND time — measured at 2 while writing this, which is
 * a false positive a reader would have no way to explain.
 *
 * This is also where the brace-aware scan earns its place. Knowing the tag
 * closed itself means reading its real attribute text to the end, and under
 * `indexOf('>')` the arrow in the second case below ends it early, the trailing
 * `/` is never seen, and the count goes back to 2.
 *
 * The first version of this assertion claimed `indexOf('>')` broke the OFFSET
 * instead. That was written without running the mutation, and running it showed
 * the count unchanged — the body region still contained the trigger. Corrected
 * rather than deleted, because a test that survives its own mutation is the
 * defect this campaign found in `classAndAttributeCount` three slices ago.
 */
assert('P22. a self-closing heading does not borrow the next heading\'s trigger',
    sections('<h3 className="x" /><h3><button aria-expanded={o} /></h3>') === 1
    && sections('<h3 onClick={() => f()} /><h3><button aria-expanded={o} /></h3>') === 1
    && sections('<h3><button aria-expanded={a} /></h3><h3><button aria-expanded={b} /></h3>') === 2);

// P22b. And the open tag may still hold an arrow function in the ordinary case.
assert('P22b. a heading whose open tag holds an arrow function still reads its body',
    sections('<h3 onClick={() => focus()}><button aria-expanded={open} /></h3>') === 1);

// P23. A heading that holds no trigger, and one that holds nothing at all.
assert('P23. a heading without an expanding button is left alone',
    sections('<h3 className="m-0">Plain section title</h3>') === 0
    && sections('<h3 />') === 0
    && sections('<h3><button type="button" onClick={save}>Save</button></h3>') === 0);

// P24. All six levels, because a rule that reads only <h3> covers one spelling.
assert('P24. every heading level is covered',
    [1, 2, 3, 4, 5, 6].every((n) => sections(`<h${n}><button aria-expanded={o} /></h${n}>`) === 1));

/* ========================================================================== */
console.log(failures === 0
    ? '\nAll state-rule checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
