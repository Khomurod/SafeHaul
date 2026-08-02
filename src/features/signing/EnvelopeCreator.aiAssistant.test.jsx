// AI Field Assistant end-to-end inside the envelope creator: the launcher's
// disabled state, the scan dialog and its disclosure, the review rail, applying
// suggestions, manual-field preservation, one-level undo, and the guarantee
// that nothing is ever saved or sent automatically.
//
// The AI provider is never reached: the callable and PDF.js are vitest mocks.
// Every field, label and page below is artificial.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callable = vi.hoisted(() => vi.fn());
const firestoreMocks = vi.hoisted(() => ({
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn() })),
    getDoc: vi.fn(),
}));
const storageMocks = vi.hoisted(() => ({ uploadBytes: vi.fn() }));
const pdfMocks = vi.hoisted(() => ({
    loadPdfDocument: vi.fn(),
    renderPageToDataUrl: vi.fn(),
    inspectPdfDocument: vi.fn(),
}));
const workbenchProps = vi.hoisted(() => []);
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Artificial Sender' } },
}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    serverTimestamp: vi.fn(),
    Timestamp: { fromMillis: vi.fn() },
    doc: vi.fn(),
    ...firestoreMocks,
}));
vi.mock('firebase/storage', () => ({
    ref: vi.fn(),
    getDownloadURL: vi.fn(),
    uploadBytes: (...args) => storageMocks.uploadBytes(...args),
}));
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => callable),
}));
vi.mock('uuid', () => {
    let n = 0;
    return {
        v4: () => {
            n += 1;
            return `uuid-${n}`;
        },
    };
});
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess: toast.showSuccess, showError: toast.showError }),
}));
vi.mock('@features/signing/utils/pdfPageRasterizer', () => ({
    loadPdfDocument: (...args) => pdfMocks.loadPdfDocument(...args),
    renderPageToDataUrl: (...args) => pdfMocks.renderPageToDataUrl(...args),
}));
vi.mock('@features/signing/utils/pdfFieldInspector', async (importOriginal) => ({
    ...(await importOriginal()),
    inspectPdfDocument: (...args) => pdfMocks.inspectPdfDocument(...args),
}));
// The PDF canvas itself is out of scope here — recording its props proves the
// suggestion layer receives exactly what the review rail is showing.
// The page navigator owns its own react-pdf `Document`, which is out of scope
// here for the same reason the workbench is stubbed: this suite is about the
// creator's behaviour, not PDF rendering. It also keeps pdf.js — which needs
// `Promise.withResolvers` — out of a Node 20 test run.
vi.mock('./components/envelope-creator/PageThumbnailRail', () => ({
    PageThumbnailRail: ({ numPages = 0, activePage, onSelectPage }) => (
        <nav aria-label="Pages">
            {Array.from({ length: numPages }, (_, index) => index + 1).map((page) => (
                <button
                    key={page}
                    type="button"
                    aria-current={page === activePage ? 'page' : undefined}
                    onClick={() => onSelectPage(page)}
                >
                    {`Page ${page}`}
                </button>
            ))}
        </nav>
    ),
}));
vi.mock('./components/envelope-creator/PdfFieldWorkbench', () => ({
    PdfFieldWorkbench: (props) => {
        workbenchProps.push(props);
        return <div data-testid="workbench" />;
    },
}));

import EnvelopeCreator from './EnvelopeCreator';

const PDF_FILE = new File(['%PDF-1.4 artificial'], 'artificial.pdf', { type: 'application/pdf' });

const aiSuggestion = (overrides = {}) => ({
    page: 1,
    category: 'signature',
    type: 'signature',
    bindingKey: '',
    label: 'Sign here',
    required: true,
    confidence: 0.92,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    ...overrides,
});

const renderCreator = (overrides = {}) =>
    render(<EnvelopeCreator companyId="co-1" companyName="Artificial Carrier" onClose={vi.fn()} {...overrides} />);

