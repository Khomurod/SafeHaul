// EnvelopeCreator editor shell, part 3 of 3: the inspector, the field tools,
// and the signer preview.
// The shared harness — mock state, the prop-recording doubles, fixtures and
// helpers — lives in `EnvelopeCreator.editor.support.jsx`; the registrations
// below delegate to it. All data is artificial; react-pdf never runs.
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./EnvelopeCreator.editor.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./EnvelopeCreator.editor.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./EnvelopeCreator.editor.support')).firebaseStorageMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeCreator.editor.support')).firebaseFunctionsMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeCreator.editor.support')).feedbackMock());
vi.mock('./components/envelope-creator/EnvelopeSidebar', async () => (await import('./EnvelopeCreator.editor.support')).envelopeSidebarMock());
vi.mock('./components/envelope-creator/PageThumbnailRail', async () => (await import('./EnvelopeCreator.editor.support')).pageThumbnailRailMock());
vi.mock('./components/envelope-creator/PdfFieldWorkbench', async () => (await import('./EnvelopeCreator.editor.support')).pdfFieldWorkbenchMock());
vi.mock('./components/envelope-creator/FieldPropertiesPanel', async () => (await import('./EnvelopeCreator.editor.support')).fieldPropertiesPanelMock());
vi.mock('./components/envelope-creator/SignerPreviewDialog', async () => (await import('./EnvelopeCreator.editor.support')).signerPreviewDialogMock());

import EnvelopeCreator from './EnvelopeCreator';
import {
    makeSetup,
    resetHarness,
    fs,
    latestWorkbench,
    currentFields,
    loadPdf,
} from './EnvelopeCreator.editor.support';

const setup = makeSetup(EnvelopeCreator);

beforeEach(resetHarness);

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
