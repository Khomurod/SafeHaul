// EnvelopeCreator under the real ToastProvider. The "Correct" / "Edit Template"
// hydration effect lists `showError`, so while that helper changed with every
// notification, any notification reloaded the document and reset the editor:
// the edits were gone. The other suites stand in a stable double for the
// provider, so they could not see it. The harness is
// `EnvelopeCreator.editor.support.jsx`; all data is artificial.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./EnvelopeCreator.editor.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./EnvelopeCreator.editor.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./EnvelopeCreator.editor.support')).firebaseStorageMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeCreator.editor.support')).firebaseFunctionsMock());
vi.mock('./components/envelope-creator/EnvelopeSidebar', async () => (await import('./EnvelopeCreator.editor.support')).envelopeSidebarMock());
vi.mock('./components/envelope-creator/PageThumbnailRail', async () => (await import('./EnvelopeCreator.editor.support')).pageThumbnailRailMock());
vi.mock('./components/envelope-creator/PdfFieldWorkbench', async () => (await import('./EnvelopeCreator.editor.support')).pdfFieldWorkbenchMock());
vi.mock('./components/envelope-creator/FieldPropertiesPanel', async () => (await import('./EnvelopeCreator.editor.support')).fieldPropertiesPanelMock());
vi.mock('./components/envelope-creator/SignerPreviewDialog', async () => (await import('./EnvelopeCreator.editor.support')).signerPreviewDialogMock());

import { ToastProvider } from '@shared/components/feedback';
import EnvelopeCreator from './EnvelopeCreator';
import { fs, loadPdf, resetHarness } from './EnvelopeCreator.editor.support';

beforeEach(resetHarness);

it('keeps the edits to a template when a notification comes and goes', async () => {
    // A template whose file reference never hydrated: saving it bails out with
    // an error notification, which is the notification this test needs.
    fs.getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ title: 'Artificial Template', fields: [], storagePath: '' }),
    });
    render(
        <ToastProvider>
            <EnvelopeCreator companyId="co-1" onClose={vi.fn()} companyName="Artificial Carrier" editTemplateId="tpl-1" />
        </ToastProvider>,
    );
    const title = await screen.findByLabelText('Document title');
    await waitFor(() => expect(title).toHaveValue('Artificial Template'));
    await loadPdf();

    fireEvent.change(title, { target: { value: 'Renamed' } });
    fireEvent.blur(title);
    fireEvent.click(screen.getByRole('button', { name: 'add text field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Template Changes' }));
    await screen.findByText('Template file reference is missing. Please re-upload the PDF as a new template.');

    expect(fs.getDoc).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Document title')).toHaveValue('Renamed');
});
