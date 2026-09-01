// The Documents workspace shell, part 1 of 3: the page header and its two
// actions, and the New Document choices.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `DocumentsManager.support.jsx`; the registrations below delegate to it.
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/DataContext', async () => (await import('./DocumentsManager.support')).dataContextMock());
vi.mock('react-router-dom', async (importOriginal) => (await import('./DocumentsManager.support')).reactRouterMock(importOriginal));
vi.mock('@lib/firebase', async () => (await import('./DocumentsManager.support')).libFirebaseMock());
vi.mock('firebase/functions', async () => (await import('./DocumentsManager.support')).firebaseFunctionsMock());
vi.mock('firebase/firestore', async () => (await import('./DocumentsManager.support')).firebaseFirestoreMock());
vi.mock('@features/signing/hooks/useSigningRequests', async () => (await import('./DocumentsManager.support')).useSigningRequestsMock());
vi.mock('@features/signing/EnvelopeCreator', async () => (await import('./DocumentsManager.support')).envelopeCreatorMock());
vi.mock('../components/documents/DocumentsOverview', async () => (await import('./DocumentsManager.support')).documentsOverviewMock());
vi.mock('../components/documents/SentDocumentsPanel', async () => (await import('./DocumentsManager.support')).sentDocumentsPanelMock());
vi.mock('../components/documents/TemplateLibraryPanel', async () => (await import('./DocumentsManager.support')).templateLibraryPanelMock());
vi.mock('../components/documents/ApplicationFormsPanel', async () => (await import('./DocumentsManager.support')).applicationFormsPanelMock());
vi.mock('../components/documents/SendTemplateWizard', async () => (await import('./DocumentsManager.support')).sendTemplateWizardMock());
vi.mock('@shared/components/feedback', async () => (await import('./DocumentsManager.support')).feedbackMock());

import { MemoryRouter } from 'react-router-dom';
import DocumentsManager from './DocumentsManager';
import {
    makeRenderManager,
    resetHarness,
    tabs,
    openNewDocument,
    navigateMock,
    creatorProps,
    firestoreMocks,
    functionsMocks,
} from './DocumentsManager.support';

const renderManager = makeRenderManager(DocumentsManager, MemoryRouter);

beforeEach(resetHarness);

describe('DocumentsManager header', () => {
    it('names the page Documents and states what it is for', () => {
        renderManager();
        expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument();
        expect(
            screen.getByText(
                'Create, send, track and manage documents requiring completion or signature.',
            ),
        ).toBeInTheDocument();
    });

    it('offers New Document as the primary action and Manage Templates as the secondary', () => {
        renderManager();
        expect(screen.getByRole('button', { name: 'New Document' })).toHaveAttribute('data-variant', 'primary');
        expect(screen.getByRole('button', { name: 'Manage Templates' })).toHaveClass('ds-button');
    });

    it('navigates back to the company dashboard', () => {
        renderManager();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Dashboard' }));
        expect(navigateMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/company/dashboard');
    });

    it('outdents the back control by its own padding so the label aligns with the heading', () => {
        renderManager();
        // -ml-ds-3 cancels the sm button's ds-space-3 inline padding: the
        // visible arrow/label lines up with the Documents heading while the
        // padded hit area and focus ring keep their full size.
        expect(screen.getByRole('button', { name: 'Back to Dashboard' })).toHaveClass('-ml-ds-3', 'self-start');
    });

    it('sends Manage Templates to the Templates view without opening the creator', () => {
        renderManager();
        fireEvent.click(screen.getByRole('button', { name: 'Manage Templates' }));
        expect(tabs().templates).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('envelope-creator')).not.toBeInTheDocument();
    });

    it('uses approved Button primitives for every header action', () => {
        renderManager();
        for (const name of ['Back to Dashboard', 'Manage Templates', 'New Document']) {
            expect(screen.getByRole('button', { name })).toHaveClass('ds-button');
        }
    });

    it('uses no legacy gray canvas or hard-coded header colours', () => {
        const { container } = renderManager();
        const header = container.querySelector('.ds-page-header');
        expect(header).toBeTruthy();
        expect(container.querySelector('.ds-page-container')).toBeTruthy();
        expect(container.innerHTML).not.toContain('bg-gray-50');
        expect(header.innerHTML).not.toMatch(/text-blue-600|text-purple-600|bg-blue-600/);
    });

    it('lets the header actions wrap instead of overflowing', () => {
        const { container } = renderManager();
        expect(container.querySelector('.ds-page-header')).toHaveClass('flex-wrap');
        expect(container.querySelector('.ds-page-header__actions .ds-inline')).toHaveAttribute('data-wrap', 'true');
    });

    it('has no accessibility violations in the header region', async () => {
        const { container } = renderManager();
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('DocumentsManager New Document', () => {
    it('offers exactly the three documented ways to start', () => {
        renderManager();
        openNewDocument();

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Send from template/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Upload and send PDF/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create reusable template/ })).toBeInTheDocument();
    });

    it('opens the creator in a FIXED request mode for Upload and send PDF', () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Upload and send PDF/ }));

        expect(screen.getByTestId('envelope-creator')).toBeInTheDocument();
        expect(creatorProps.current).toMatchObject({
            companyId: 'company-1',
            companyName: 'Artificial Freight Co',
            initialMode: 'request',
            editRequestId: null,
            editTemplateId: null,
        });
    });

    it('opens the creator in a FIXED template mode for Create reusable template', () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Create reusable template/ }));

        expect(creatorProps.current).toMatchObject({
            initialMode: 'template',
            editRequestId: null,
            editTemplateId: null,
        });
    });

    it('sends Send from template to the Templates view rather than the creator', () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Send from template/ }));

        expect(screen.queryByTestId('envelope-creator')).not.toBeInTheDocument();
        expect(tabs().templates).toHaveAttribute('aria-selected', 'true');
    });

    it('writes nothing and sends nothing when a choice is made', () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Create reusable template/ }));

        expect(firestoreMocks.addDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
        expect(functionsMocks.httpsCallable).not.toHaveBeenCalled();
    });

    it('returns to the workspace when the creator closes', () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Upload and send PDF/ }));

        // The creator owns its own close control; invoke the handler it was given.
        React.act(() => { creatorProps.current.onClose(); });

        expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New Document' })).toBeInTheDocument();
    });

    it('has no accessibility violations while the choices are open', async () => {
        const { container } = renderManager();
        openNewDocument();
        expect((await axe(container)).violations).toEqual([]);
    });
});