/** Load a PDF through the real sidebar file input and settle the page count. */
async function loadPdf() {
    fireEvent.change(screen.getByLabelText('Choose a PDF file'), { target: { files: [PDF_FILE] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Auto-place fields/ })).toBeEnabled());
    // The workbench is stubbed, so report the page count the way react-pdf would.
    const latest = workbenchProps[workbenchProps.length - 1];
    await waitFor(() => expect(latest.setNumPages).toBeTypeOf('function'));
    await act(async () => {
        latest.setNumPages(2);
    });
}

async function runScan({ scope = 'current' } = {}) {
    fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));
    const dialog = await screen.findByRole('dialog');
    if (scope !== 'current') {
        fireEvent.click(within(dialog).getByRole('radio', { name: /All pages/ }));
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Scan pages' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

beforeEach(() => {
    vi.clearAllMocks();
    workbenchProps.length = 0;
    firestoreMocks.getDoc.mockResolvedValue({ exists: () => false });
    pdfMocks.loadPdfDocument.mockResolvedValue({ destroy: vi.fn() });
    pdfMocks.inspectPdfDocument.mockResolvedValue({ rawSuggestions: [], manualReview: [], pagesWithText: [] });
    pdfMocks.renderPageToDataUrl.mockResolvedValue('data:image/jpeg;base64,AAA');
    callable.mockResolvedValue({ data: { suggestions: [aiSuggestion()], manualReview: [] } });
});

describe('launcher', () => {
    it('is disabled until a PDF is loaded, and says why', () => {
        renderCreator();
        const launcher = screen.getByRole('button', { name: /Auto-place fields/ });
        expect(launcher).toBeDisabled();
        expect(screen.getByText(/Upload a PDF to use the AI Field Assistant/)).toBeInTheDocument();
    });

    it('states what the assistant does once a PDF is loaded', async () => {
        renderCreator();
        await loadPdf();
        expect(
            screen.getByText(
                'AI will scan your PDF and suggest signature, initials, dates, checkboxes and text fields. Review all suggestions before applying them.',
            ),
        ).toBeInTheDocument();
    });

    it('never scans without an explicit start', async () => {
        renderCreator();
        await loadPdf();
        expect(callable).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));
        await screen.findByRole('dialog');
        expect(callable).not.toHaveBeenCalled();
    });
});

describe('scan dialog', () => {
    it('discloses that page images are sent to the AI provider', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/sent to the configured AI provider/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/not stored after the scan/i)).toBeInTheDocument();
    });

    it('offers current page, selected pages and all pages', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('radio', { name: /Current page/ })).toBeChecked();
        expect(within(dialog).getByRole('radio', { name: 'Selected pages' })).toBeInTheDocument();
        expect(within(dialog).getByRole('radio', { name: /All pages/ })).toBeInTheDocument();
    });

    it('blocks the scan until a valid page range is typed', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Selected pages' }));
        expect(within(dialog).getByRole('button', { name: 'Scan pages' })).toBeDisabled();

        fireEvent.change(within(dialog).getByLabelText('Page numbers'), { target: { value: '1-2' } });
        expect(within(dialog).getByRole('button', { name: 'Scan pages' })).toBeEnabled();
    });

    it('closes without scanning on Cancel', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(callable).not.toHaveBeenCalled();
    });

    it('has no serious accessibility violations', async () => {
        const { container } = renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));
        await screen.findByRole('dialog');

        const results = await axe(container);
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    });
});

