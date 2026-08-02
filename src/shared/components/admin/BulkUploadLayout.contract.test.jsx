/**
 * Contract freeze for the shared `BulkUploadLayout`.
 *
 * Written BEFORE the design-system migration. These assertions pin behaviour
 * that every consumer depends on and that presentation work must not change:
 *
 *  - the three step ids/labels and which body renders for each,
 *  - the accepted file formats,
 *  - the `'file'` / `'gsheet'` import-method values,
 *  - preview filtering of internal fields, the 8-column cap and 10-row cap,
 *  - the record count, stats wording, and every callback,
 *  - the `children` / `headerAction` / `instructions` / `onDownloadTemplate`
 *    extension points.
 *
 * Queries are deliberately role-agnostic where the migration is expected to
 * change the widget (a toggle button becoming a radio, for example): the
 * contract is "the control named X does Y", not "X is a <button>".
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkUploadLayout } from './BulkUploadLayout';

function makeProps(overrides = {}) {
    return {
        step: 'upload',
        importMethod: 'file',
        setImportMethod: vi.fn(),
        sheetUrl: '',
        setSheetUrl: vi.fn(),
        processingSheet: false,
        handleSheetImport: vi.fn(),
        handleFileChange: vi.fn(),
        csvData: [],
        reset: vi.fn(),
        onConfirm: vi.fn(),
        onClose: vi.fn(),
        uploading: false,
        progress: '',
        stats: { created: 0, updated: 0 },
        ...overrides,
    };
}

/** Finds an interactive control by accessible name, whatever its role is. */
function control(name) {
    const found = screen.queryByRole('button', { name })
        ?? screen.queryByRole('radio', { name })
        ?? screen.queryByRole('checkbox', { name })
        ?? screen.queryByRole('link', { name })
        ?? screen.queryByLabelText(name);
    expect(found, `a control named ${name} should exist`).toBeTruthy();
    return found;
}

