// The redesigned editor shell wired into EnvelopeCreator: save state, unsaved-
// change protection, global undo/redo with gesture coalescing, page navigation,
// and the signer preview.
//
// The workbench and sidebar are prop-recording doubles so the shell's own
// behaviour can be driven directly; react-pdf never runs. All data is artificial.
//
// =====================================================================
// Shared harness for the EnvelopeCreator editor suites.
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below — including the
// prop-recording sidebar/workbench doubles. This module must not import
// `EnvelopeCreator` or any mocked module (the creator transitively imports
// the mocked firebase modules); loading either here fires a mock factory
// that is itself awaiting this module, which deadlocks vitest silently
// (learned on `CA-3`). Each suite imports the creator and passes it to
// `makeSetup`.
// =====================================================================
/* eslint-disable react-refresh/only-export-components -- a test harness, not
   an HMR module; nothing here renders outside vitest. */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

export const sidebarProps = [];
export const workbenchProps = [];
export const toast = { showSuccess: vi.fn(), showError: vi.fn() };
export const fs = { getDoc: vi.fn(), updateDoc: vi.fn(), addDoc: vi.fn() };

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
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn() })),
    doc: vi.fn(),
    getDoc: (...a) => fs.getDoc(...a),
    updateDoc: (...a) => fs.updateDoc(...a),
    addDoc: (...a) => fs.addDoc(...a),
});
export const firebaseStorageMock = () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() });
export const firebaseFunctionsMock = () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() });
export const feedbackMock = () => ({
    useToast: () => ({ showSuccess: toast.showSuccess, showError: toast.showError }),
});

export const envelopeSidebarMock = () => ({
    EnvelopeSidebar: (props) => {
        sidebarProps.push(props);
        return (
            <div data-testid="sidebar">
                {/* Stands in for the real sidebar's upload control, wired to the
                    same `handleFileChange` the shell hands down. */}
                <label htmlFor="mock-file-input">Choose a PDF file</label>
                <input id="mock-file-input" type="file" onChange={props.handleFileChange} />
                <button type="button" onClick={() => props.addField('text')}>add text field</button>
                <button type="button" onClick={() => props.addField('signature')}>add signature field</button>
                <button type="button" onClick={() => props.removeField(props.fields[0]?.id)}>remove first</button>
                <button type="button" onClick={() => props.setSelectedFieldId(props.fields[0]?.id)}>select first</button>
                <button
                    type="button"
                    onClick={() => props.setSelectedFieldId(props.fields[1]?.id, { additive: true })}
                >
                    add second to selection
                </button>
                <button type="button" onClick={() => props.setRecipientName('Pat Example')}>
                    set recipient name
                </button>
                <button type="button" onClick={() => props.setDeliveryMethod('sms')}>choose sms</button>
                {props.fieldTools}
            </div>
        );
    },
});
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
export const fieldPropertiesPanelMock = () => ({
    FieldPropertiesPanel: () => <div data-testid="properties-panel" />,
});
export const signerPreviewDialogMock = () => ({
    SignerPreviewDialog: (props) => (
        <div role="dialog" aria-label="Preview as signer">
            <span data-testid="preview-field-count">{props.fields.length}</span>
            <span data-testid="preview-initial-page">{props.initialPage}</span>
            <button type="button" onClick={props.onClose}>close preview</button>
        </div>
    ),
});


// --- fixtures and helpers, verbatim ----------------------------------------

export const PDF_FILE = new File(['%PDF-1.4 artificial'], 'artificial.pdf', { type: 'application/pdf' });

/**
 * The original `setup`, verbatim, except the creator arrives as an argument:
 * each suite imports it after its own hoisted mocks.
 */
export const makeSetup = (EnvelopeCreator) => (overrides = {}) => {
    const props = { companyId: 'co-1', onClose: vi.fn(), companyName: 'Artificial Carrier', ...overrides };
    return { props, ...render(<EnvelopeCreator {...props} />) };
};

export const latestWorkbench = () => workbenchProps[workbenchProps.length - 1];
export const currentFields = () => latestWorkbench().fields;

/**
 * The save state is shown as a badge AND announced in the top bar's live
 * region, so it is never conveyed by the badge colour alone. Both must carry it.
 */
export function expectSaveStateAnnounced(label) {
    const nodes = screen.getAllByText(label);
    expect(nodes.length).toBeGreaterThan(1);
    expect(nodes.some((node) => node.closest('[role="status"]'))).toBe(true);
}

/** Load a PDF through the real file input and settle the page count. */
export async function loadPdf(pages = 3) {
    fireEvent.change(screen.getByLabelText('Choose a PDF file'), { target: { files: [PDF_FILE] } });
    await waitFor(() => expect(latestWorkbench().file).toBeTruthy());
    await React.act(async () => {
        latestWorkbench().setNumPages(pages);
    });
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    sidebarProps.length = 0;
    workbenchProps.length = 0;
    fs.getDoc.mockResolvedValue({ exists: () => false });
}
