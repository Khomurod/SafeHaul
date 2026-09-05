import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every declared `--ds-*` token must be referenced by something.
 *
 * ## Why this exists
 *
 * A 2026-09-04 audit found **fourteen** tokens that nothing used: five palette
 * steps, two duplicates of the brand colours under an older name, two spacing
 * steps, three type roles and a duration. None of them was wrong; they had
 * simply outlived their consumer, and nothing noticed because a token costs
 * nothing to keep.
 *
 * That is the problem. A vocabulary nobody prunes stops being a vocabulary and
 * becomes a list — the next person reads `--ds-color-teal-500` beside
 * `--ds-color-brand-mint`, cannot tell which is live, and picks one. Thirteen
 * were deleted on 2026-09-05; this is what stops the next thirteen.
 *
 * ## What counts as a consumer
 *
 * Deliberately generous, because a false failure here gets the test deleted:
 *
 *   - a `var(--ds-…)` anywhere in the tree, **including inside another token's
 *     value** — a foundation step consumed only by a semantic role is exactly
 *     the layering this system is built on;
 *   - a mapping in `tailwind.config.js` or the Storybook config, which is how a
 *     token becomes a utility class;
 *   - a mention in `index.html`, which Tailwind also scans.
 *
 * What does NOT count is the declaration itself. That is the whole point: a
 * token that appears exactly once, where it is defined, is unreferenced. Nor
 * does a **test**: a token asserted on only by a test is still dead in the
 * product, because the test is describing something nothing renders.
 *
 * Names are compared as whole names, never as substrings. Under a substring
 * search `--ds-page-gutter` is satisfied by any mention of
 * `--ds-page-gutter-mobile`, so a token whose name is a prefix of another's
 * could never be reported at all. (That pair is a near miss rather than a
 * finding: the desktop role is mapped as a Tailwind spacing utility and is
 * live; only the mobile half was dead. The hole is real regardless.)
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const tokenFiles = ['foundation.css', 'semantic.css']
  .map((file) => path.join(here, '../tokens', file));

/** Every `--ds-*` this system declares, with the file that declares it. */
function declaredTokens() {
  const declared = new Map();
  for (const file of tokenFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^\s*(--ds-[\w-]+)\s*:/gm)) {
      declared.set(match[1], path.basename(file));
    }
  }
  return declared;
}

/**
 * Every file that could reference a token.
 *
 * A directory walk rather than a hand-written list, because a hand-written list
 * is the same hazard one level up: a new directory of stylesheets would be
 * invisible to it, and every token used only there would read as dead.
 */
function referencingSources(directory, collected = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      referencingSources(target, collected);
      continue;
    }
    /*
     * Tests are NOT consumers, and excluding them is a rule rather than a
     * convenience. A token asserted on only by a test is still dead in the
     * product — the test is describing something nothing renders. It also
     * removes this file's own self-reference, which is what caught the omission:
     * the first version read itself and its own sentinel string satisfied the
     * corpus.
     */
    if (/\.(?:test|spec)\.[jt]sx?$/.test(entry.name)) continue;
    if (/\.(?:[jt]sx?|css|html|mjs|cjs)$/.test(entry.name)) collected.push(target);
  }
  return collected;
}

const declared = declaredTokens();
const searched = [
  ...referencingSources(path.join(repoRoot, 'src')),
  ...referencingSources(path.join(repoRoot, '.storybook')),
  path.join(repoRoot, 'tailwind.config.js'),
  path.join(repoRoot, 'index.html'),
].filter((file) => fs.existsSync(file));

const corpus = searched
  .map((file) => (tokenFiles.includes(file)
    // A token file counts as a consumer of OTHER tokens, never of itself: its
    // declarations are stripped so `--ds-x: …;` cannot satisfy `--ds-x`.
    ? fs.readFileSync(file, 'utf8').replace(/^\s*--ds-[\w-]+\s*:/gm, '')
    : fs.readFileSync(file, 'utf8')))
  .join('\n');

/**
 * Every token NAME the corpus mentions, as whole names.
 *
 * A set rather than a substring search, and that is a correction rather than a
 * style choice. The first version asked `corpus.includes(token)`, under which
 * `--ds-page-gutter` is satisfied by any mention of `--ds-page-gutter-mobile` —
 * so a token whose name is a prefix of another token's name could never be
 * reported at all. Any check that matches names by substring has this hole.
 */
const referenced = new Set(
  [...corpus.matchAll(/--ds-[\w-]+/g)].map((match) => match[0]),
);

describe('every declared token has a consumer', () => {
  // Mutation: add `--ds-color-unused: #fff;` to foundation.css and this fails,
  // naming it. That is the whole contract.
  it('names any token nothing references', () => {
    const orphans = [...declared]
      .filter(([token]) => !referenced.has(token))
      .map(([token, file]) => `${token} (declared in ${file})`);

    expect(orphans, 'A token nothing references is a word nobody can look up. '
      + 'Delete it, or use it — do not leave it for the next reader to guess about.')
      .toEqual([]);
  });

  /*
   * The corpus has to be real, or the assertion above passes over an empty
   * string. This is the `MINIMUM_SCANNED_FILES` lesson from the UI-contract
   * guard, one system over: the way a check fails is by quietly looking at less.
   */
  it('actually read the tree it claims to have searched', () => {
    expect(searched.length).toBeGreaterThan(400);
    expect(corpus.length).toBeGreaterThan(500_000);
  });

  it('found the tokens it is checking', () => {
    expect(declared.size).toBeGreaterThan(100);
  });

  /*
   * And the check must be able to fail. A `.includes` over a corpus that
   * happened to contain every string would be indistinguishable from a working
   * test, so this drives a token that certainly is not there.
   */
  it('reports a token that is genuinely absent', () => {
    // Built by concatenation so the literal cannot appear in any scanned file,
    // this one included, however the exclusions above are later changed.
    const absent = `--ds-color-${'certainly'}-not-declared-anywhere`;
    expect(referenced.has(absent)).toBe(false);
    // And a prefix must not be satisfied by a longer name that contains it.
    expect(referenced.has(`--ds-${'space'}`)).toBe(false);
  });
});
