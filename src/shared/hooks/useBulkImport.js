import { useState } from 'react';

/**
 * Shared spreadsheet/Google-Sheet import state machine.
 *
 * @param {object} [options]
 * @param {(message: string) => void} [options.onError] Where import failures are
 *   reported. Defaults to a blocking `window.alert`, which is what every caller
 *   used before the lead-intake design-system migration.
 *
 *   The default is kept deliberately: `AudienceBuilder` (campaigns) also consumes
 *   this hook and was not part of that migration, so omitting the option must
 *   behave exactly as before. `CompanyBulkUpload` passes a sink that renders the
 *   same message as a non-blocking in-page alert instead — a blocking modal
 *   dialog steals focus, cannot be reached by assistive technology as page
 *   content, and halts the JS event loop.
 *
 *   Messages are unchanged in both paths.
 */
export function useBulkImport(options = {}) {
    /**
     * Consumers are expected to pass `onError` and surface the message themselves
     * (a toast, an inline `FieldMessage`, whatever fits the surface).
     *
     * The default used to be `alert(message)`, which froze the tab. Both real
     * consumers now pass a handler — `CompanyBulkUpload` always did, and
     * `AudienceBuilder` was fixed on 2026-07-28 — so this fallback is no longer
     * reachable in the app. It logs instead of blocking, because a hook must not
     * own presentation, and a native prompt is the one sink it cannot style,
     * announce or dismiss consistently.
     */
    const notifyError = options.onError || ((message) => console.error('[useBulkImport]', message));
    const [csvData, setCsvData] = useState([]);
    const [processingSheet, setProcessingSheet] = useState(false);
    const [step, setStep] = useState('upload');
    const [importMethod, setImportMethod] = useState('file');
    const [sheetUrl, setSheetUrl] = useState('');

    const parseBuffer = async (buffer, fileType, fileName) => {
        return new Promise((resolve, reject) => {
            try {
                // Instantiate worker
                const worker = new Worker(new URL('../workers/import.worker.js', import.meta.url), { type: 'module' });

                worker.onmessage = (e) => {
                    const { success, data, error } = e.data;
                    if (success) {
                        setCsvData(data);
                        setStep('preview');
                        resolve();
                    } else {
                        console.error("Worker Parse Error:", error);
                        notifyError("Error reading file: " + error);
                        reject(new Error(error));
                    }
                    worker.terminate();
                };

                worker.onerror = (err) => {
                    console.error("Worker Error:", err);
                    notifyError("Worker failed to process file.");
                    worker.terminate();
                    reject(err);
                };

                worker.postMessage({ buffer, fileType, fileName });

            } catch (err) {
                console.error("Main Thread Error:", err);
                notifyError("Failed to start import worker.");
                reject(err);
            }
        });
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setCsvData([]);
        const reader = new FileReader();
        reader.onload = async (event) => await parseBuffer(event.target.result, file.type, file.name);
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    };

    const handleSheetImport = async () => {
        if (!sheetUrl) return notifyError("Please enter a Google Sheet URL.");
        const matches = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!matches || !matches[1]) return notifyError("Invalid Google Sheet URL.");

        const sheetId = matches[1];
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

        setProcessingSheet(true);
        try {
            const response = await fetch(exportUrl);
            if (!response.ok) throw new Error("Failed to fetch sheet. Make sure the sheet has 'Anyone with the link' access enabled in Google Sheets sharing settings.");
            const arrayBuffer = await response.arrayBuffer();
            await parseBuffer(arrayBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'GoogleSheet.xlsx');
        } catch (error) {
            console.error("Sheet Error:", error);
            notifyError("Error importing sheet: " + error.message);
        } finally {
            setProcessingSheet(false);
        }
    };

    const reset = () => {
        setCsvData([]);
        setStep('upload');
        setSheetUrl('');
    };

    return {
        csvData,
        step, setStep,
        importMethod, setImportMethod,
        sheetUrl, setSheetUrl,
        processingSheet,
        handleFileChange,
        handleSheetImport,
        reset
    };
}
