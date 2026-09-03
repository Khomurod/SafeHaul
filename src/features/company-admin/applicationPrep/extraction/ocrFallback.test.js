/**
 * Optical character recognition, without ever loading the engine.
 *
 * `createWorker` is injected in every test here. Loading the real WebAssembly
 * runtime in jsdom would be slow, flaky and beside the point: what matters is
 * that the worker is created once, used for every page, and terminated whatever
 * happens — a worker left running holds tens of megabytes for the life of the tab.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recognizePages } from './ocrFallback';

let worker;
let createWorker;

beforeEach(() => {
    worker = {
        recognize: vi.fn(async (page) => ({ data: { text: `text of ${page}` } })),
        terminate: vi.fn().mockResolvedValue(undefined),
    };
    createWorker = vi.fn().mockResolvedValue(worker);
});

describe('recognising pages', () => {
    it('reads every page with one worker and joins the result', async () => {
        const result = await recognizePages(['page-1', 'page-2'], { createWorker });

        expect(createWorker).toHaveBeenCalledTimes(1);
        expect(createWorker).toHaveBeenCalledWith('eng');
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
