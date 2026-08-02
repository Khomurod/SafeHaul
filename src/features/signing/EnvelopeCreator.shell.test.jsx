import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sub-slice A covers the EnvelopeCreator *shell* only: the top bar (heading
// matrix, mode toggle, Cancel, Save), the hydrating screen and the layout
// wrapper. The PDF workbench, sidebar and properties panel are out of scope, so
// they are replaced with prop-recording doubles — which also proves the shell
// still hands them exactly the same props.
const sidebarProps = vi.hoisted(() => []);
const workbenchProps = vi.hoisted(() => []);
const panelProps = vi.hoisted(() => []);
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const fs = vi.hoisted(() => ({ getDoc: vi.fn() }));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Artificial Sender' } },
}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), addDoc: vi.fn(), serverTimestamp: vi.fn(),
    Timestamp: { fromMillis: vi.fn() }, writeBatch: vi.fn(), doc: vi.fn(),
    getDoc: (...a) => fs.getDoc(...a), updateDoc: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }));
vi.mock('uuid', () => ({ v4: () => 'uuid-fixed' }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess: toast.showSuccess, showError: toast.showError }),
}));

vi.mock('./components/envelope-creator/EnvelopeSidebar', () => ({
    EnvelopeSidebar: (props) => {
        sidebarProps.push(props);
        return (
            <div data-testid="sidebar">
                <button type="button" onClick={() => props.setSelectedFieldId('field-1')}>select field</button>
            </div>
        );
    },
}));
vi.mock('./components/envelope-creator/PdfFieldWorkbench', () => ({
    PdfFieldWorkbench: (props) => {
        workbenchProps.push(props);
        return <div data-testid="workbench" />;
    },
}));
vi.mock('./components/envelope-creator/FieldPropertiesPanel', () => ({
    FieldPropertiesPanel: (props) => {
        panelProps.push(props);
        return <div data-testid="properties-panel" />;
    },
}));

import EnvelopeCreator from './EnvelopeCreator';

const setup = (overrides = {}) => {
    const props = {
        companyId: 'co-1',
        onClose: vi.fn(),
        companyName: 'Artificial Carrier',
        ...overrides,
    };
    return { props, ...render(<EnvelopeCreator {...props} />) };
};

beforeEach(() => {
    vi.clearAllMocks();
    sidebarProps.length = 0;
    workbenchProps.length = 0;
    panelProps.length = 0;
    fs.getDoc.mockResolvedValue({ exists: () => false });
});

describe('EnvelopeCreator shell — mode and title', () => {
    // The old bare heading is now the top bar: an editable document title plus
    // a badge stating the FIXED mode. The mode still cannot change here.
    it.each([
        ['One-off send', {}],
        ['Reusable template', { initialMode: 'template' }],
        ['Correct Document', { editRequestId: 'req-1' }],
        ['Edit Template', { editTemplateId: 'tpl-1' }],
    ])('states the %s mode', async (label, overrides) => {
        setup(overrides);
        expect(await screen.findByText(label)).toBeInTheDocument();
    });

    it('never offers a control that switches the creator mode', async () => {
        setup();
        await screen.findByText('One-off send');
        expect(screen.queryByRole('group', { name: 'Creator mode' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'One-off Send' })).not.toBeInTheDocument();
    });

    it('exposes the document title for editing', async () => {
        setup();
        expect(await screen.findByLabelText('Document title')).toBeInTheDocument();
    });
});

describe('EnvelopeCreator shell — primary actions', () => {
    const findSaveAction = async (label) => {
        await screen.findByLabelText('Document title');
        const action = screen.getByRole('button', { name: label });
        expect(action).toBeDefined();
        return action;
    };

    it.each([
        ['Send Document', {}],
        ['Save Template', { initialMode: 'template' }],
        ['Save Correction', { editRequestId: 'req-1' }],
        ['Save Template Changes', { editTemplateId: 'tpl-1' }],
    ])('labels the save action %s', async (label, overrides) => {
        setup(overrides);
        expect(await findSaveAction(label)).toBeInTheDocument();
    });

    it('leaves immediately through the exact onClose callback when nothing is unsaved', () => {
        const { props } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the save action wired to handleSave with its validation intact', async () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Send Document' }));
        // No file and no fields — the preserved guard must fire, unchanged.
        await waitFor(() => {
            expect(toast.showError).toHaveBeenCalledWith('Please upload a file and place at least one field.');
        });
    });
});

describe('EnvelopeCreator shell — hydrating state', () => {
    it('announces the hydrating screen and hides the workbench', async () => {
        let resolveDoc;
        fs.getDoc.mockReturnValue(new Promise((r) => { resolveDoc = r; }));
        setup({ editRequestId: 'req-1' });

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Loading document for editing...');
        expect(screen.queryByTestId('workbench')).not.toBeInTheDocument();

        await React.act(async () => { resolveDoc({ exists: () => false }); });
    });
});

