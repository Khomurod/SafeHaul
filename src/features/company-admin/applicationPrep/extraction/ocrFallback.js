/**
 * Optical character recognition, in the recruiter's own browser.
 *
 * For the documents a text layer cannot help with: a photograph of a licence, a
 * scan of a medical card, a PSP report somebody printed and re-scanned. Tesseract
 * is the open-source engine for this, and running it here rather than in a Cloud
 * Function keeps a WebAssembly runtime and its language data off the server
 * entirely — no cold start, no memory ceiling, no per-request cost.
 *
 * ## Everything about it is lazy, deliberately
 *
 * Nothing is fetched until a document actually needs recognising, which for a
 * carrier uploading generated PDFs is never. tesseract's own code is a 17 kB
 * chunk the dynamic `import()` loads; a static import would put it in the company
 * workspace's bundle for everybody. Its worker (111 kB) then fetches one
 * WebAssembly core, about 1.5 MB compressed, picked for what this browser
 * supports, and the English data for the LSTM-only engine, about 3 MB, which the
 * library caches in IndexedDB after the first document.
 *
 * All of it is served by this site under `OCR_ASSET_BASE` (`ocrAssets.js`),
 * never a CDN: the pdf.js worker's rule (`src/lib/pdf/pdfWorker.js`).
 *
 * ## A start that never finishes
 *
 * tesseract.js 7 settles `createWorker` only when its worker script fails
 * (`createWorker.js:44,47`) or its `load` job does (`:213`). A failed language
 * download or engine initialisation rejects only its own job, and the start-up
 * chain ends in `.catch(() => {})` (`:239-243`), so the promise never settles; a
 * WebAssembly compile the page refuses never answers at all. `startWorker` gives
 * up on the first error `errorHandler` reports, or after `OCR_START_TIMEOUT_MS`,
 * and the pipeline sends the page images to the vision AI instead. In both
 * never-settling cases tesseract.js returns no handle to terminate, so its worker
 * stays alive until the tab closes; that happens only when the engine cannot start.
 *
 * `errorHandler` also stops the library throwing uncaught errors for pages that
 * fail after the start. Those still reject `recognize`, and the fallback is the
 * vision route, as before.
 */

import { OCR_CORE_PATH, OCR_ENGINE_MODE, OCR_LANG_PATH, OCR_WORKER_PATH } from './ocrAssets';

// A first OCR in a browser downloads about 4.5MB before the engine can start.
export const OCR_START_TIMEOUT_MS = 60_000;

/**
 * Recognise text in already-rendered page images.
 *
 * @param {string[]} imageDataUrls rendered pages, first page first
 * @param {object} [deps] injection seam — tests never load the real WebAssembly
 * @returns {Promise<{text: string, pages: number}>}
 */
export async function recognizePages(imageDataUrls, deps = {}) {
    const pages = Array.isArray(imageDataUrls) ? imageDataUrls : [];
    if (pages.length === 0) return { text: '', pages: 0 };

    const createWorker = deps.createWorker || (await loadTesseract()).createWorker;
    const worker = await startWorker(createWorker);
    try {
        const recognised = [];
        for (const page of pages) {
            const result = await worker.recognize(page);
            recognised.push(String(result?.data?.text || '').replace(/\s+/g, ' ').trim());
        }
        return { text: recognised.join('\n').trim(), pages: pages.length };
    } finally {
        // Frees the WebAssembly heap. A worker left running holds tens of
        // megabytes for as long as the tab is open.
        await worker.terminate?.();
    }
}

/**
 * `createWorker('eng', …)` from this site's files, bounded: rejects on the first
 * start error tesseract reports or after `OCR_START_TIMEOUT_MS`, and logs that
 * failure once.
 */
async function startWorker(createWorker) {
    let started = false;
    let giveUp;
    const failed = new Promise((_, reject) => { giveUp = reject; });
    const pending = createWorker('eng', OCR_ENGINE_MODE, {
        workerPath: OCR_WORKER_PATH,
        corePath: OCR_CORE_PATH,
        langPath: OCR_LANG_PATH,
        // tesseract.js 7 settles createWorker only when its worker script or core
        // fails to load; a failed language download or engine start arrives here,
        // and without this option it is thrown as an uncaught error instead.
        errorHandler: (reason) => { if (!started) giveUp(new Error(`OCR could not start: ${reason}`)); },
    });
    const timer = setTimeout(() => giveUp(new Error('OCR did not start in time')), OCR_START_TIMEOUT_MS);
    try {
        const worker = await Promise.race([pending, failed]);
        started = true;
        return worker;
    } catch (reason) {
        started = true;
        const error = reason instanceof Error ? reason : new Error(`OCR could not start: ${reason}`);
        // A start that completes after we gave up still holds the WebAssembly heap.
        pending.then((late) => late?.terminate?.(), () => {});
        // The engine's status only: never page text.
        console.error('[document reader] OCR could not start', error, { flow: 'document_reader', stage: 'ocr_start' });
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The engine itself, loaded on first use and never before.
 *
 * Separated so the dynamic import is one statement with one reason, and so a test
 * can pass `createWorker` directly without the module ever reaching for it.
 */
async function loadTesseract() {
    return import('tesseract.js');
}

export default recognizePages;
