/**
 * Contract freeze for the shared `useBulkImport` hook.
 *
 * `useBulkImport` is consumed by BOTH `CompanyBulkUpload` (lead intake) and the
 * campaigns `AudienceBuilder`. The lead-intake migration adds an optional error
 * sink so the feature can replace blocking `alert()` calls; this file freezes
 * the behaviour that must be identical for a caller that passes no options —
 * i.e. `AudienceBuilder` must keep working exactly as before.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBulkImport } from './useBulkImport';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/ARTIFICIAL_SHEET_ID/edit#gid=0';
const EXPORT_URL = 'https://docs.google.com/spreadsheets/d/ARTIFICIAL_SHEET_ID/export?format=xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let alertMock;
let workerInstances;

class FakeWorker {
    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.onmessage = null;
        this.onerror = null;
        this.posted = [];
        this.terminate = vi.fn();
        workerInstances.push(this);
    }

    postMessage(message) {
        this.posted.push(message);
    }
}

/**
 * The hook's failure *messages* are the frozen contract; the sink they go to is
 * the consumer's choice. These tests inject an `onError` spy, which is what both
 * real consumers do.
 *
 * `alertMock` is still stubbed and asserted to be unused: the default sink used to
 * be a blocking `alert()`, and that must not come back.
 */
let onError;

