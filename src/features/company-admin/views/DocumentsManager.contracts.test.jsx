// The Documents workspace shell, part 3 of 3: the exact props each view
// receives — the shared subscription, the correction, library and forms
// contracts.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `DocumentsManager.support.jsx`; the registrations below delegate to it.
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
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
    company,
    creatorProps,
    overviewProps,
    sentProps,
    libraryProps,
    formsProps,
    firestoreMocks,
    signingRequestsMock,
} from './DocumentsManager.support';

const renderManager = makeRenderManager(DocumentsManager, MemoryRouter);

beforeEach(resetHarness);

describe('DocumentsManager view contracts', () => {
    it('shares one live subscription with Overview and Sent Documents', () => {
        const documents = [{ id: 'req-1', title: 'Artificial Form', status: 'sent' }];
        signingRequestsMock.current = { documents, isLoading: false, loadError: null, retry: vi.fn() };

        renderManager();
        expect(overviewProps.current.documents).toBe(documents);

        fireEvent.click(tabs().sent);
        expect(sentProps.current.documents).toBe(documents);
    });

    it('passes Sent Documents its company, retry and correction handler', () => {
        renderManager();
        fireEvent.click(tabs().sent);
        expect(sentProps.current.companyId).toBe('company-1');
        expect(typeof sentProps.current.onRetry).toBe('function');
        expect(typeof sentProps.current.onCorrect).toBe('function');
    });

    it('opens the creator in request mode when Sent Documents requests a correction', () => {
        renderManager();
        fireEvent.click(tabs().sent);
        React.act(() => { sentProps.current.onCorrect({ id: 'req-1', title: 'Artificial Form' }); });

        expect(screen.getByTestId('envelope-creator')).toBeInTheDocument();
        expect(creatorProps.current).toMatchObject({
            initialMode: 'request',
            editRequestId: 'req-1',
            editTemplateId: null,
        });
    });

    it('jumps from Overview straight into the Needs Attention filter', () => {
        renderManager();
        React.act(() => { overviewProps.current.onViewNeedsAttention(); });

        expect(tabs().sent).toHaveAttribute('aria-selected', 'true');
        expect(sentProps.current.filters.needsAttention).toBe(true);
    });

    it('passes the template library its five actions', () => {
        renderManager();
        fireEvent.click(tabs().templates);
        for (const callback of ['onSend', 'onEdit', 'onDuplicate', 'onConfigure', 'onDelete']) {
            expect(typeof libraryProps.current[callback]).toBe('function');
        }
    });

    it('opens the send wizard from the library Send action', () => {
        renderManager();
        fireEvent.click(tabs().templates);
        React.act(() => {
            libraryProps.current.onSend({ id: 'tpl-1', title: 'Artificial Template', fields: [] });
        });
        expect(screen.getByTestId('send-template-wizard')).toBeInTheDocument();
    });

    it('opens the creator for template editing from the library Edit action', () => {
        renderManager();
        fireEvent.click(tabs().templates);
        React.act(() => { libraryProps.current.onEdit({ id: 'tpl-1', title: 'Artificial Template' }); });

        expect(creatorProps.current).toMatchObject({
            initialMode: 'template',
            editTemplateId: 'tpl-1',
            editRequestId: null,
        });
    });

    it('sends Configure to the Application Forms view', () => {
        renderManager();
        fireEvent.click(tabs().templates);
        React.act(() => { libraryProps.current.onConfigure({ id: 'tpl-1' }); });
        expect(tabs().forms).toHaveAttribute('aria-selected', 'true');
    });

    it('refuses to duplicate a template whose schema is not safe to copy', async () => {
        renderManager();
        fireEvent.click(tabs().templates);
        await React.act(async () => {
            // No storagePath: the copy could never be opened or sent.
            await libraryProps.current.onDuplicate({ id: 'tpl-1', title: 'Broken', fields: [{ type: 'text' }] });
        });
        expect(firestoreMocks.addDoc).not.toHaveBeenCalled();
    });

    it('passes Application Forms the ordering, required and save contracts', () => {
        renderManager();
        fireEvent.click(tabs().forms);

        const expected = [
            'templates',
            'templatesLoading',
            'postSubmitTemplateIds',
            'postSubmitRequiredById',
            'togglePostSubmitRequired',
            'savingPostSubmitTemplates',
            'handleSavePostSubmitTemplates',
            'movePostSubmitTemplate',
            'isTemplateEnabledPostSubmit',
            'togglePostSubmitTemplate',
        ];
        expect(Object.keys(formsProps.current).sort()).toEqual([...expected].sort());
        for (const callback of [
            'togglePostSubmitRequired',
            'handleSavePostSubmitTemplates',
            'movePostSubmitTemplate',
            'isTemplateEnabledPostSubmit',
            'togglePostSubmitTemplate',
        ]) {
            expect(typeof formsProps.current[callback]).toBe('function');
        }
        expect(Array.isArray(formsProps.current.postSubmitTemplateIds)).toBe(true);
        expect(formsProps.current.postSubmitRequiredById).toEqual({});
    });

    it('reads legacy string and object post-application entries the same way', () => {
        renderManager({
            currentCompanyProfile: {
                ...company,
                postApplicationTemplates: [
                    'tpl-legacy-string',
                    { templateId: 'tpl-optional', required: false },
                    { id: 'tpl-required' },
                ],
            },
        });
        fireEvent.click(tabs().forms);

        expect(formsProps.current.postSubmitTemplateIds).toEqual([
            'tpl-legacy-string',
            'tpl-optional',
            'tpl-required',
        ]);
        // Missing flag means REQUIRED — the backward-compatible default.
        expect(formsProps.current.postSubmitRequiredById).toEqual({
            'tpl-legacy-string': true,
            'tpl-optional': false,
            'tpl-required': true,
        });
    });

    it('never saves the post-application forms just because a toggle changed', () => {
        renderManager();
        fireEvent.click(tabs().forms);
        React.act(() => { formsProps.current.togglePostSubmitTemplate('tpl-1'); });
        React.act(() => { formsProps.current.togglePostSubmitRequired('tpl-1'); });
        React.act(() => { formsProps.current.movePostSubmitTemplate('tpl-1', 'up'); });

        expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
    });
});
