// The redesigned editor shell wired into EnvelopeCreator: save state, unsaved-
// change protection, global undo/redo with gesture coalescing, page navigation,
// and the signer preview.
//
// The workbench and sidebar are prop-recording doubles so the shell's own
// behaviour can be driven directly; react-pdf never runs. All data is artificial.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sidebarProps = vi.hoisted(() => []);
const workbenchProps = vi.hoisted(() => []);
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const fs = vi.hoisted(() => ({ getDoc: vi.fn(), updateDoc: vi.fn(), addDoc: vi.fn() }));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Artificial Sender' } },
}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    serverTimestamp: vi.fn(),
    Timestamp: { fromMillis: vi.fn() },
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn() })),
    doc: vi.fn(),
    getDoc: (...a) => fs.getDoc(...a),
    updateDoc: (...a) => fs.updateDoc(...a),
    addDoc: (...a) => fs.addDoc(...a),
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess: toast.showSuccess, showError: toast.showError }),
}));
vi.mock('./components/envelope-creator/EnvelopeSidebar', () => ({
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
}));
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
vi.mock('./components/envelope-creator/FieldPropertiesPanel', () => ({
    FieldPropertiesPanel: () => <div data-testid="properties-panel" />,
}));
vi.mock('./components/envelope-creator/SignerPreviewDialog', () => ({
    SignerPreviewDialog: (props) => (
        <div role="dialog" aria-label="Preview as signer">
            <span data-testid="preview-field-count">{props.fields.length}</span>
            <span data-testid="preview-initial-page">{props.initialPage}</span>
            <button type="button" onClick={props.onClose}>close preview</button>
        </div>
    ),
}));

import EnvelopeCreator from './EnvelopeCreator';

const PDF_FILE = new File(['%PDF-1.4 artificial'], 'artificial.pdf', { type: 'application/pdf' });

const setup = (overrides = {}) => {
    const props = { companyId: 'co-1', onClose: vi.fn(), companyName: 'Artificial Carrier', ...overrides };
    return { props, ...render(<EnvelopeCreator {...props} />) };
};

const latestWorkbench = () => workbenchProps[workbenchProps.length - 1];
const currentFields = () => latestWorkbench().fields;

/**
 * The save state is shown as a badge AND announced in the top bar's live
 * region, so it is never conveyed by the badge colour alone. Both must carry it.
 */
function expectSaveStateAnnounced(label) {
    const nodes = screen.getAllByText(label);
    expect(nodes.length).toBeGreaterThan(1);
    expect(nodes.some((node) => node.closest('[role="status"]'))).toBe(true);
}

/** Load a PDF through the real file input and settle the page count. */
async function loadPdf(pages = 3) {
    fireEvent.change(screen.getByLabelText('Choose a PDF file'), { target: { files: [PDF_FILE] } });
    await waitFor(() => expect(latestWorkbench().file).toBeTruthy());
    await React.act(async () => {
        latestWorkbench().setNumPages(pages);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    sidebarProps.length = 0;
    workbenchProps.length = 0;
    fs.getDoc.mockResolvedValue({ exists: () => false });
});

describe('save state', () => {
    it('starts with nothing to report', () => {
        setup();
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
        expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    });

    it('marks the document unsaved as soon as a field is placed', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        expectSaveStateAnnounced('Unsaved changes');
    });

    it('marks the document unsaved when the title is edited', async () => {
        setup();
        await loadPdf();
        const input = screen.getByLabelText('Document title');
        fireEvent.change(input, { target: { value: 'Renamed' } });
        fireEvent.blur(input);
        expectSaveStateAnnounced('Unsaved changes');
    });

    it('never claims Saved merely because a save was attempted', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));

        // No recipient name: the existing validation rejects the send before
        // any write, so the document is still unsaved.
        fireEvent.click(screen.getByRole('button', { name: 'Send Document' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalled());
        expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    });
});

describe('recipient and delivery edits', () => {
    it.each([
        ['set recipient name', 'recipientName', 'Pat Example'],
        ['choose sms', 'deliveryMethod', 'sms'],
    ])('marks the document unsaved after %s', (control, prop, value) => {
        // No PDF is loaded, so the recipient edit is the ONLY change — uploading
        // already marks the document unsaved on its own.
        setup();
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: control }));
        expect(sidebarProps.at(-1)[prop]).toBe(value);
        expectSaveStateAnnounced('Unsaved changes');
    });

    it('guards a recipient-only edit on the way out', () => {
        // Recipient details are part of the document being built, so leaving
        // must ask before discarding them — even with nothing else changed.
        const { props } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'set recipient name' }));

        fireEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));
        expect(props.onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    });
});

