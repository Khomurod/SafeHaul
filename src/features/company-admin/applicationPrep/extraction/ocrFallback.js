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
 * The engine is ~2MB and the English language data larger still. Neither is
 * fetched until a document actually needs recognising, which for a carrier
 * uploading generated PDFs is never. The dynamic `import()` is what makes that
 * true — a static import would put it in the company workspace's bundle for
 * everybody, including the recruiters who only ever attach real PDFs.
 *
 * The worker and the WebAssembly core are resolved from `node_modules` through
 * Vite, so they are versioned with the dependency and served from this origin.
 * The language data is the one thing fetched from the pinned CDN path tesseract
 * defaults to: it is 11MB, it never changes for a given version, and the library
 * caches it in IndexedDB after the first document.
 */

/** Recognition is slower than a network call; this bounds a stuck worker, not a slow one. */
export const OCR_TIMEOUT_MS = 120000;

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
    const worker = await createWorker('eng');
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
 * The engine itself, loaded on first use and never before.
 *
 * Separated so the dynamic import is one statement with one reason, and so a test
 * can pass `createWorker` directly without the module ever reaching for it.
 */
async function loadTesseract() {
    return import('tesseract.js');
}

export default recognizePages;
