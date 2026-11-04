/**
 * A scanned document read in the recruiter's own browser, with nothing from a CDN.
 *
 * The OCR engine (tesseract.js's worker, its WebAssembly core and the English
 * data) is served by this site under `/ocr/` (`ocrAssets.js`, `vite.config.js`).
 * jsDelivr, where tesseract.js would fetch it otherwise, is blocked here, so a
 * read that still needs it falls back to page images and fails these cases.
 *
 * Everything is artificial: the text is made up and rendered by the test itself,
 * the upload is the E2E double (`useGuestFileUpload.js`), and the reading
 * callable is answered by the test, which keeps what it was sent.
 */
const { test, expect } = require('@playwright/test');

const START_URL = '/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

// Ten made-up lines, well over the 200 characters a document must yield
// (`MIN_CHARS_PER_DOCUMENT`), so a few misread letters cannot drop it.
const LINES = [
    'ARTIFICIAL SCAN MADE FOR AN AUTOMATED BROWSER TEST',
    'NOTHING ON THIS PAGE IS A REAL RECORD OF ANYONE',
    'CARRIER NAME EXAMPLE FREIGHT LINES OF SPRINGFIELD',
    'ADDRESS ONE HUNDRED SAMPLE ROAD IN SPRINGFIELD',
    'INSPECTION RESULT NO VIOLATIONS FOUND THIS YEAR',
    'CRASH HISTORY NONE RECORDED IN THIS EXAMPLE',
    'EQUIPMENT ONE TRACTOR AND ONE DRY VAN TRAILER',
    'EVERY WORD HERE WAS MADE UP ONLY FOR TESTING',
    'THE READER SHOULD RECOGNISE ALL OF THIS TEXT',
    'END OF THE ARTIFICIAL SCAN FOR THE BROWSER TEST',
];

/** The same page as a photo (PNG) and as an image-only PDF with no text layer. */
async function artificialScan(context) {
    const page = await context.newPage();
    await page.setContent(`<body style="margin:0;padding:32px;background:#fff;color:#000;font:32px/1.5 Arial,sans-serif">${
        LINES.map((line) => `<div>${line}</div>`).join('')}</body>`);
    const png = await page.screenshot({ fullPage: true });
    await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png.toString('base64')}" style="width:100%"></body>`);
    // Chromium only, which is why this spec has no @mobile case.
    const pdf = await page.pdf({ format: 'Letter' });
    await page.close();
    return { png, pdf };
}

/** Answers the reading callable with an error, and keeps each request's data. */
async function captureCallable(page) {
    const sent = [];
    await page.route('**/extractCompanyApplicationDocuments', (route) => {
        // The browser's CORS preflight carries no body: answer it, record nothing.
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        sent.push(route.request().postDataJSON()?.data);
        return route.fulfill({
            status: 500,
            headers: CORS,
            contentType: 'application/json',
            body: JSON.stringify({ error: { status: 'INTERNAL', message: 'answered by the test' } }),
        });
    });
    return sent;
}

test.describe('the document reader recognises a scan in this browser', () => {
    test.describe.configure({ timeout: 90_000 });

    let fromThisSite;
    let fromJsDelivr;

    test.beforeEach(async ({ context }) => {
        fromThisSite = [];
        fromJsDelivr = [];
        await context.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
        // The worker's own requests (importScripts, fetch) are seen here too.
        context.on('request', (request) => {
            const url = new URL(request.url());
            if (url.hostname === 'cdn.jsdelivr.net') fromJsDelivr.push(request.url());
            else if (url.pathname.startsWith('/ocr/')) fromThisSite.push(url.pathname);
        });
    });

    /** Attach one file to `field` in the AI path, read it, and return what the callable got. */
    async function readAttached(page, field, file) {
        const sent = await captureCallable(page);
        await page.goto(START_URL);
        await page.getByRole('button', { name: /Start an application/i }).click();
        await page.getByTestId('mode-ai').click();

        const upload = page.locator(`[data-upload-field="${field}"]`);
        await upload.locator('input[type="file"]').setInputFiles(file);
        await expect(upload).toHaveAttribute('data-upload-state', 'uploaded');

        const read = page.getByTestId('read-documents');
        await expect(read).toHaveText('Read 1 document');
        await read.click();
        await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1);
        return sent[0];
    }

    function expectServedByThisSite() {
        expect(fromThisSite).toEqual(expect.arrayContaining([
            expect.stringMatching(/^\/ocr\/tesseract-[^/]+\/worker\.min\.js$/),
            expect.stringMatching(/^\/ocr\/tesseract-[^/]+\/core\/tesseract-core-[a-z-]*lstm\.wasm\.js$/),
            expect.stringMatching(/^\/ocr\/tesseract-[^/]+\/lang\/eng\.traineddata\.gz$/),
        ]));
        expect(fromThisSite.filter((path) => path.includes('/core/'))).toHaveLength(1);
        expect(fromJsDelivr).toEqual([]);
    }

    test('a scanned PDF is recognised in the browser, from this site', async ({ page, context }) => {
        const { pdf } = await artificialScan(context);
        const data = await readAttached(page, 'psp-report-upload', { name: 'artificial-psp.pdf', mimeType: 'application/pdf', buffer: pdf });

        // Recognised text, not the page images a failed OCR start sends instead.
        expect(Object.keys(data.documents.psp)).toEqual(['text']);
        expect(data.documents.psp.text).toMatch(/ARTIFICIAL/);
        expect(data.documents.psp.text).toMatch(/FREIGHT/);
        expectServedByThisSite();
    });

    test('a photo is recognised in the browser, from this site', async ({ page, context }) => {
        const { png } = await artificialScan(context);
        const data = await readAttached(page, 'medical-card-upload', { name: 'artificial-medical.png', mimeType: 'image/png', buffer: png });

        // Recognised text, not the page images a failed OCR start sends instead.
        expect(Object.keys(data.documents.medical)).toEqual(['text']);
        expect(data.documents.medical.text).toMatch(/ARTIFICIAL/);
        expect(data.documents.medical.text).toMatch(/FREIGHT/);
        expectServedByThisSite();
    });
});