beforeEach(() => {
    workerInstances = [];
    alertMock = vi.fn();
    onError = vi.fn();
    vi.stubGlobal('alert', alertMock);
    vi.stubGlobal('Worker', FakeWorker);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('useBulkImport — preserved contracts', () => {
    it('starts on the upload step with the file method and no data', () => {
        const { result } = renderHook(() => useBulkImport());

        expect(result.current.csvData).toEqual([]);
        expect(result.current.step).toBe('upload');
        expect(result.current.importMethod).toBe('file');
        expect(result.current.sheetUrl).toBe('');
        expect(result.current.processingSheet).toBe(false);
    });

    it('exposes the frozen return shape', () => {
        const { result } = renderHook(() => useBulkImport());
        expect(Object.keys(result.current).sort()).toEqual([
            'csvData',
            'handleFileChange',
            'handleSheetImport',
            'importMethod',
            'processingSheet',
            'reset',
            'setImportMethod',
            'setSheetUrl',
            'setStep',
            'sheetUrl',
            'step',
        ]);
    });

    it('resets data, step and sheet URL but leaves the import method alone', () => {
        const { result } = renderHook(() => useBulkImport());

        act(() => {
            result.current.setStep('preview');
            result.current.setSheetUrl(SHEET_URL);
            result.current.setImportMethod('gsheet');
        });
        expect(result.current.step).toBe('preview');

        act(() => result.current.reset());

        expect(result.current.csvData).toEqual([]);
        expect(result.current.step).toBe('upload');
        expect(result.current.sheetUrl).toBe('');
        expect(result.current.importMethod).toBe('gsheet');
    });

    it('reports a missing sheet URL with the frozen message', async () => {
        const { result } = renderHook(() => useBulkImport({ onError }));
        await act(async () => { await result.current.handleSheetImport(); });
        expect(onError).toHaveBeenCalledWith('Please enter a Google Sheet URL.');
        // The default sink must never be a blocking browser dialog again.
        expect(alertMock).not.toHaveBeenCalled();
    });

    it('reports an unparseable sheet URL with the frozen message', async () => {
        const { result } = renderHook(() => useBulkImport({ onError }));
        act(() => result.current.setSheetUrl('https://example.test/not-a-sheet'));
        await act(async () => { await result.current.handleSheetImport(); });
        expect(onError).toHaveBeenCalledWith('Invalid Google Sheet URL.');
        expect(alertMock).not.toHaveBeenCalled();
    });

    it('derives the xlsx export URL from the sheet id', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(8),
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('alert', alertMock);
        vi.stubGlobal('Worker', FakeWorker);

        const { result } = renderHook(() => useBulkImport());
        act(() => result.current.setSheetUrl(SHEET_URL));
        act(() => { result.current.handleSheetImport(); });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(EXPORT_URL));
        await waitFor(() => expect(workerInstances).toHaveLength(1));
        expect(workerInstances[0].posted[0]).toMatchObject({
            fileType: XLSX_MIME,
            fileName: 'GoogleSheet.xlsx',
        });
    });

    it('reports a sheet fetch failure with the frozen sharing hint', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        vi.stubGlobal('alert', alertMock);

        const { result } = renderHook(() => useBulkImport({ onError }));
        act(() => result.current.setSheetUrl(SHEET_URL));
        await act(async () => { await result.current.handleSheetImport(); });

        expect(onError).toHaveBeenCalledWith(
            "Error importing sheet: Failed to fetch sheet. Make sure the sheet has "
            + "'Anyone with the link' access enabled in Google Sheets sharing settings.",
        );
        expect(alertMock).not.toHaveBeenCalled();
        expect(result.current.processingSheet).toBe(false);
    });

    it('moves to the preview step with the worker rows on a successful parse', async () => {
        const rows = [{ firstName: 'Artificial', lastName: 'Applicant' }];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, arrayBuffer: async () => new ArrayBuffer(8),
        }));
        vi.stubGlobal('alert', alertMock);
        vi.stubGlobal('Worker', FakeWorker);

        const { result } = renderHook(() => useBulkImport());
        act(() => result.current.setSheetUrl(SHEET_URL));
        act(() => { result.current.handleSheetImport(); });

        await waitFor(() => expect(workerInstances).toHaveLength(1));
        await act(async () => {
            workerInstances[0].onmessage({ data: { success: true, data: rows } });
        });

        expect(result.current.csvData).toEqual(rows);
        expect(result.current.step).toBe('preview');
        expect(workerInstances[0].terminate).toHaveBeenCalled();
    });

    it('reports a worker parse failure with the frozen message and stays on upload', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, arrayBuffer: async () => new ArrayBuffer(8),
        }));
        vi.stubGlobal('alert', alertMock);
        vi.stubGlobal('Worker', FakeWorker);

        const { result } = renderHook(() => useBulkImport({ onError }));
        act(() => result.current.setSheetUrl(SHEET_URL));
        act(() => { result.current.handleSheetImport(); });

        await waitFor(() => expect(workerInstances).toHaveLength(1));
        await act(async () => {
            workerInstances[0].onmessage({
                data: { success: false, error: 'artificial parse error' },
            });
        });

        await waitFor(() => expect(onError).toHaveBeenCalledWith(
            'Error reading file: artificial parse error',
        ));
        expect(alertMock).not.toHaveBeenCalled();
        expect(result.current.step).toBe('upload');
    });

    it('ignores a file change with no selected file', async () => {
        const { result } = renderHook(() => useBulkImport());
        await act(async () => {
            await result.current.handleFileChange({ target: { files: [] } });
        });
        expect(workerInstances).toHaveLength(0);
        expect(result.current.step).toBe('upload');
    });

    it('routes a selected file through the worker and clears the input value', async () => {
        const rows = [{ firstName: 'Artificial' }];
        const target = { files: [new File(['a,b'], 'artificial.csv', { type: 'text/csv' })], value: 'x' };

        const { result } = renderHook(() => useBulkImport());
        await act(async () => {
            await result.current.handleFileChange({ target });
        });

        expect(target.value).toBe('');
        await waitFor(() => expect(workerInstances).toHaveLength(1));
        expect(workerInstances[0].posted[0]).toMatchObject({
            fileType: 'text/csv',
            fileName: 'artificial.csv',
        });

        await act(async () => {
            workerInstances[0].onmessage({ data: { success: true, data: rows } });
        });
        expect(result.current.csvData).toEqual(rows);
        expect(result.current.step).toBe('preview');
    });
});