describe('EnvelopeCreator shell — layout and child contracts', () => {
    it('keeps the inspector column present whether or not a field is selected', () => {
        // The rail used to collapse to `md:w-0` and reappear, resizing the canvas
        // under the pointer on every selection. It is now a permanent 320px
        // column from `lg` up.
        const { container } = setup();
        const inspector = container.querySelector('[aria-label="Document inspector"]');
        expect(inspector.className).toContain('lg:w-80');
        expect(screen.getByRole('tab', { name: 'Properties' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();
        expect(screen.getByText(/Select a field on the document/)).toBeInTheDocument();

        // Selecting an id that matches no placed field leaves the empty state
        // rather than an empty panel. The panel itself is covered where fields
        // can actually be placed, in EnvelopeCreator.editor.test.jsx.
        fireEvent.click(screen.getByRole('button', { name: 'select field' }));
        expect(container.querySelector('[aria-label="Document inspector"]').className).toContain('lg:w-80');
        expect(screen.getByText(/Select a field on the document/)).toBeInTheDocument();
    });

    it('offers both inspector tabs and switches between them', () => {
        setup();
        const properties = screen.getByRole('tab', { name: 'Properties' });
        const ai = screen.getByRole('tab', { name: /AI Suggestions/ });

        expect(properties).toHaveAttribute('aria-selected', 'true');
        expect(ai).toHaveAttribute('aria-selected', 'false');

        fireEvent.click(ai);
        expect(ai).toHaveAttribute('aria-selected', 'true');
        expect(properties).toHaveAttribute('aria-selected', 'false');
        // Suggestions live in their own tab and are never mixed into Properties.
        expect(screen.getByText(/Suggestions never become part of your document/)).toBeInTheDocument();
    });

    it('offers a dismiss control only in the sheet presentation', () => {
        const { container } = setup();
        // Nothing selected: no sheet, so nothing to dismiss.
        expect(screen.queryByRole('button', { name: 'Close inspector' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'select field' }));
        const close = screen.getByRole('button', { name: 'Close inspector' });
        // Present in the DOM but scoped below the desktop breakpoint, because
        // there the sheet covers the canvas that would otherwise deselect.
        expect(close.closest('div').className).toContain('lg:hidden');

        fireEvent.click(close);
        expect(screen.queryByRole('button', { name: 'Close inspector' })).not.toBeInTheDocument();
        expect(container.querySelector('[aria-label="Document inspector"]').className).toContain('hidden');
    });

    it('passes the frozen prop sets to the sidebar and workbench', () => {
        setup();

        const sidebar = sidebarProps.at(-1);
        [
            'creatorMode', 'isEditingTemplate', 'recipientName', 'setRecipientName',
            'recipientEmail', 'setRecipientEmail', 'recipientPhone', 'setRecipientPhone',
            'deliveryMethod', 'setDeliveryMethod', 'file', 'handleFileChange', 'addField',
            'fields', 'selectedFieldId', 'setSelectedFieldId', 'removeField', 'getIcon',
        ].forEach((key) => expect(sidebar).toHaveProperty(key));

        const workbench = workbenchProps.at(-1);
        [
            'workbenchRef', 'file', 'numPages', 'setNumPages', 'activePage', 'pageRefs',
            'pageDimensions', 'onPageLoadSuccess', 'pdfViewportWidth', 'setPdfViewportWidth',
            'fields', 'selectedFieldId', 'setSelectedFieldId', 'updateFieldPosition',
            'updateFieldSize', 'removeField', 'updateFieldLabel', 'getIcon',
        ].forEach((key) => expect(workbench).toHaveProperty(key));

        // The shell must not change the initial editor state it hands down.
        expect(sidebar.creatorMode).toBe('request');
        expect(sidebar.fields).toEqual([]);
        expect(sidebar.deliveryMethod).toBe('email');
        expect(workbench.pdfViewportWidth).toBeGreaterThan(0);
    });

    it('starts a template-mode creator from initialMode', () => {
        setup({ initialMode: 'template' });
        expect(sidebarProps.at(-1).creatorMode).toBe('template');
    });
});

describe('EnvelopeCreator shell — presentation guardrails', () => {
    it('uses no unsupported 9px or 10px interface text in the shell', () => {
        const { container } = setup();
        expect(container.querySelector('[class*="text-[10px]"]')).toBeNull();
        expect(container.querySelector('[class*="text-[9px]"]')).toBeNull();
    });

    it('has no accessibility violations in the shell', async () => {
        const { container } = setup();
        expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });

    it('has no accessibility violations on the hydrating screen', async () => {
        let resolveDoc;
        fs.getDoc.mockReturnValue(new Promise((r) => { resolveDoc = r; }));
        const { container } = setup({ editRequestId: 'req-1' });
        expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
        await React.act(async () => { resolveDoc({ exists: () => false }); });
    });
});
