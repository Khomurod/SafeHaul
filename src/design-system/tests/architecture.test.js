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

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

describe('design-system dependency boundary', () => {
  it('does not import application features, context, or Firebase', () => {
    const violations = [];

    for (const file of sourceFiles(designSystemRoot)) {
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
});