describe('review rail', () => {
    it('shows suggestions separately from placed fields and never auto-accepts them', async () => {
        renderCreator();
        await loadPdf();
        await runScan();

        expect(await screen.findByRole('checkbox', { name: 'Apply Sign here' })).not.toBeChecked();
        expect(screen.getByText(/Suggestions are not part of your document until you apply them\./)).toBeInTheDocument();
        // The editor's own field list is still empty.
        expect(screen.queryByText(/^Placed \(/)).not.toBeInTheDocument();
    });

    it('hands the suggestion layer to the workbench, not the fields array', async () => {
        renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        const latest = workbenchProps[workbenchProps.length - 1];
        expect(latest.fields).toEqual([]);
        expect(latest.aiSuggestions).toHaveLength(1);
        expect(latest.aiSuggestions[0]).toMatchObject({ type: 'signature', page: 1 });
    });

    it('warns about a structure that cannot be represented', async () => {
        callable.mockResolvedValue({
            data: {
                suggestions: [],
                manualReview: [{ kind: 'radio_group', page: 1, detail: 'Marital status' }],
            },
        });
        renderCreator();
        await loadPdf();
        await runScan();

        expect(await screen.findByText(/Marital status/)).toBeInTheDocument();
        expect(screen.getByText(/mutually exclusive group/i)).toBeInTheDocument();
    });

    it('surfaces a scan failure with a retry, without provider detail', async () => {
        const error = new Error('groq said 123 Main St');
        error.code = 'functions/unavailable';
        callable.mockRejectedValue(error);

        renderCreator();
        await loadPdf();
        await runScan();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/could not reach the AI service/i);
        expect(alert).not.toHaveTextContent('123 Main St');
        expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    });

    it('has no serious accessibility violations while reviewing', async () => {
        const { container } = renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        const results = await axe(container);
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    });
});

describe('applying suggestions', () => {
    const acceptFirst = async () => {
        const checkbox = await screen.findByRole('checkbox', { name: 'Apply Sign here' });
        fireEvent.click(checkbox);
        return checkbox;
    };

    it('applies only what was accepted, and clears it from the review list', async () => {
        callable.mockResolvedValue({
            data: {
                suggestions: [aiSuggestion(), aiSuggestion({ y: 60, label: 'Initial here', category: 'initials' })],
                manualReview: [],
            },
        });
        renderCreator();
        await loadPdf();
        await runScan();
        await acceptFirst();

        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));

        await waitFor(() => {
            const latest = workbenchProps[workbenchProps.length - 1];
            expect(latest.fields).toHaveLength(1);
        });
        const latest = workbenchProps[workbenchProps.length - 1];
        expect(latest.fields[0]).toMatchObject({ type: 'signature', label: 'Sign here', placedByAi: true });
        expect(latest.aiSuggestions).toHaveLength(1);
        expect(latest.aiSuggestions[0].label).toBe('Initial here');
    });

    it('applies high-confidence suggestions without touching low-confidence ones', async () => {
        callable.mockResolvedValue({
            data: {
                suggestions: [
                    aiSuggestion({ confidence: 0.95 }),
                    aiSuggestion({ y: 60, label: 'Maybe a date', category: 'date', confidence: 0.3 }),
                ],
                manualReview: [],
            },
        });
        renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        fireEvent.click(screen.getByRole('button', { name: /Apply high-confidence \(1\)/ }));

        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        const latest = workbenchProps[workbenchProps.length - 1];
        expect(latest.fields[0].label).toBe('Sign here');
        expect(latest.aiSuggestions[0].label).toBe('Maybe a date');
    });

    it('applies a reviewer edit rather than the original suggestion', async () => {
        renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        // The review list is compact: the editing controls belong to the
        // suggestion you open, so select it first.
        fireEvent.click(screen.getByRole('button', { name: /^Sign here/ }));
        fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Driver signature' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Apply Driver signature' }));
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));

        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        expect(workbenchProps[workbenchProps.length - 1].fields[0].label).toBe('Driver signature');
    });

    it('maps an edited category to the right persisted type and binding', async () => {
        renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        fireEvent.click(screen.getByRole('button', { name: /^Sign here/ }));
        fireEvent.change(screen.getByLabelText('Field type'), { target: { value: 'email' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Apply Sign here' }));
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));

        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        expect(workbenchProps[workbenchProps.length - 1].fields[0]).toMatchObject({
            type: 'text',
            bindingKey: 'email',
            defaultValue: '{{email}}',
        });
    });

    it('discards every suggestion without placing anything', async () => {
        renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        fireEvent.click(screen.getByRole('button', { name: /Discard all suggestions/ }));

        await waitFor(() =>
            expect(screen.queryByRole('checkbox', { name: 'Apply Sign here' })).not.toBeInTheDocument(),
        );
        expect(workbenchProps[workbenchProps.length - 1].fields).toEqual([]);
    });

    it('never saves or sends as part of applying', async () => {
        renderCreator();
        await loadPdf();
        await runScan();
        await acceptFirst();
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));

        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        expect(firestoreMocks.addDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
        expect(storageMocks.uploadBytes).not.toHaveBeenCalled();
    });
});