describe('save state on a failed save', () => {
    it('reports the work as unsaved when a template save bails out before writing', async () => {
        // Editing a template whose storagePath never hydrated: the existing
        // guard refuses to write. The editor must not sit on "Saving…".
        fs.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ title: 'Artificial Template', fields: [], storagePath: '' }),
        });
        setup({ editTemplateId: 'tpl-1' });
        await screen.findByLabelText('Document title');
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));

        fireEvent.click(screen.getByRole('button', { name: 'Save Template Changes' }));

        await waitFor(() =>
            expect(toast.showError).toHaveBeenCalledWith(
                'Template file reference is missing. Please re-upload the PDF as a new template.',
            ),
        );
        expect(fs.updateDoc).not.toHaveBeenCalled();
        expect(screen.queryByText('Saved')).not.toBeInTheDocument();
        expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
        expectSaveStateAnnounced('Unsaved changes');
    });
});

describe('unsaved-change protection', () => {
    it('leaves immediately when there is nothing to lose', () => {
        const { props } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));
        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('asks before discarding unsaved work', async () => {
        const { props } = setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));

        fireEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));
        expect(props.onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    });

    it('keeps editing when the confirmation is dismissed', async () => {
        const { props } = setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));

        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(props.onClose).not.toHaveBeenCalled();
        expect(currentFields()).toHaveLength(1);
    });

    it('leaves once the discard is confirmed', async () => {
        const { props } = setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));

        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    });
});

describe('global undo and redo', () => {
    it('is unavailable until something changes', () => {
        setup();
        expect(screen.getAllByRole('button', { name: 'Undo' })[0]).toBeDisabled();
        expect(screen.getAllByRole('button', { name: 'Redo' })[0]).toBeDisabled();
    });

    it('undoes and redoes adding a field', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        expect(currentFields()).toHaveLength(1);

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()).toHaveLength(0);

        fireEvent.click(screen.getAllByRole('button', { name: 'Redo' })[0]);
        expect(currentFields()).toHaveLength(1);
    });

    it('undoes removing a field', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'remove first' }));
        expect(currentFields()).toHaveLength(0);

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()).toHaveLength(1);
    });

    it('treats one completed drag as one history entry', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        const id = currentFields()[0].id;

        // react-draggable commits once on stop; the coalesce key also merges a
        // run of keyboard nudges into the same entry.
        await React.act(async () => { latestWorkbench().updateFieldPosition(id, 1, 20, 20); });
        await React.act(async () => { latestWorkbench().updateFieldPosition(id, 1, 21, 21); });
        await React.act(async () => { latestWorkbench().updateFieldPosition(id, 1, 22, 22); });
        expect(currentFields()[0]).toMatchObject({ x: 22, y: 22 });

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        // One undo reverses the whole gesture, back to the placed position.
        expect(currentFields()[0]).toMatchObject({ x: 10, y: 10 });
    });

    it('keeps a move and a resize as separate history entries', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        const id = currentFields()[0].id;

        await React.act(async () => { latestWorkbench().updateFieldPosition(id, 1, 30, 30); });
        await React.act(async () => { latestWorkbench().updateFieldSize(id, 40, 9); });

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()[0]).toMatchObject({ x: 30, y: 30, width: 30 });
    });

    it('does not record zoom or page navigation as history', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));

        fireEvent.click(screen.getAllByRole('button', { name: 'Zoom in' })[0]);
        fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);

        // The single undo available is still the field placement.
        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()).toHaveLength(0);
        expect(screen.getAllByRole('button', { name: 'Undo' })[0]).toBeDisabled();
    });

    it('responds to the keyboard shortcuts', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));

        fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
        expect(currentFields()).toHaveLength(0);

        fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
        expect(currentFields()).toHaveLength(1);

        fireEvent.keyDown(window, { key: 'z', metaKey: true });
        expect(currentFields()).toHaveLength(0);

        fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
        expect(currentFields()).toHaveLength(1);
    });

    it('starts a fresh history when a different PDF replaces the document', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        expect(screen.getAllByRole('button', { name: 'Undo' })[0]).toBeEnabled();

        const replacement = new File(['%PDF-1.4 second'], 'second.pdf', { type: 'application/pdf' });
        fireEvent.change(screen.getByLabelText('Choose a PDF file'), { target: { files: [replacement] } });

        await waitFor(() => expect(currentFields()).toHaveLength(0));
        // Undo must not be able to reach fields that belonged to the old PDF.
        expect(screen.getAllByRole('button', { name: 'Undo' })[0]).toBeDisabled();
    });

    it('drops the selection when undo removes the selected field', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));
        expect(screen.getByTestId('properties-panel')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();
    });
});

