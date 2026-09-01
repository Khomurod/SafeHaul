// AI Field Assistant end-to-end inside the envelope creator: the launcher's
// disabled state, the scan dialog and its disclosure, the review rail, applying
// suggestions, manual-field preservation, one-level undo, and the guarantee
// that nothing is ever saved or sent automatically.
//
// The AI provider is never reached: the callable and PDF.js are vitest mocks.
// Every field, label and page below is artificial.
//
// =====================================================================
// Shared harness for the AI-assistant suites. `vi.mock` is hoisted per file,
// so each suite keeps its own registrations, whose factories delegate to the
// `*Mock()` functions below. This module must not import `EnvelopeCreator`
// or any mocked module (the creator transitively imports the mocked firebase
// modules) — loading either here fires a mock factory that is itself awaiting
// this module, which deadlocks vitest silently (learned on `CA-3`). Each
// suite imports the creator and passes it to `makeRenderCreator`.
// =====================================================================

/* eslint-disable react-refresh/only-export-components -- a test harness, not
   an HMR module; nothing here renders outside vitest. */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, vi } from 'vitest';

export const callable = vi.fn();
export const firestoreMocks = {
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn() })),
    getDoc: vi.fn(),
};
export const storageMocks = { uploadBytes: vi.fn() };
export const pdfMocks = {
    loadPdfDocument: vi.fn(),
    renderPageToDataUrl: vi.fn(),
    inspectPdfDocument: vi.fn(),
};
export const workbenchProps = [];
export const toast = { showSuccess: vi.fn(), showError: vi.fn() };

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const libFirebaseMock = () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Artificial Sender' } },
});
export const firebaseFirestoreMock = () => ({
    collection: vi.fn(),
    serverTimestamp: vi.fn(),
    Timestamp: { fromMillis: vi.fn() },
    doc: vi.fn(),
    ...firestoreMocks,
});
export const firebaseStorageMock = () => ({
    ref: vi.fn(),
    getDownloadURL: vi.fn(),
    uploadBytes: (...args) => storageMocks.uploadBytes(...args),
});
export const firebaseFunctionsMock = () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => callable),
});
export const uuidMock = () => {
    let n = 0;
    return {
        v4: () => {
            n += 1;
            return `uuid-${n}`;
        },
    };
};
export const feedbackMock = () => ({
    useToast: () => ({ showSuccess: toast.showSuccess, showError: toast.showError }),
});
export const pdfPageRasterizerMock = () => ({
    loadPdfDocument: (...args) => pdfMocks.loadPdfDocument(...args),
    renderPageToDataUrl: (...args) => pdfMocks.renderPageToDataUrl(...args),
});
export const pdfFieldInspectorMock = async (importOriginal) => ({
    ...(await importOriginal()),
    inspectPdfDocument: (...args) => pdfMocks.inspectPdfDocument(...args),
});
// The PDF canvas itself is out of scope here — recording its props proves the
// suggestion layer receives exactly what the review rail is showing.
// The page navigator owns its own react-pdf `Document`, which is out of scope
// here for the same reason the workbench is stubbed: this suite is about the
// creator's behaviour, not PDF rendering. It also keeps pdf.js — which needs
// `Promise.withResolvers` — out of a Node 20 test run.
export const pageThumbnailRailMock = () => ({
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
});
export const pdfFieldWorkbenchMock = () => ({
    PdfFieldWorkbench: (props) => {
        workbenchProps.push(props);
        return <div data-testid="workbench" />;
    },
});


// --- fixtures and helpers, verbatim ----------------------------------------

export const PDF_FILE = new File(['%PDF-1.4 artificial'], 'artificial.pdf', { type: 'application/pdf' });

export const aiSuggestion = (overrides = {}) => ({
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

/**
 * The original `renderCreator`, verbatim, except the creator arrives as an
 * argument: each suite imports it after its own hoisted mocks.
 */
export const makeRenderCreator = (EnvelopeCreator) => (overrides = {}) =>
    render(<EnvelopeCreator companyId="co-1" companyName="Artificial Carrier" onClose={vi.fn()} {...overrides} />);

/** Load a PDF through the real sidebar file input and settle the page count. */
export async function loadPdf() {
    fireEvent.change(screen.getByLabelText('Choose a PDF file'), { target: { files: [PDF_FILE] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Auto-place fields/ })).toBeEnabled());
    // The workbench is stubbed, so report the page count the way react-pdf would.
    const latest = workbenchProps[workbenchProps.length - 1];
    await waitFor(() => expect(latest.setNumPages).toBeTypeOf('function'));
    await act(async () => {
        latest.setNumPages(2);
    });
}

export async function runScan({ scope = 'current' } = {}) {
    fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));
    const dialog = await screen.findByRole('dialog');
    if (scope !== 'current') {
        fireEvent.click(within(dialog).getByRole('radio', { name: /All pages/ }));
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Scan pages' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    workbenchProps.length = 0;
    firestoreMocks.getDoc.mockResolvedValue({ exists: () => false });
    pdfMocks.loadPdfDocument.mockResolvedValue({ destroy: vi.fn() });
    pdfMocks.inspectPdfDocument.mockResolvedValue({ rawSuggestions: [], manualReview: [], pagesWithText: [] });
    pdfMocks.renderPageToDataUrl.mockResolvedValue('data:image/jpeg;base64,AAA');
    callable.mockResolvedValue({ data: { suggestions: [aiSuggestion()], manualReview: [] } });
}
