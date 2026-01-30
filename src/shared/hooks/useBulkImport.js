import { useState } from 'react';

export function useBulkImport() {
    const [csvData, setCsvData] = useState([]);
    const [processingSheet, setProcessingSheet] = useState(false);
    const [step, setStep] = useState('upload');
    const [importMethod, setImportMethod] = useState('file');
    const [sheetUrl, setSheetUrl] = useState('');

    const parseBuffer = async (buffer) => {
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
                        alert("Error reading file: " + error);
                        reject(new Error(error));
                    }
                    worker.terminate();
                };

                worker.onerror = (err) => {
                    console.error("Worker Error:", err);
                    alert("Worker failed to process file.");
                    worker.terminate();
                    reject(err);
                };

                worker.postMessage({ buffer });

            } catch (err) {
                console.error("Main Thread Error:", err);
                alert("Failed to start import worker.");
                reject(err);
            }
        });
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setCsvData([]);
        const reader = new FileReader();
        reader.onload = async (event) => await parseBuffer(event.target.result);
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    };

    const handleSheetImport = async () => {
        if (!sheetUrl) return alert("Please enter a Google Sheet URL.");
        const matches = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!matches || !matches[1]) return alert("Invalid Google Sheet URL.");

        const sheetId = matches[1];
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

        setProcessingSheet(true);
        try {
            const response = await fetch(exportUrl);
            if (!response.ok) throw new Error("Failed to fetch sheet. Check permissions (Anyone with link).");
            const arrayBuffer = await response.arrayBuffer();
            await parseBuffer(arrayBuffer);
        } catch (error) {
            console.error("Sheet Error:", error);
            alert("Error importing sheet: " + error.message);
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
