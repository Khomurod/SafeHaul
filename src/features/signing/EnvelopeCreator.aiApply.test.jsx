// AI Field Assistant, part 2 of 2: applying suggestions, manual-field
// preservation, one-level undo, and the never-saves-automatically guarantee.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `EnvelopeCreator.aiAssistant.support.jsx`; the registrations below delegate
// to it. The AI provider is never reached; every field and page is artificial.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./EnvelopeCreator.aiAssistant.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./EnvelopeCreator.aiAssistant.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./EnvelopeCreator.aiAssistant.support')).firebaseStorageMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeCreator.aiAssistant.support')).firebaseFunctionsMock());
vi.mock('uuid', async () => (await import('./EnvelopeCreator.aiAssistant.support')).uuidMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeCreator.aiAssistant.support')).feedbackMock());
vi.mock('@features/signing/utils/pdfPageRasterizer', async () => (await import('./EnvelopeCreator.aiAssistant.support')).pdfPageRasterizerMock());
vi.mock('@features/signing/utils/pdfFieldInspector', async (importOriginal) => (await import('./EnvelopeCreator.aiAssistant.support')).pdfFieldInspectorMock(importOriginal));
vi.mock('./components/envelope-creator/PageThumbnailRail', async () => (await import('./EnvelopeCreator.aiAssistant.support')).pageThumbnailRailMock());
vi.mock('./components/envelope-creator/PdfFieldWorkbench', async () => (await import('./EnvelopeCreator.aiAssistant.support')).pdfFieldWorkbenchMock());

import EnvelopeCreator from './EnvelopeCreator';
import {
    makeRenderCreator,
    resetHarness,
    loadPdf,
    runScan,
    aiSuggestion,
    callable,
    firestoreMocks,
    storageMocks,
    workbenchProps,
} from './EnvelopeCreator.aiAssistant.support';

const renderCreator = makeRenderCreator(EnvelopeCreator);

beforeEach(resetHarness);

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
