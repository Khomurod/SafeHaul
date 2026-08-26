import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const designSystemRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const forbiddenDependencies = [
  /@features(?:\/|['"])/,
  /@\/context(?:\/|['"])/,
  /@lib\/firebase(?:\/|['"])/,
  /from\s+['"]firebase(?:\/|['"])/,
  /(?:^|[/\\])features[/\\]/,
  /*
   * `shared` is a compatibility layer that imports *from* the design system, so
   * a dependency in this direction is a cycle. It was not enforceable until
   * 2026-08-21: `ConfirmDialog` composes `Modal`, `Modal` lived in
   * `shared/components/modals`, and the pair could only move together. They now
   * live in `patterns/modal`, so the rule can finally be a rule.
   */
  /@shared(?:\/|['"])/,
  /from\s+['"](?:\.\.\/)+shared[/'"]/,
];

function sourceFiles(directory, pattern) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target, pattern);
    return pattern.test(entry.name) ? [target] : [];
  });
}

describe('design-system dependency boundary', () => {
  it('does not import application features, context, or Firebase', () => {
    const violations = [];

    for (const file of sourceFiles(designSystemRoot, /\.(?:js|jsx|ts|tsx)$/)) {
      if (file === fileURLToPath(import.meta.url)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenDependencies) {
        if (pattern.test(source)) {
          violations.push(path.relative(designSystemRoot, file));
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /*
   * The JavaScript half of this rule shipped on 2026-08-21 and the README said
   * the boundary was enforced. It was not: the walker only looked at
   * `.js/.jsx/.ts/.tsx`, and `design-system/index.css` ended with
   *
   *     @import '../shared/styles/designTokens.css';
   *
   * for the whole campaign. A stylesheet crossing the boundary is the same cycle
   * as a module crossing it, and it is worse in one way — a token file loaded
   * from `shared` is a second source of truth for the thing this directory
   * exists to own, and nothing above would ever have said so.
   */
  it('does not reach outside itself from a stylesheet either', () => {
    const escapes = [];
    // `@import '…'` / `@import url(…)` and any `url(…)` asset reference.
    const references = /(?:@import\s+(?:url\(\s*)?|url\(\s*)['"]?([^'")\s;]+)/g;
    /*
     * Comments have to go first, and finding that out is the reason to say so:
     * this repository documents the imports it removed, so `index.css` and
     * `tokens/typeface.css` both QUOTE the two references this rule exists to
     * forbid. Matching them reported a fixed defect as a live one — which is also
     * proof the rule fires on the real thing.
     */
    const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

    for (const file of sourceFiles(designSystemRoot, /\.css$/)) {
      const source = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const [, reference] of source.matchAll(references)) {
        // A bare `data:` payload or an absolute remote URL is not a path.
        if (/^(?:data:|https?:|\/\/)/.test(reference)) {
          escapes.push(`${path.relative(designSystemRoot, file)} -> ${reference}`);
          continue;
        }
        if (reference.startsWith('/')) continue;
        const resolved = path.resolve(path.dirname(file), reference);
        if (!resolved.startsWith(`${designSystemRoot}${path.sep}`)) {
          escapes.push(`${path.relative(designSystemRoot, file)} -> ${reference}`);
        }
      }
    }

    expect(escapes).toEqual([]);
  });

  /*
   * The rule above is only worth having if it fails on the thing it was written
   * for. Both halves are asserted here rather than trusted, because a
   * path-resolution rule is easy to write in a way that resolves everything
   * inside and therefore never fires.
   */
  it('that stylesheet rule fails on a reference that leaves the directory', () => {
    const outside = (reference) => {
      const resolved = path.resolve(path.join(designSystemRoot, 'tokens'), reference);
      return !resolved.startsWith(`${designSystemRoot}${path.sep}`);
    };

    // The import that was actually there, and a remote webfont.
    expect(outside('../../shared/styles/designTokens.css')).toBe(true);
    expect(outside('../../features/anything.css')).toBe(true);
    // ...and a legitimate one is not reported.
    expect(outside('../fonts/InterVariable.woff2')).toBe(false);
    expect(outside('./semantic.css')).toBe(false);
  });
});