describe('page navigation and counts', () => {
    it('reports the page and field counts in the top bar', async () => {
        setup();
        await loadPdf(4);
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'add signature field' }));

        expect(screen.getByText('4 pages')).toBeInTheDocument();
        expect(screen.getByText('2 fields')).toBeInTheDocument();
    });

    it('moves through pages from the canvas toolbar', async () => {
        setup();
        await loadPdf(3);
        expect(screen.getByText('Page 1 / 3')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
        expect(screen.getByText('Page 2 / 3')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: 'Previous page' })[0]);
        expect(screen.getByText('Page 1 / 3')).toBeInTheDocument();
    });

    it('places a new field on the page being viewed', async () => {
        setup();
        await loadPdf(3);
        fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        expect(currentFields()[0].page).toBe(2);
    });

    it('hides the canvas toolbar until a document is loaded', () => {
        setup();
        expect(screen.queryByRole('toolbar', { name: 'Document canvas tools' })).not.toBeInTheDocument();
    });
});

describe('inspector', () => {
    it('opens the Properties tab on the selected field', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        expect(screen.getByText(/Select a field on the document/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'select first' }));
        expect(screen.getByTestId('properties-panel')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps the AI tab reachable without disturbing the placed fields', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));

        fireEvent.click(screen.getByRole('tab', { name: /AI Suggestions/ }));
        expect(screen.getByRole('tab', { name: /AI Suggestions/ })).toHaveAttribute('aria-selected', 'true');
        // Switching tabs is a view change, not an edit: no field is touched and
        // nothing is added to the undo history.
        expect(currentFields()).toHaveLength(1);

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()).toHaveLength(0);
        expect(screen.getAllByRole('button', { name: 'Undo' })[0]).toBeDisabled();
    });

    it('moves between tabs with the arrow keys', async () => {
        setup();
        await loadPdf();
        const properties = screen.getByRole('tab', { name: 'Properties' });

        fireEvent.keyDown(properties, { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: /AI Suggestions/ })).toHaveAttribute('aria-selected', 'true');

        fireEvent.keyDown(screen.getByRole('tab', { name: /AI Suggestions/ }), { key: 'ArrowLeft' });
        expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
    });

    it('takes only the selected tab out of the tab order', async () => {
        setup();
        await loadPdf();
        expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tab', { name: /AI Suggestions/ })).toHaveAttribute('tabindex', '-1');
    });
});

