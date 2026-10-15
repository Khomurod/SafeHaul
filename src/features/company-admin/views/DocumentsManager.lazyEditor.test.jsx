// The document editor (the PDF workbench, pdf.js and the AI field assistant)
// loads when a document is created or edited, not with the Documents workspace,
// whose overview and lists most visits stop at. The shared harness lives in
// `DocumentsManager.support.jsx`.
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ loaded: false }));

vi.mock('@/context/DataContext', async () => (await import('./DocumentsManager.support')).dataContextMock());
vi.mock('react-router-dom', async (importOriginal) => (await import('./DocumentsManager.support')).reactRouterMock(importOriginal));
vi.mock('@lib/firebase', async () => (await import('./DocumentsManager.support')).libFirebaseMock());
vi.mock('firebase/functions', async () => (await import('./DocumentsManager.support')).firebaseFunctionsMock());
vi.mock('firebase/firestore', async () => (await import('./DocumentsManager.support')).firebaseFirestoreMock());
vi.mock('@features/signing/hooks/useSigningRequests', async () => (await import('./DocumentsManager.support')).useSigningRequestsMock());
vi.mock('@features/signing/EnvelopeCreator', async () => {
    fx.loaded = true;
    return (await import('./DocumentsManager.support')).envelopeCreatorMock();
});
vi.mock('../components/documents/DocumentsOverview', async () => (await import('./DocumentsManager.support')).documentsOverviewMock());
vi.mock('../components/documents/SentDocumentsPanel', async () => (await import('./DocumentsManager.support')).sentDocumentsPanelMock());
vi.mock('../components/documents/TemplateLibraryPanel', async () => (await import('./DocumentsManager.support')).templateLibraryPanelMock());
vi.mock('../components/documents/ApplicationFormsPanel', async () => (await import('./DocumentsManager.support')).applicationFormsPanelMock());
vi.mock('../components/documents/SendTemplateWizard', async () => (await import('./DocumentsManager.support')).sendTemplateWizardMock());
vi.mock('@shared/components/feedback', async () => (await import('./DocumentsManager.support')).feedbackMock());

import { MemoryRouter } from 'react-router-dom';
import DocumentsManager from './DocumentsManager';
import { creatorProps, makeRenderManager, openNewDocument, resetHarness } from './DocumentsManager.support';

const renderManager = makeRenderManager(DocumentsManager, MemoryRouter);

beforeEach(resetHarness);

describe('the document editor', () => {
    it('loads when a document is created, not with the workspace', async () => {
        renderManager();
        expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument();
        expect(fx.loaded).toBe(false);

        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Upload and send PDF/ }));

        expect(await screen.findByTestId('envelope-creator')).toBeInTheDocument();
        expect(fx.loaded).toBe(true);
        expect(creatorProps.current).toMatchObject({ initialMode: 'request', editRequestId: null });
    });
});
