// @vitest-environment node
/**
 * The OCR engine's files come from this site, and are the ones installed.
 *
 * Read against the installed tesseract.js, so a version bump or a renamed core
 * fails here, as the pdf.js worker's version does in `pdfWorkerWiring.test.js`,
 * instead of in a recruiter's browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    OCR_ASSET_BASE,
    OCR_ASSET_FILES,
    OCR_CORE_PATH,
    OCR_ENGINE_MODE,
    OCR_LANG_PATH,
    OCR_WORKER_PATH,
} from './ocrAssets';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const installed = (file) => readFileSync(require.resolve(file), 'utf8');

describe('the OCR engine, served by this site', () => {
    it('is versioned with the installed tesseract.js', () => {
        expect(OCR_ASSET_BASE).toBe(`/ocr/tesseract-${require('tesseract.js/package.json').version}`);
    });

    it('runs in the LSTM-only mode the served cores are built for', () => {
        expect(OCR_ENGINE_MODE).toBe(require('tesseract.js/src/constants/OEM.js').LSTM_ONLY);
    });

    it('serves every core tesseract.js can pick for that mode', () => {
        const names = [...new Set(installed('tesseract.js/src/worker-script/browser/getCore.js')
            .match(/tesseract-core[A-Za-z-]*-lstm[.]wasm[.]js/g))];
        expect(names.length).toBeGreaterThanOrEqual(3);
        for (const name of names) expect(OCR_ASSET_FILES).toHaveProperty([`core/${name}`]);
    });

    it('serves the English data from the directory tesseract.js would download it from', () => {
        const workerScript = installed('tesseract.js/src/worker-script/index.js');
        expect(workerScript).toContain('@tesseract.js-data/');
        expect(workerScript).toContain('4.0.0_best_int');
        expect(OCR_ASSET_FILES['lang/eng.traineddata.gz']).toMatch(/^@tesseract\.js-data\/eng\/4\.0\.0_best_int\//);
    });

    it('copies each file from one that is installed', () => {
        for (const [served, source] of Object.entries(OCR_ASSET_FILES)) {
            expect(existsSync(require.resolve(source)), `${served} from ${source}`).toBe(true);
        }
    });

    it('names no CDN, and every path is under this site', () => {
        for (const file of ['ocrFallback.js', 'ocrAssets.js']) {
            expect(readFileSync(`${here}/${file}`, 'utf8'), file).not.toContain('https://');
        }
        for (const path of [OCR_WORKER_PATH, OCR_CORE_PATH, OCR_LANG_PATH]) {
            expect(path.startsWith(`${OCR_ASSET_BASE}/`), path).toBe(true);
        }
        // What tesseract.js requests under each path is a file this site serves.
        const served = (url) => url.slice(OCR_ASSET_BASE.length + 1);
        expect(OCR_ASSET_FILES).toHaveProperty([served(OCR_WORKER_PATH)]);
        expect(OCR_ASSET_FILES).toHaveProperty([`${served(OCR_LANG_PATH)}/eng.traineddata.gz`]);
        expect(Object.keys(OCR_ASSET_FILES).filter((key) => key.startsWith(`${served(OCR_CORE_PATH)}/`))).toHaveLength(3);
    });
});