describe('field tools', () => {
    /** Places two text fields and selects both, the second additively. */
    async function selectTwo() {
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'add signature field' }));
        await React.act(async () => {
            latestWorkbench().updateFieldPosition(currentFields()[1].id, 1, 40, 30);
        });
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));
        fireEvent.click(screen.getByRole('button', { name: 'add second to selection' }));
    }

    it('stays hidden until something is selected', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        expect(screen.queryByRole('button', { name: 'Align left' })).not.toBeInTheDocument();
    });

    it('reports how many fields are selected', async () => {
        setup();
        await loadPdf();
        await selectTwo();
        expect(screen.getByText('2 fields selected')).toBeInTheDocument();
    });

    it('needs two fields before aligning or matching size', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));

        expect(screen.getByRole('button', { name: 'Align left' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Match width' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^Duplicate/ })).toBeEnabled();
    });

    it('aligns to the first field selected and undoes in one step', async () => {
        setup();
        await loadPdf();
        await selectTwo();
        const [anchor, other] = currentFields();
        expect(other.x).toBe(40);

        fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
        expect(currentFields()[1].x).toBe(anchor.x);
        // The anchor itself never moves.
        expect(currentFields()[0].x).toBe(anchor.x);

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()[1].x).toBe(40);
    });

    it('matches width from the anchor', async () => {
        setup();
        await loadPdf();
        await selectTwo();
        const anchorWidth = currentFields()[0].width;
        expect(currentFields()[1].width).not.toBe(anchorWidth);

        fireEvent.click(screen.getByRole('button', { name: 'Match width' }));
        expect(currentFields()[1].width).toBe(anchorWidth);
    });

    it('duplicates the selection with new ids and selects the copies', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));
        const original = currentFields()[0];

        fireEvent.click(screen.getByRole('button', { name: /^Duplicate/ }));
        const after = currentFields();
        expect(after).toHaveLength(2);
        expect(after[1].id).not.toBe(original.id);
        expect(after[1].label).toBe(original.label);
        expect(after[1].type).toBe(original.type);
        // The copy is offset, still on the page, and is now the selection.
        expect(after[1].x).toBeGreaterThan(original.x);
        expect(after[1].x + after[1].width).toBeLessThanOrEqual(100);
        expect(screen.getByText('1 field selected')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()).toHaveLength(1);
    });

    it('copies the selection to one page, keeping geometry and taking a new id', async () => {
        setup();
        await loadPdf(3);
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));
        const original = currentFields()[0];

        fireEvent.click(screen.getByRole('button', { name: 'Copy to page 2' }));
        const after = currentFields();
        expect(after).toHaveLength(2);
        expect(after[1]).toMatchObject({
            page: 2,
            x: original.x,
            y: original.y,
            width: original.width,
            height: original.height,
            label: original.label,
            type: original.type,
        });
        expect(after[1].id).not.toBe(original.id);
    });

    it('copies to every page except the one the field is already on', async () => {
        setup();
        await loadPdf(3);
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));

        fireEvent.click(screen.getByRole('button', { name: 'Copy to all pages' }));
        const pages = currentFields().map((field) => field.page).sort();
        expect(pages).toEqual([1, 2, 3]);
        const ids = new Set(currentFields().map((field) => field.id));
        expect(ids.size).toBe(3);

        // One bulk action, one undo.
        fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
        expect(currentFields()).toHaveLength(1);
    });

    it('offers no cross-page copy for a single-page document', async () => {
        setup();
        await loadPdf(1);
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'select first' }));
        expect(screen.queryByRole('button', { name: /^Copy to/ })).not.toBeInTheDocument();
    });

    it('snaps a pointer drop to the page centre but leaves a keyboard nudge exact', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        const id = currentFields()[0].id;

        // A pointer drop just short of the left edge is pulled onto it…
        await React.act(async () => {
            latestWorkbench().updateFieldPosition(id, 1, 0.4, 20, { snap: true });
        });
        expect(currentFields()[0].x).toBe(0);

        // …while the keyboard path keeps the exact percentage it asked for.
        await React.act(async () => {
            latestWorkbench().updateFieldPosition(id, 1, 0.4, 20);
        });
        expect(currentFields()[0].x).toBe(0.4);
    });

    it('shows alignment guides while dragging without changing anything', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        const before = currentFields()[0];

        await React.act(async () => {
            latestWorkbench().onFieldDragMove(before.id, 1, 0.2, 20);
        });
        expect(latestWorkbench().dragGuides).toMatchObject({ page: 1 });
        expect(latestWorkbench().dragGuides.guides.length).toBeGreaterThan(0);
        // Nothing moved and nothing was recorded.
        expect(currentFields()[0]).toEqual(before);
    });
});

describe('preview as signer', () => {
    it('is disabled until a PDF is loaded', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Preview as signer' })).toBeDisabled();
    });

    it('opens with the current fields and page, and closes again', async () => {
        setup();
        await loadPdf(3);
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);

        // Offered in the top bar and again on the canvas toolbar; either opens it.
        fireEvent.click(screen.getAllByRole('button', { name: 'Preview as signer' })[0]);
        expect(screen.getByRole('dialog', { name: 'Preview as signer' })).toBeInTheDocument();
        expect(screen.getByTestId('preview-field-count')).toHaveTextContent('1');
        expect(screen.getByTestId('preview-initial-page')).toHaveTextContent('2');

        fireEvent.click(screen.getByRole('button', { name: 'close preview' }));
        expect(screen.queryByRole('dialog', { name: 'Preview as signer' })).not.toBeInTheDocument();
    });

    it('writes nothing when opened', async () => {
        setup();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Preview as signer' })[0]);

        expect(fs.updateDoc).not.toHaveBeenCalled();
        expect(fs.addDoc).not.toHaveBeenCalled();
    });
});