function fileInput() {
    return document.querySelector('input[type="file"]');
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('BulkUploadLayout — preserved contracts', () => {
    it('renders the frozen title and the three step labels', () => {
        render(<BulkUploadLayout {...makeProps({ title: 'Import Private Leads' })} />);

        expect(screen.getByText('Import Private Leads')).toBeInTheDocument();
        expect(screen.getByText('Upload')).toBeInTheDocument();
        expect(screen.getByText('Preview')).toBeInTheDocument();
        expect(screen.getByText('Finish')).toBeInTheDocument();
    });

    it('defaults the title to "Bulk Upload"', () => {
        render(<BulkUploadLayout {...makeProps()} />);
        expect(screen.getByText('Bulk Upload')).toBeInTheDocument();
    });

    it('renders the upload body only for step "upload"', () => {
        const { unmount } = render(<BulkUploadLayout {...makeProps({ step: 'upload' })} />);
        expect(control('Upload File')).toBeTruthy();
        expect(screen.queryByText(/Confirm Upload/)).toBeNull();
        expect(screen.queryByText('Upload Complete!')).toBeNull();
        unmount();
    });

    it('renders the preview body only for step "preview"', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: [{ firstName: 'Artificial' }],
        })} />);

        expect(screen.getByText('Preview (1 records)')).toBeInTheDocument();
        expect(control('Confirm Upload')).toBeTruthy();
        expect(screen.queryByText('Upload Complete!')).toBeNull();
    });

    it('renders the success body only for step "success"', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'success',
            // Deliberately not 1/2/3: those collide with the step-indicator numerals.
            stats: { created: 7, updated: 4 },
        })} />);

        expect(screen.getByText('Upload Complete!')).toBeInTheDocument();
        expect(screen.getAllByText(/\bCreated\b/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/\bUpdated\b/).length).toBeGreaterThan(0);
        expect(screen.getByText('7')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('falls back to zero when stats are missing', () => {
        render(<BulkUploadLayout {...makeProps({ step: 'success', stats: undefined })} />);
        expect(screen.getAllByText('0')).toHaveLength(2);
    });

    it('accepts only .csv, .xlsx and .xls files', () => {
        render(<BulkUploadLayout {...makeProps({ importMethod: 'file' })} />);
        expect(fileInput()).toHaveAttribute('accept', '.csv,.xlsx,.xls');
    });

    it('routes file selection to handleFileChange', () => {
        const props = makeProps({ importMethod: 'file' });
        render(<BulkUploadLayout {...props} />);

        fireEvent.change(fileInput(), { target: { files: [] } });
        expect(props.handleFileChange).toHaveBeenCalledTimes(1);
    });

    it('keeps the "file" and "gsheet" import-method values', () => {
        // Two renders rather than two clicks: post-migration these are radios,
        // and activating the already-selected radio fires no change event.
        const fromFile = makeProps({ importMethod: 'file' });
        const { unmount } = render(<BulkUploadLayout {...fromFile} />);
        fireEvent.click(control('Google Sheet'));
        expect(fromFile.setImportMethod).toHaveBeenCalledWith('gsheet');
        unmount();

        const fromSheet = makeProps({ importMethod: 'gsheet' });
        render(<BulkUploadLayout {...fromSheet} />);
        fireEvent.click(control('Upload File'));
        expect(fromSheet.setImportMethod).toHaveBeenCalledWith('file');
    });

    it('shows the Google Sheet body only for the gsheet method', () => {
        const props = makeProps({ importMethod: 'gsheet', sheetUrl: '' });
        render(<BulkUploadLayout {...props} />);

        expect(fileInput()).toBeNull();
        const url = document.querySelector('input[type="url"]');
        expect(url).toBeTruthy();

        fireEvent.change(url, { target: { value: 'https://docs.google.com/spreadsheets/d/AAA/edit' } });
        expect(props.setSheetUrl).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/AAA/edit');

        expect(screen.getByText(
            'Make sure the sheet is publicly accessible or shared with view permissions.',
        )).toBeInTheDocument();
    });

    it('disables the sheet Import control without a URL and enables it with one', () => {
        const { unmount } = render(<BulkUploadLayout {...makeProps({
            importMethod: 'gsheet', sheetUrl: '',
        })} />);
        expect(control('Import')).toBeDisabled();
        unmount();

        const props = makeProps({ importMethod: 'gsheet', sheetUrl: 'https://docs.google.com/spreadsheets/d/AAA/edit' });
        render(<BulkUploadLayout {...props} />);
        const importControl = control('Import');
        expect(importControl).not.toBeDisabled();
        fireEvent.click(importControl);
        expect(props.handleSheetImport).toHaveBeenCalledTimes(1);
    });

    it('disables the sheet Import control while a sheet is processing', () => {
        render(<BulkUploadLayout {...makeProps({
            importMethod: 'gsheet',
            sheetUrl: 'https://docs.google.com/spreadsheets/d/AAA/edit',
            processingSheet: true,
        })} />);
        expect(control('Import')).toBeDisabled();
    });

    it('renders the CSV template control only when onDownloadTemplate is provided', () => {
        const { unmount } = render(<BulkUploadLayout {...makeProps()} />);
        expect(screen.queryByText('Download CSV Template')).toBeNull();
        unmount();

        const onDownloadTemplate = vi.fn();
        render(<BulkUploadLayout {...makeProps({ onDownloadTemplate })} />);
        fireEvent.click(control('Download CSV Template'));
        expect(onDownloadTemplate).toHaveBeenCalledTimes(1);
    });

    it('renders instructions verbatim when provided', () => {
        render(<BulkUploadLayout {...makeProps({ instructions: 'Line one.\nLine two.' })} />);
        expect(screen.getByText(/Line one\./)).toBeInTheDocument();
        expect(screen.getByText(/Line two\./)).toBeInTheDocument();
        expect(screen.getByText('Instructions')).toBeInTheDocument();
    });

    it('renders headerAction and the close control', () => {
        const props = makeProps({ headerAction: <span>Artificial header action</span> });
        render(<BulkUploadLayout {...props} />);

        expect(screen.getByText('Artificial header action')).toBeInTheDocument();

        // Resilient on purpose: pre-migration this control is an icon-only
        // <button> with NO accessible name (the defect the migration fixes), so
        // the freeze locks the *callback*, not the name. The accessible name is
        // asserted separately in `BulkUploadLayout.a11y.test.jsx`.
        const closeControl = screen.queryByRole('button', { name: /^close$/i })
            ?? document.querySelector('.lucide-x')?.closest('button');
        expect(closeControl, 'the header exposes a close control').toBeTruthy();
        fireEvent.click(closeControl);
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('renders children above the preview table', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: [{ firstName: 'Artificial' }],
            children: <p>Artificial preview slot</p>,
        })} />);
        expect(screen.getByText('Artificial preview slot')).toBeInTheDocument();
    });

    it('does not render children outside the preview step', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'upload',
            children: <p>Artificial preview slot</p>,
        })} />);
        expect(screen.queryByText('Artificial preview slot')).toBeNull();
    });

    it('filters internal/system fields out of the preview columns', () => {
        const row = {
            firstName: 'Artificial',
            __rowNum: 1, __parsed: true, __index: 0, _raw: 'x',
            id: 'a', uid: 'b', createdAt: 'c', updatedAt: 'd',
            companyId: 'e', assignedTo: 'f', sourceType: 'g',
            status: 'h', lifecycle: 'i', processingStatus: 'j',
            lastName: 'Applicant',
        };
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData: [row] })} />);

        const table = screen.getByRole('table');
        const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent.trim());
        expect(headers).toEqual(['firstName', 'lastName']);
        for (const hidden of [
            '__rowNum', '__parsed', '__index', '_raw', 'id', 'uid', 'createdAt',
            'updatedAt', 'companyId', 'assignedTo', 'sourceType', 'status',
            'lifecycle', 'processingStatus',
        ]) {
            expect(headers).not.toContain(hidden);
        }
    });

    it('caps the preview at 8 visible columns', () => {
        const row = Object.fromEntries(
            Array.from({ length: 20 }, (_, i) => [`col${i}`, `value${i}`]),
        );
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData: [row] })} />);

        const table = screen.getByRole('table');
        const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent.trim());
        expect(headers).toHaveLength(8);
        expect(headers).toEqual([
            'col0', 'col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7',
        ]);
    });

    it('caps the preview at 10 rows while reporting the full record count', () => {
        const csvData = Array.from({ length: 250 }, (_, i) => ({
            firstName: `Artificial${i}`,
        }));
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData })} />);

        expect(screen.getByText('Preview (250 records)')).toBeInTheDocument();
        const table = screen.getByRole('table');
        // 10 body rows; the header row is the only extra one.
        const bodyRows = within(table).getAllByRole('row').length - 1;
        expect(bodyRows).toBe(10);
        expect(screen.getByText('Artificial0')).toBeInTheDocument();
        expect(screen.getByText('Artificial9')).toBeInTheDocument();
        expect(screen.queryByText('Artificial10')).toBeNull();
    });

    it('renders every column of every previewed row, using the first row for keys', () => {
        const csvData = [
            { firstName: 'Artificial', lastName: 'One' },
            { firstName: 'Artificial', lastName: 'Two' },
        ];
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData })} />);
        expect(screen.getByText('One')).toBeInTheDocument();
        expect(screen.getByText('Two')).toBeInTheDocument();
    });

    it('renders empty cells for values missing from a later row', () => {
        const csvData = [
            { firstName: 'Artificial', lastName: 'One' },
            { firstName: 'Artificial' },
        ];
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData })} />);
        expect(screen.getByText('One')).toBeInTheDocument();
        // Nothing throws, and the second row still renders its firstName.
        expect(screen.getAllByText('Artificial')).toHaveLength(2);
    });

    it('wires Reset and Confirm Upload on the preview step', () => {
        const props = makeProps({ step: 'preview', csvData: [{ firstName: 'A' }] });
        render(<BulkUploadLayout {...props} />);

        fireEvent.click(control('Reset'));
        expect(props.reset).toHaveBeenCalledTimes(1);

        fireEvent.click(control('Confirm Upload'));
        expect(props.onConfirm).toHaveBeenCalledTimes(1);
    });

    it('disables Confirm Upload while uploading and surfaces the progress string', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: [{ firstName: 'A' }],
            uploading: true,
            progress: 'Processing 3 / 10...',
        })} />);

        // Location-agnostic on purpose: pre-migration the progress string is the
        // confirm button's own label; post-migration it moves to a live region so
        // it is actually announced. Either way it must be shown exactly once and
        // the confirm control must be disabled.
        expect(screen.getByText('Processing 3 / 10...')).toBeInTheDocument();
        const confirm = screen.getByRole('button', { name: /confirm upload|processing/i });
        expect(confirm).toBeDisabled();
    });

    it('falls back to "Processing..." when uploading without a progress string', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: [{ firstName: 'A' }],
            uploading: true,
            progress: '',
        })} />);
        expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    it('closes from the success step', () => {
        const props = makeProps({ step: 'success', stats: { created: 1, updated: 0 } });
        render(<BulkUploadLayout {...props} />);

        fireEvent.click(control('Close'));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });
});
