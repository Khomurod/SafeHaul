// The compact (phone) editor: a full-screen canvas, a bottom toolbar and one
// bottom sheet at a time instead of the desktop three-column layout.
//
// jsdom has no layout, so the breakpoint is driven by a `matchMedia` stub that
// reports the narrow viewport. All data is artificial.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workbenchProps = vi.hoisted(() => []);
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const fs = vi.hoisted(() => ({ getDoc: vi.fn() }));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Artificial Sender' } },
}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    addDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    Timestamp: { fromMillis: vi.fn() },
    writeBatch: vi.fn(),
    doc: vi.fn(),
    getDoc: (...a) => fs.getDoc(...a),
    updateDoc: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess: toast.showSuccess, showError: toast.showError }),
}));
vi.mock('./components/envelope-creator/PdfFieldWorkbench', () => ({
    PdfFieldWorkbench: (props) => {
        workbenchProps.push(props);
        return <div data-testid="workbench" />;
    },
}));
// react-pdf is never exercised here; the page navigator only needs to list pages.
vi.mock('./components/envelope-creator/PageThumbnailRail', () => ({
    PageThumbnailRail: ({ numPages, onSelectPage, variant }) => (
        <nav aria-label="Pages" data-variant={variant}>
            {Array.from({ length: numPages }, (_, index) => index + 1).map((page) => (
                <button key={page} type="button" onClick={() => onSelectPage(page)}>{`Page ${page}`}</button>
            ))}
        </nav>
    ),
}));

import EnvelopeCreator from './EnvelopeCreator';

const PDF_FILE = new File(['%PDF-1.4 artificial'], 'artificial.pdf', { type: 'application/pdf' });

const setup = (overrides = {}) => {
    const props = { companyId: 'co-1', onClose: vi.fn(), companyName: 'Artificial Carrier', ...overrides };
    return { props, ...render(<EnvelopeCreator {...props} />) };
};

const latestWorkbench = () => workbenchProps[workbenchProps.length - 1];

/** Loads a PDF through the Setup sheet and settles the page count. */
async function loadPdfFromSheet(pages = 3) {
    fireEvent.click(screen.getByRole('button', { name: 'Open Setup' }));
    fireEvent.change(await screen.findByLabelText('Choose a PDF file'), { target: { files: [PDF_FILE] } });
    await waitFor(() => expect(latestWorkbench().file).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close Setup' }));
    await React.act(async () => {
        latestWorkbench().setNumPages(pages);
    });
}

let originalMatchMedia;

beforeEach(() => {
    vi.clearAllMocks();
    workbenchProps.length = 0;
    fs.getDoc.mockResolvedValue({ exists: () => false });

    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
        matches: query === '(max-width: 1023px)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
    });
});

afterEach(() => {
    window.matchMedia = originalMatchMedia;
});

describe('compact editor layout', () => {
    it('replaces the desktop rails rather than compressing them', () => {
        setup();
        // No 256px tools rail, no page column, no inspector column: the PDF is
        // the whole surface.
        expect(screen.queryByRole('complementary', { name: 'Envelope setup' })).not.toBeInTheDocument();
        expect(screen.queryByRole('complementary', { name: 'Document inspector' })).not.toBeInTheDocument();
        expect(screen.getByTestId('workbench')).toBeInTheDocument();
    });

    it('offers every section from the bottom toolbar', () => {
        setup();
        const bar = screen.getByRole('navigation', { name: 'Editor sections' });
        const labels = within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
        expect(labels).toEqual([
            'Open Setup', 'Open Add Field', 'Open Fields', 'Open Properties', 'Open AI', 'Open Pages',
        ]);
    });

    it('compacts the top bar so the document keeps the screen', () => {
        setup();
        // The badges are dropped; their content is still announced.
        expect(screen.queryByText('0 pages')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Document title')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Back to Documents' })).toBeInTheDocument();
    });

    it('counts placed fields and suggestions on the toolbar', async () => {
        setup();
        await loadPdfFromSheet();
        fireEvent.click(screen.getByRole('button', { name: 'Open Add Field' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Add Text field' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close Add Field' }));

        expect(screen.getByRole('button', { name: 'Open Fields, 1' })).toBeInTheDocument();
    });
});

describe('compact editor sheets', () => {
    it('opens each section in its own labelled sheet', async () => {
        setup();

        fireEvent.click(screen.getByRole('button', { name: 'Open Setup' }));
        expect(await screen.findByRole('dialog', { name: 'Setup' })).toBeInTheDocument();
        // Only the requested section is open, so a phone screen shows one thing.
        expect(screen.getByRole('button', { name: 'Open Setup', expanded: true })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Add Fields/, expanded: false })).toBeInTheDocument();
    });

    it('states which section is open on the toolbar', () => {
        setup();
        const trigger = screen.getByRole('button', { name: 'Open Pages' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(screen.getByRole('button', { name: 'Open Pages', expanded: true })).toBeInTheDocument();
    });

    it('closes the sheet on Escape and gives focus back to its trigger', async () => {
        setup();
        const trigger = screen.getByRole('button', { name: 'Open Setup' });
        trigger.focus();
        fireEvent.click(trigger);
        const sheet = await screen.findByRole('dialog', { name: 'Setup' });

        // The shared dialog traps and handles keys on its own panel.
        fireEvent.keyDown(sheet, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Setup' })).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Open Setup' })).toHaveFocus();
    });

    it('closes the sheet from its own close control', async () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Open Add Field' }));
        await screen.findByRole('dialog', { name: 'Add Field' });

        fireEvent.click(screen.getByRole('button', { name: 'Close Add Field' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('closes a sheet by pressing its own toolbar button again', async () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Open Setup' }));
        await screen.findByRole('dialog', { name: 'Setup' });
        fireEvent.click(screen.getByRole('button', { name: 'Open Setup', expanded: true }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('opens Properties and AI Suggestions on the tab each one names', async () => {
        setup();

        fireEvent.click(screen.getByRole('button', { name: 'Open AI' }));
        expect(await screen.findByRole('tab', { name: /AI Suggestions/ })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Close AI Suggestions' }));

        fireEvent.click(screen.getByRole('button', { name: 'Open Properties' }));
        expect(await screen.findByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates pages from the page sheet and closes it', async () => {
        setup();
        await loadPdfFromSheet(3);

        fireEvent.click(screen.getByRole('button', { name: 'Open Pages' }));
        const sheet = await screen.findByRole('dialog', { name: 'Pages' });
        expect(within(sheet).getByRole('navigation', { name: 'Pages' })).toHaveAttribute('data-variant', 'sheet');

        fireEvent.click(within(sheet).getByRole('button', { name: 'Page 3' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pages' })).not.toBeInTheDocument());
        expect(latestWorkbench().activePage).toBe(3);
    });

    it('places a field from the Add Field sheet onto the page being viewed', async () => {
        setup();
        await loadPdfFromSheet(3);

        fireEvent.click(screen.getByRole('button', { name: 'Open Pages' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Pages' })).getByRole('button', { name: 'Page 2' }));
        await waitFor(() => expect(latestWorkbench().activePage).toBe(2));

        fireEvent.click(screen.getByRole('button', { name: 'Open Add Field' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Add Signature field' }));
        expect(latestWorkbench().fields).toHaveLength(1);
        expect(latestWorkbench().fields[0].page).toBe(2);
    });
});