describe('safe undo and manual-field preservation', () => {
    it('restores the exact field list from before the last apply', async () => {
        renderCreator();
        await loadPdf();
        // Place a manual field first so undo has something to preserve.
        fireEvent.click(screen.getByRole('button', { name: 'Add Text field' }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));

        await runScan();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Apply Sign here' }));
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(2));

        fireEvent.click(screen.getByRole('button', { name: /Undo apply/ }));

        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        const restored = workbenchProps[workbenchProps.length - 1].fields[0];
        expect(restored.type).toBe('text');
        expect('placedByAi' in restored).toBe(false);
    });

    it('keeps work done after the apply when undoing', async () => {
        // Undo must remove only the fields the apply added. Restoring a
        // pre-apply snapshot would silently discard everything the operator did
        // afterwards.
        renderCreator();
        await loadPdf();
        await runScan();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Apply Sign here' }));
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));

        // Manual work AFTER the apply.
        fireEvent.click(screen.getByRole('button', { name: 'Add Text field' }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(2));
        const manualAfterApply = workbenchProps[workbenchProps.length - 1].fields[1];

        fireEvent.click(screen.getByRole('button', { name: /Undo apply/ }));

        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        const remaining = workbenchProps[workbenchProps.length - 1].fields[0];
        expect(remaining.id).toBe(manualAfterApply.id);
        expect('placedByAi' in remaining).toBe(false);
    });

    it('undoes only the last apply, leaving an earlier one in place', async () => {
        callable.mockResolvedValue({
            data: {
                suggestions: [aiSuggestion(), aiSuggestion({ y: 60, label: 'Initial here', category: 'initials' })],
                manualReview: [],
            },
        });
        renderCreator();
        await loadPdf();
        await runScan();

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Apply Sign here' }));
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Apply Initial here' }));
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(2));

        fireEvent.click(screen.getByRole('button', { name: /Undo apply/ }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        expect(workbenchProps[workbenchProps.length - 1].fields[0].label).toBe('Sign here');
    });

    it('leaves undo unavailable until something has been applied', async () => {
        renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });
        expect(screen.getByRole('button', { name: /Undo apply/ })).toBeDisabled();
    });

    it('never removes a manual field that a suggestion overlaps', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'Add Signature field' }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        const manualField = workbenchProps[workbenchProps.length - 1].fields[0];

        // The suggestion lands exactly on the manual field's default position.
        callable.mockResolvedValue({
            data: { suggestions: [aiSuggestion({ x: manualField.x, y: manualField.y })], manualReview: [] },
        });
        await runScan();

        // The compact row flags the overlap; the full explanation is in the detail.
        const row = await screen.findByRole('button', { name: /overlaps an existing field/ });
        fireEvent.click(row);
        expect(await screen.findByText(/Overlaps your existing field/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Apply Sign here' }));
        fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));

        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(2));
        expect(workbenchProps[workbenchProps.length - 1].fields[0]).toBe(manualField);
    });

    it('excludes an overlapping suggestion from the high-confidence bulk action', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'Add Signature field' }));
        await waitFor(() => expect(workbenchProps[workbenchProps.length - 1].fields).toHaveLength(1));
        const manualField = workbenchProps[workbenchProps.length - 1].fields[0];

        callable.mockResolvedValue({
            data: { suggestions: [aiSuggestion({ x: manualField.x, y: manualField.y })], manualReview: [] },
        });
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        expect(screen.getByRole('button', { name: /Apply high-confidence \(0\)/ })).toBeDisabled();
    });
});
