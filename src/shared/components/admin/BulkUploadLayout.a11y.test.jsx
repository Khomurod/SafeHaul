/**
 * Accessibility and defect-fix proof for the migrated `BulkUploadLayout`.
 *
 * The companion `BulkUploadLayout.contract.test.jsx` freezes the behaviour that
 * must NOT change. This file asserts what the design-system migration was for:
 * every item here was measurably broken before it.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkUploadLayout } from './BulkUploadLayout';

function makeProps(overrides = {}) {
    return {
        title: 'Import Private Leads',
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
        instructions: 'Format: CSV, XLS, or XLSX.',
        onDownloadTemplate: vi.fn(),
        ...overrides,
    };
}

const PREVIEW_ROWS = [
    { firstName: 'Artificial', lastName: 'One', email: 'one@example.test' },
    { firstName: 'Artificial', lastName: 'Two', email: 'two@example.test' },
];

beforeEach(() => {
    vi.clearAllMocks();
});

describe('BulkUploadLayout — dialog semantics (defect 1)', () => {
    it('is a labelled modal dialog when it is an overlay', () => {
        render(<BulkUploadLayout {...makeProps()} />);

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Import Private Leads');
    });

    it('moves focus into the dialog on open', () => {
        render(<BulkUploadLayout {...makeProps()} />);
        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    it('closes on Escape', () => {
        const props = makeProps();
        render(<BulkUploadLayout {...props} />);

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps Tab inside the dialog', () => {
        render(<BulkUploadLayout {...makeProps()} />);
        const dialog = screen.getByRole('dialog');

        const focusable = [...dialog.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        )];
        expect(focusable.length).toBeGreaterThan(1);

        focusable[focusable.length - 1].focus();
        fireEvent.keyDown(dialog, { key: 'Tab' });
        expect(document.activeElement).toBe(focusable[0]);
    });
});

describe('BulkUploadLayout — embedded mode (defect 2)', () => {
    it('renders in place with no dialog and no overlay when embedded', () => {
        render(<BulkUploadLayout {...makeProps({ isEmbedded: true })} />);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.querySelector('.fixed.inset-0')).toBeNull();
        expect(screen.getByRole('region', { name: 'Import Private Leads' })).toBeInTheDocument();
    });

    it('still renders every step body when embedded', () => {
        const { unmount } = render(<BulkUploadLayout {...makeProps({
            isEmbedded: true, step: 'preview', csvData: PREVIEW_ROWS,
        })} />);
        expect(screen.getByRole('table', { name: 'Import preview' })).toBeInTheDocument();
        unmount();

        render(<BulkUploadLayout {...makeProps({ isEmbedded: true, step: 'success' })} />);
        expect(screen.getByText('Upload Complete!')).toBeInTheDocument();
    });
});

describe('BulkUploadLayout — named controls (defects 3, 5, 6)', () => {
    it('names the header close control distinctly from the success Close button', () => {
        render(<BulkUploadLayout {...makeProps()} />);
        expect(screen.getByRole('button', { name: 'Close import' })).toBeInTheDocument();
    });

    it('exposes the import methods as a named radio group with a selected state', () => {
        render(<BulkUploadLayout {...makeProps({ importMethod: 'gsheet' })} />);

        const group = screen.getByRole('group', { name: 'Import method' });
        expect(group).toBeInTheDocument();

        const file = within(group).getByRole('radio', { name: 'Upload File' });
        const sheet = within(group).getByRole('radio', { name: 'Google Sheet' });
        expect(file).not.toBeChecked();
        expect(sheet).toBeChecked();
    });

    it('gives the Google Sheet URL field an accessible name', () => {
        render(<BulkUploadLayout {...makeProps({ importMethod: 'gsheet' })} />);
        expect(screen.getByRole('textbox', { name: 'Google Sheet URL' })).toBeInTheDocument();
    });
});

describe('BulkUploadLayout — keyboard-reachable file input (defect 4)', () => {
    it('keeps the file input in the tab order rather than display:none', () => {
        render(<BulkUploadLayout {...makeProps()} />);

        const input = document.querySelector('input[type="file"]');
        expect(input).not.toHaveClass('hidden');
        expect(input).toHaveClass('sr-only');

        input.focus();
        expect(document.activeElement).toBe(input);
    });

    it('associates the drop-zone label with the input and gives it an accessible name', () => {
        render(<BulkUploadLayout {...makeProps()} />);
        const input = document.querySelector('input[type="file"]');
        const label = document.querySelector(`label[for="${input.id}"]`);

        expect(label).toBeTruthy();
        expect(input.id).toBeTruthy();
        expect(label.textContent).toContain('Click to upload a file');
    });

    it('gives each instance its own file-input id', () => {
        render(
            <>
                <BulkUploadLayout {...makeProps({ isEmbedded: true })} />
                <BulkUploadLayout {...makeProps({ isEmbedded: true })} />
            </>,
        );
        const ids = [...document.querySelectorAll('input[type="file"]')].map((i) => i.id);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
    });
});

describe('BulkUploadLayout — preview table (defect 7)', () => {
    it('names the table and its scroll region', () => {
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData: PREVIEW_ROWS })} />);

        expect(screen.getByRole('table', { name: 'Import preview' })).toBeInTheDocument();
        expect(screen.getByRole('region', {
            name: /Import preview\. Scroll horizontally to view all columns\./,
        })).toBeInTheDocument();
    });

    it('marks every column header with a scope', () => {
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData: PREVIEW_ROWS })} />);
        const headers = screen.getAllByRole('columnheader');
        expect(headers.length).toBeGreaterThan(0);
        for (const header of headers) {
            expect(header).toHaveAttribute('scope', 'col');
        }
    });

    it('keeps a large preview inside a bounded, focusable scroll region', () => {
        const csvData = Array.from({ length: 400 }, (_, i) => ({
            firstName: `Artificial${i}`,
            notes: 'x'.repeat(300),
        }));
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData })} />);

        const region = screen.getByRole('region', { name: /Import preview/ });
        expect(region).toHaveAttribute('tabindex', '0');
        expect(within(region).getAllByRole('row')).toHaveLength(11); // header + 10
    });
});

describe('BulkUploadLayout — announced progress (defect 8)', () => {
    it('announces the progress string in a live region', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: PREVIEW_ROWS,
            uploading: true,
            progress: 'Processing 3 / 10...',
        })} />);

        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('Processing 3 / 10...');
    });

    it('renders a determinate progressbar when a countable total is supplied', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: PREVIEW_ROWS,
            uploading: true,
            progress: 'Processing 3 / 10...',
            progressCount: { current: 3, total: 10 },
        })} />);

        const bar = screen.getByRole('progressbar', { name: 'Upload progress' });
        expect(bar).toHaveAttribute('aria-valuenow', '3');
        expect(bar).toHaveAttribute('aria-valuemax', '10');
        expect(bar).toHaveAttribute('aria-valuetext', '3 of 10 records');
    });

    it('omits the progressbar when there is nothing countable to report', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: PREVIEW_ROWS,
            uploading: true,
            progress: 'Scanning for misformatted data...',
            progressCount: { current: 0, total: 0 },
        })} />);

        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Scanning for misformatted data...');
    });

    it('marks the confirm control busy while uploading', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview', csvData: PREVIEW_ROWS, uploading: true, progress: 'x',
        })} />);

        const confirm = screen.getByRole('button', { name: /confirm upload/i });
        expect(confirm).toBeDisabled();
        expect(confirm).toHaveAttribute('aria-busy', 'true');
    });
});

describe('BulkUploadLayout — non-blocking feedback', () => {
    it('shows a failure as an assertive alert with the caller message verbatim', () => {
        render(<BulkUploadLayout {...makeProps({
            step: 'preview',
            csvData: PREVIEW_ROWS,
            error: 'Please select at least one user for Round Robin distribution.',
        })} />);

        expect(screen.getByRole('alert')).toHaveTextContent(
            'Please select at least one user for Round Robin distribution.',
        );
    });

    it('shows an informational outcome politely, not as an alert', () => {
        render(<BulkUploadLayout {...makeProps({
            notice: 'Scan complete. No misformatted records found.',
        })} />);

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent(
            'Scan complete. No misformatted records found.',
        );
    });
});

describe('BulkUploadLayout — step meter semantics', () => {
    it('marks the current step and lists all three', () => {
        render(<BulkUploadLayout {...makeProps({ step: 'preview', csvData: PREVIEW_ROWS })} />);

        const list = screen.getByRole('list', { name: 'Import steps' });
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items[1]).toHaveAttribute('aria-current', 'step');
        expect(items[0]).not.toHaveAttribute('aria-current');
        expect(items[0]).toHaveTextContent('completed');
        expect(items[2]).toHaveTextContent('not started');
    });
});

describe('BulkUploadLayout — axe', () => {
    it.each([
        ['upload / file', { step: 'upload', importMethod: 'file' }],
        ['upload / google sheet', { step: 'upload', importMethod: 'gsheet', sheetUrl: 'https://docs.google.com/spreadsheets/d/A/edit' }],
        ['preview', { step: 'preview', csvData: PREVIEW_ROWS }],
        ['preview / uploading', {
            step: 'preview', csvData: PREVIEW_ROWS, uploading: true,
            progress: 'Processing 1 / 2...', progressCount: { current: 1, total: 2 },
        }],
        ['preview / error', {
            step: 'preview', csvData: PREVIEW_ROWS, error: 'Artificial failure message.',
        }],
        ['success', { step: 'success', stats: { created: 7, updated: 4 } }],
    ])('has no violations: %s (overlay)', async (_name, overrides) => {
        const { container } = render(<BulkUploadLayout {...makeProps(overrides)} />);
        expect((await axe(container)).violations).toEqual([]);
    });

    it.each([
        ['upload', { step: 'upload' }],
        ['preview', { step: 'preview', csvData: PREVIEW_ROWS }],
        ['success', { step: 'success', stats: { created: 1, updated: 0 } }],
    ])('has no violations: %s (embedded)', async (_name, overrides) => {
        const { container } = render(
            <BulkUploadLayout {...makeProps({ ...overrides, isEmbedded: true })} />,
        );
        expect((await axe(container)).violations).toEqual([]);
    });
});
