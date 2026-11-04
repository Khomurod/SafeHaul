/**
 * Where the in-browser OCR engine's files are served: by this site, never a CDN.
 *
 * The same rule as the pdf.js worker (`src/lib/pdf/pdfWorker.js`): an outage or a
 * block of someone else's host must not stop a recruiter's scans being read, and
 * the security policy allows the engine only from this site. The files are not
 * committed. `vite.config.js` (`serveOcrAssets`) copies each one from
 * `node_modules` into the build and serves it on the dev server, at the same URL.
 * `ocrAssets.test.js` checks them against the installed tesseract.js.
 *
 * Plain constants and no imports: `vite.config.js` reads this module in Node.
 */

/** Change with tesseract.js: the build refuses a version it does not name. */
export const OCR_ASSET_BASE = '/ocr/tesseract-7.0.0';
export const OCR_WORKER_PATH = `${OCR_ASSET_BASE}/worker.min.js`;
/** A directory: tesseract.js picks the build this browser supports. */
export const OCR_CORE_PATH = `${OCR_ASSET_BASE}/core`;
export const OCR_LANG_PATH = `${OCR_ASSET_BASE}/lang`;
/** tesseract.js OEM.LSTM_ONLY, its default: the cores below are the LSTM-only builds. */
export const OCR_ENGINE_MODE = 1;

/** Each served file under OCR_ASSET_BASE, by the installed file it is copied from. */
export const OCR_ASSET_FILES = {
    'worker.min.js': 'tesseract.js/dist/worker.min.js',
    'core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'core/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'core/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
    'lang/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
