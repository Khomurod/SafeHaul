/**
 * Optical character recognition, without ever loading the engine.
 *
 * `createWorker` is injected in every test here. Loading the real WebAssembly
 * runtime in jsdom would be slow, flaky and beside the point: what matters is
 * that the worker is created once, used for every page, and terminated whatever
 * happens — a worker left running holds tens of megabytes for the life of the tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OCR_START_TIMEOUT_MS, recognizePages } from './ocrFallback';

let worker;
let createWorker;
let consoleError;

beforeEach(() => {
    vi.resetAllMocks();
    worker = {
        recognize: vi.fn(async (page) => ({ data: { text: `text of ${page}` } })),
        terminate: vi.fn(async () => undefined),
    };
    createWorker = vi.fn(async () => worker);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    consoleError.mockRestore();
});

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

// tesseract.js 7 reports a failed language download or engine start only through
// `errorHandler`; the promise `createWorker` returned does not settle then. Each
// test settles `start` itself once the reader has given up, so nothing is left open.
function engineThatReportsItCannotStart(start) {
    return vi.fn((lang, oem, options) => {
        setTimeout(() => options?.errorHandler?.('initialization failed'), 0);
        return start.promise;
    });
}

/** The start the reader gave up on finishes now, with the fake worker. */
async function startsLate(start) {
    start.resolve(worker);
    await start.promise;
}

describe('recognising pages', () => {
    it('reads every page with one worker and joins the result', async () => {
        const result = await recognizePages(['page-1', 'page-2'], { createWorker });

        expect(createWorker).toHaveBeenCalledTimes(1);
        expect(createWorker).toHaveBeenCalledWith('eng', undefined, expect.objectContaining({ errorHandler: expect.any(Function) }));
        expect(worker.recognize).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ text: 'text of page-1\ntext of page-2', pages: 2 });
    });

    it('collapses the whitespace recognition scatters through its output', async () => {
        worker.recognize.mockResolvedValue({ data: { text: '  ACME   TRUCKING\n\n USDOT  123456 ' } });

        const { text } = await recognizePages(['page-1'], { createWorker });
        expect(text).toBe('ACME TRUCKING USDOT 123456');
    });

    it('terminates the worker even when a page throws', async () => {
        worker.recognize.mockRejectedValue(new Error('bad image'));

        await expect(recognizePages(['page-1'], { createWorker })).rejects.toThrow('bad image');
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('never starts a worker for nothing to read', async () => {
        await expect(recognizePages([], { createWorker })).resolves.toEqual({ text: '', pages: 0 });
        await expect(recognizePages(null, { createWorker })).resolves.toEqual({ text: '', pages: 0 });
        expect(createWorker).not.toHaveBeenCalled();
    });

    it('tolerates a page that recognises to nothing', async () => {
        worker.recognize.mockResolvedValue({ data: {} });
        await expect(recognizePages(['page-1'], { createWorker })).resolves.toEqual({ text: '', pages: 1 });
    });
});

describe('an engine that cannot start', () => {
    it('gives up when the engine reports that it cannot start', async () => {
        const start = deferred();
        createWorker = engineThatReportsItCannotStart(start);

        await expect(recognizePages(['page-1'], { createWorker })).rejects.toThrow(/could not start/);

        await startsLate(start);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.recognize).not.toHaveBeenCalled();
    }, 2_000);

    it('gives up after OCR_START_TIMEOUT_MS when the engine never answers', async () => {
        vi.useFakeTimers();
        const start = deferred();
        createWorker = vi.fn(() => start.promise);

        const reading = expect(recognizePages(['page-1'], { createWorker })).rejects.toThrow(/did not start in time/);
        await vi.advanceTimersByTimeAsync(OCR_START_TIMEOUT_MS);
        await reading;

        expect(consoleError).toHaveBeenCalledTimes(1);
        await startsLate(start);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    }, 2_000);

    it('shuts down an engine that finishes starting after it was given up on', async () => {
        vi.useFakeTimers();
        let resolveLate;
        createWorker = vi.fn(() => new Promise((resolve) => { resolveLate = resolve; }));

        const reading = expect(recognizePages(['page-1'], { createWorker })).rejects.toThrow(/did not start in time/);
        await vi.advanceTimersByTimeAsync(OCR_START_TIMEOUT_MS);
        await reading;

        resolveLate(worker);
        await vi.advanceTimersByTimeAsync(0);

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.recognize).not.toHaveBeenCalled();
    }, 2_000);

    it('logs a failed start once, with the engine status and no document text', async () => {
        const start = deferred();
        createWorker = engineThatReportsItCannotStart(start);

        await expect(recognizePages(['text of a licence'], { createWorker })).rejects.toThrow(/could not start/);

        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledWith(
            '[document reader] OCR could not start',
            expect.any(Error),
            { flow: 'document_reader', stage: 'ocr_start' },
        );
        expect(consoleError.mock.calls[0][1].message).toBe('OCR could not start: initialization failed');
        await startsLate(start);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledTimes(1);
    }, 2_000);

    it('a page that fails after the start still rejects, and is not a failed start', async () => {
        let options;
        createWorker = vi.fn(async (lang, oem, opts) => { options = opts; return worker; });
        worker.recognize = vi.fn(async () => {
            options.errorHandler('bad page');
            throw new Error('bad page');
        });

        await expect(recognizePages(['page-1'], { createWorker })).rejects.toThrow('bad page');
        expect(worker.terminate).toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
    });
});
