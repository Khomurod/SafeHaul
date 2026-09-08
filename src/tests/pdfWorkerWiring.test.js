/**
 * The pdf.js worker is wired in `@lib/pdf/pdfWorker`, imported by the modules
 * that render or read a PDF — not in the entry. Two things must stay true:
 *
 *  1. Nothing in the entry graph's hand-written root (`src/main.jsx`, `src/App.jsx`)
 *     imports `react-pdf`, or the 399 kB pdfjs chunk ships to every route again
 *     (audit step I, 2026-09-06: it was preloaded on `/apply` and `/login`).
 *  2. Every non-test module that imports `react-pdf` also imports the wiring, or
 *     pdf.js falls back to a fake worker on the main thread — slow, and a
 *     console error nobody reads.
 *
 * Scope from `git ls-files`, like the other tree-shape guards.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const sourceFiles = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((p) => /\.[jt]sx?$/.test(p) && !/\.(test|spec|stories)\.[jt]sx?$/.test(p) && !/\.support\.[jt]sx?$/.test(p));
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const importsReactPdf = (src) => /from ['"]react-pdf['"]/.test(src);

describe('pdf.js worker wiring', () => {
    it('keeps react-pdf out of the entry root', () => {
        for (const entry of ['src/main.jsx', 'src/App.jsx']) {
            expect(importsReactPdf(read(entry)), `${entry} must not import react-pdf`).toBe(false);
        }
    });

    it('every module that imports react-pdf also imports the worker wiring', () => {
        const importers = sourceFiles.filter((p) => p !== 'src/lib/pdf/pdfWorker.js' && importsReactPdf(read(p)));
        expect(importers.length).toBeGreaterThan(3); // the scan must still be finding the PDF features
        const unwired = importers.filter((p) => !/@lib\/pdf\/pdfWorker/.test(read(p)));
        expect(unwired, 'import "@lib/pdf/pdfWorker" beside the react-pdf import').toEqual([]);
    });

    it('the wiring points at the vendored worker, not a CDN', () => {
        const src = read('src/lib/pdf/pdfWorker.js');
        expect(src).toMatch(/PDF_WORKER_SRC = '\/pdf\.worker\.min\.mjs'/);
        expect(src).not.toMatch(/https?:\/\//);
    });
});
