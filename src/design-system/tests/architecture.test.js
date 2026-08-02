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
