// EnvelopeCreator editor shell, part 1 of 3: the save-state badge and live
// region, recipient/delivery edits, the failed save, and unsaved-change
// protection.
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
    sidebarProps,
    toast,
    fs,
    currentFields,
    expectSaveStateAnnounced,
    loadPdf,
} from './EnvelopeCreator.editor.support';

const setup = makeSetup(EnvelopeCreator);

beforeEach(resetHarness);

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

