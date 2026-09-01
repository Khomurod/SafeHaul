// EnvelopeCreator editor shell, part 2 of 3: global undo/redo with gesture
// coalescing, and page navigation and counts.
// The shared harness — mock state, the prop-recording doubles, fixtures and
// helpers — lives in `EnvelopeCreator.editor.support.jsx`; the registrations
// below delegate to it. All data is artificial; react-pdf never runs.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
    latestWorkbench,
    currentFields,
    loadPdf,
} from './EnvelopeCreator.editor.support';

const setup = makeSetup(EnvelopeCreator);

beforeEach(resetHarness);

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

