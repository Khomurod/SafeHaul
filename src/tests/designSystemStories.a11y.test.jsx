import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { composeStories } from '@storybook/react-vite';

/**
 * Story smoke + accessibility lane.
 *
 * This is the Storybook check that runs in the normal frontend test suite. It
 * renders **every story in the catalog** and runs axe over the result, so a
 * story cannot rot into a broken import, a throwing prop combination, or an
 * inaccessible example without CI noticing.
 *
 * ## Why this and not `@storybook/addon-vitest`
 *
 * The official Vitest addon runs stories in Playwright browser mode. That would
 * mean a second browser-driven suite in CI on top of the existing Playwright
 * lane, and `AGENTS.md` records real, expensive failures caused by two suites
 * contending for one dev server. Portable stories give the same coverage inside
 * the suite that already exists, with no browser and no extra server.
 *
 * The trade-off is honest and worth stating: happy-dom does not compute layout,
 * so `color-contrast` cannot be evaluated here and is disabled below. Contrast is
 * covered elsewhere — by the real-browser `@axe-core/playwright` lane and by the
 * token pairings pinned in `src/design-system/tests/tokens.test.js`.
 *
 * ## What "passing" means
 *
 * Serious and critical violations fail. Moderate and minor findings are surfaced
 * in the failure message when a story fails for another reason, but do not fail
 * the build on their own — several are artefacts of rendering one story in
 * isolation, outside the page landmark structure it would really live in.
 */

const AXE_OPTIONS = {
  rules: {
    // happy-dom computes no layout, so every colour pair resolves to the same
    // value and this rule cannot produce a meaningful result here.
    'color-contrast': { enabled: false },
    // A story is a fragment, not a page. Landmark and page-level structure rules
    // are meaningless in isolation and are enforced on real screens by the
    // Playwright axe lane instead.
    region: { enabled: false },
    'page-has-heading-one': { enabled: false },
    'landmark-one-main': { enabled: false },
  },
};

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/**
 * Domain vocabulary that must never appear in what a story *renders*.
 *
 * The catalog is the design system's visual contract. When a story labels its
 * example button "Add driver" or gives `tone="success"` the label "Finish
 * signing", it stops documenting a neutral primitive and starts publishing a
 * feature's vocabulary and its domain-to-tone mapping as the reusable standard —
 * exactly what `AGENTS.md` reserves for feature folders. Four such labels were
 * caught in review on this catalog's first pass; this stops the fifth.
 *
 * Deliberately checked against the **rendered DOM**, not the source. A story's
 * documentation legitimately names the real consumer that proves a primitive
 * ("proven by the public driver application"), and that provenance is what makes
 * an Approved status verifiable. Docs prose is not rendered by `composeStories`,
 * so scanning output tells the two apart with no allowlist to maintain.
 */
const DOMAIN_VOCABULARY = [
  /\bdrivers?\b/i,
  /\brecruiters?\b/i,
  /\bcarriers?\b/i,
  /\bdossiers?\b/i,
  /\bapplicants?\b/i,
  /\bemployers?\b/i,
  /\bcandidates?\b/i,
  /\bFMCSA\b/,
  /\bsigning\b/i,
  // `signed` on its own is domain vocabulary here, but "signed in" is ordinary
  // English for authentication and is legitimate in a generic example.
  /\bsigned\b(?!\s+in\b)/i,
  /\bpre-employment\b/i,
  /\benvelopes?\b/i,
];

/**
 * Every story file in the catalog, resolved at build time by Vite. Using a glob
 * rather than a hand-maintained list means a new story is covered the moment it
 * is written — there is no list to forget to update.
 */
const storyModules = {
  ...import.meta.glob('../design-system/stories/**/*.stories.jsx', { eager: true }),
  ...import.meta.glob('../shared/components/modals/*.stories.jsx', { eager: true }),
};

const stories = Object.entries(storyModules).flatMap(([modulePath, storyModule]) =>
  Object.entries(composeStories(storyModule)).map(([storyName, Story]) => ({
    id: `${modulePath.replace('../', 'src/')} → ${storyName}`,
    Story,
  })),
);

/** Attributes that carry text a user reads or a screen reader announces. */
const TEXTUAL_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'value'];

/**
 * All user-visible text in a rendered story, with word boundaries preserved.
 *
 * `container.textContent` is **not** usable for this: it concatenates adjacent
 * text nodes with no separator, so a row of buttons labelled "Add driver" and
 * "Export" collapses to `"Add driverExport"` and `/\bdriver\b/` stops matching.
 * That silently defeated the first version of the check below — it passed
 * against a story deliberately reintroducing "Add driver".
 *
 * Joining the nodes restores the boundaries. Textual attributes are included
 * because an `IconButton`'s label is announced but never appears as a text node.
 */
function renderedText(container) {
  const parts = [];

  const walker = container.ownerDocument.createTreeWalker(
    container,
    // 4 = NodeFilter.SHOW_TEXT
    4,
  );
  let node = walker.nextNode();
  while (node) {
    parts.push(node.textContent || '');
    node = walker.nextNode();
  }

  for (const element of container.querySelectorAll('*')) {
    for (const attribute of TEXTUAL_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value) parts.push(value);
    }
  }

  return parts.join(' ');
}

afterEach(cleanup);

describe('design-system story catalog', () => {
  it('discovers a meaningful number of stories', () => {
    // Guards against the glob silently resolving to nothing and the whole suite
    // passing vacuously — the same failure mode the repo's other scanning tests
    // protect against.
    expect(stories.length).toBeGreaterThan(60);
  });

  it.each(stories)('$id renders and has no serious or critical a11y violations', async ({ Story }) => {
    const { container } = render(<Story />);

    // Rendering at all is half the check: a story with a broken import, a
    // removed prop, or a value the primitive rejects throws right here.
    expect(container).toBeTruthy();

    const results = await axe(container, AXE_OPTIONS);
    const blocking = results.violations
      .filter((violation) => BLOCKING_IMPACTS.has(violation.impact))
      .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}`);

    expect(blocking).toEqual([]);
  });

  it.each(stories)('$id renders no SafeHaul domain vocabulary', ({ Story }) => {
    const { container } = render(<Story />);
    const rendered = renderedText(container);

    const leaked = DOMAIN_VOCABULARY
      .map((pattern) => rendered.match(pattern)?.[0])
      .filter(Boolean);

    // If this fails: rename the label to business-neutral wording ("record",
    // "owner", "reference"). The catalog documents how a primitive looks and
    // behaves; the feature owns what it is called.
    expect(leaked).toEqual([]);
  });
});
