// The Documents workspace shell, part 1 of 3: the page header and its one
// action, and the New Document choices.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `DocumentsManager.support.jsx`; the registrations below delegate to it.
import React from 'react';
import { act, screen, fireEvent, within } from '@testing-library/react';
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
    sentProps,
    signingRequestsMock,
} from './DocumentsManager.support';

const renderManager = makeRenderManager(DocumentsManager, MemoryRouter);

beforeEach(resetHarness);

describe('DocumentsManager header', () => {
    it('names the page Documents and states what it is for', () => {
        renderManager();
        expect(screen.getByRole('heading', { level: 1, name: 'E-Docs' })).toBeInTheDocument();
        expect(
            screen.getByText(
                'Create, send, track and manage documents requiring completion or signature.',
            ),
        ).toBeInTheDocument();
    });

    it('offers New Document as its one action: the Templates tab is the way to the templates', () => {
        renderManager();
        expect(screen.getByRole('button', { name: 'New Document' })).toHaveAttribute('data-variant', 'primary');
        expect(screen.queryByRole('button', { name: 'Manage Templates' })).not.toBeInTheDocument();
        expect(tabs().templates).toBeInTheDocument();
    });

    it('links back to the company dashboard and routes there in the app', () => {
        renderManager();
        const back = screen.getByRole('link', { name: 'Back to Dashboard' });
        // A real link (it opens in a new tab too), routed in script on a plain click.
        expect(back).toHaveAttribute('href', '/company/dashboard');
        fireEvent.click(back);
        expect(navigateMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/company/dashboard');
    });

    it('draws the back link and the Documents eyebrow on one row above the heading (C2)', () => {
        renderManager();
        const header = screen.getByRole('heading', { level: 1, name: 'E-Docs' }).closest('header');
        const row = within(header).getByRole('link', { name: 'Back to Dashboard' }).closest('.ds-page-eyebrow');
        expect(row).toBeTruthy();
        expect(within(row).getByText('Documents')).toHaveClass('ds-page-eyebrow__text');
    });

    it('uses approved primitives for every header action', () => {
        renderManager();
        expect(screen.getByRole('button', { name: 'New Document' })).toHaveClass('ds-button');
        expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveClass('ds-link');
    });

    it('uses no legacy gray canvas or hard-coded header colours', () => {
        const { container } = renderManager();
        const header = container.querySelector('.ds-page-header');
        expect(header).toBeTruthy();
        expect(container.querySelector('.ds-page-container')).toBeTruthy();
        expect(container.innerHTML).not.toContain('bg-gray-50');
        expect(header.innerHTML).not.toMatch(/text-blue-600|text-purple-600|bg-blue-600/);
    });

    it('has no accessibility violations in the header region', async () => {
        const { container } = renderManager();
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('DocumentsManager sent documents count', () => {
    const sent = (id, overrides = {}) => ({ id, title: `Artificial ${id}`, status: 'sent', ...overrides });
    const announced = () => screen.getByTestId('sent-documents-count');

    it('counts the sent documents in the Sent Documents tab on every tab, never beside the heading: on Sent what it lists, elsewhere all of them', () => {
        signingRequestsMock.current = {
            ...signingRequestsMock.current,
            documents: [sent('a'), sent('b', { status: 'signed' }), sent('c', { emailStatus: 'failed' })],
        };
        renderManager();
        const header = screen.getByRole('heading', { level: 1, name: 'E-Docs' }).closest('header');
        expect(within(header).queryByRole('status')).not.toBeInTheDocument();
        // The number is in the tab on Overview too; the heading is the same on every tab.
        expect(tabs().sent).toHaveTextContent(/^Sent Documents 3$/);
        // The region stays in place, empty, so a screen reader hears the count arrive.
        expect(announced()).toHaveAttribute('role', 'status');
        expect(announced()).toHaveTextContent(/^$/);

        fireEvent.click(tabs().sent);
        expect(tabs().sent).toHaveTextContent(/^Sent Documents 3$/);
        expect(announced()).toHaveTextContent(/^3 sent documents$/);

        // The documents the panel's search and filters keep.
        act(() => sentProps.current.setFilters((prev) => ({ ...prev, needsAttention: true })));
        expect(tabs().sent).toHaveTextContent(/^Sent Documents 1$/);
        expect(announced()).toHaveTextContent(/^1 sent document$/);

        // Away from Sent its search and filters are out of sight, so the tab
        // counts every sent document again; back on Sent, what it lists.
        fireEvent.click(tabs().templates);
        expect(tabs().sent).toHaveTextContent(/^Sent Documents 3$/);
        expect(announced()).toHaveTextContent(/^$/);
        fireEvent.click(tabs().sent);
        expect(tabs().sent).toHaveTextContent(/^Sent Documents 1$/);
        expect(announced()).toHaveTextContent(/^1 sent document$/);
    });

    it.each([
        ['loading', { isLoading: true }],
        ['failed', { loadError: 'Could not load document history. Please try again.' }],
    ])('shows no count while the documents are %s', (_, state) => {
        signingRequestsMock.current = { ...signingRequestsMock.current, documents: [], ...state };
        renderManager();
        fireEvent.click(tabs().sent);
        expect(tabs().sent).toHaveTextContent(/^Sent Documents$/);
        expect(announced()).toHaveTextContent(/^$/);
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

    it('opens the creator in a FIXED request mode for Upload and send PDF', async () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Upload and send PDF/ }));

        expect(await screen.findByTestId('envelope-creator')).toBeInTheDocument();
        expect(creatorProps.current).toMatchObject({
            companyId: 'company-1',
            companyName: 'Artificial Freight Co',
            initialMode: 'request',
            editRequestId: null,
            editTemplateId: null,
        });
    });

    it('opens the creator in a FIXED template mode for Create reusable template', async () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Create reusable template/ }));

        await screen.findByTestId('envelope-creator');
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

    it('writes nothing and sends nothing when a choice is made', async () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Create reusable template/ }));

        await screen.findByTestId('envelope-creator');
        expect(firestoreMocks.addDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
        expect(functionsMocks.httpsCallable).not.toHaveBeenCalled();
    });

    it('returns to the workspace when the creator closes', async () => {
        renderManager();
        openNewDocument();
        fireEvent.click(screen.getByRole('button', { name: /Upload and send PDF/ }));
        await screen.findByTestId('envelope-creator');

        // The creator owns its own close control; invoke the handler it was given.
        React.act(() => { creatorProps.current.onClose(); });

        expect(screen.getByRole('heading', { level: 1, name: 'E-Docs' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New Document' })).toBeInTheDocument();
    });

    it('has no accessibility violations while the choices are open', async () => {
        const { container } = renderManager();
        openNewDocument();
        expect((await axe(container)).violations).toEqual([]);
    });
});
