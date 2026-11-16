// The Documents workspace shell, part 3 of 3: the exact props each view
// receives — the shared subscription, the correction, library and forms
// contracts.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `DocumentsManager.support.jsx`; the registrations below delegate to it.
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    wizardProps,
    firestoreMocks,
    signingRequestsMock,
    toastMocks,
    recruiterClaims,
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

    it('passes Overview the numbers and the attention list, and Sent Documents how much is loaded', () => {
        const documents = [
            { id: 'req-1', title: 'Artificial Form', status: 'sent' },
            { id: 'req-2', title: 'Artificial Seal', status: 'error_sealing' },
        ];
        signingRequestsMock.current = { documents, isLoading: false, loadError: null, retry: vi.fn() };

        renderManager();
        // Every document is loaded, so both come from the loaded rows.
        expect(overviewProps.current.summary).toMatchObject({ total: 2, needsAttention: 1 });
        expect(overviewProps.current.attention).toMatchObject({ complete: true, isLoading: false, error: null, total: 1 });
        expect(overviewProps.current.attention.documents.map((d) => d.id)).toEqual(['req-2']);
        expect(overviewProps.current.countsError).toBe(null);
        expect(typeof overviewProps.current.onRetryCounts).toBe('function');

        fireEvent.click(tabs().sent);
        expect(sentProps.current.list).toMatchObject({ complete: true, hasMore: false, total: 2 });
        expect(sentProps.current.attention).toBe(overviewProps.current.attention);
    });

    it('passes Sent Documents its company, retry and correction handler', () => {
        renderManager();
        fireEvent.click(tabs().sent);
        expect(sentProps.current.companyId).toBe('company-1');
        expect(typeof sentProps.current.onRetry).toBe('function');
        expect(typeof sentProps.current.onCorrect).toBe('function');
    });

    it('opens the creator in request mode when Sent Documents requests a correction', async () => {
        renderManager();
        fireEvent.click(tabs().sent);
        React.act(() => { sentProps.current.onCorrect({ id: 'req-1', title: 'Artificial Form' }); });

        expect(await screen.findByTestId('envelope-creator')).toBeInTheDocument();
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

    it.each([
        ['onViewAwaiting', { status: 'sent', needsAttention: false }],
        ['onViewCompleted', { status: 'signed', needsAttention: false }],
    ])('opens Sent Documents from Overview %s with the list that number counts', (callback, filters) => {
        renderManager();
        React.act(() => { overviewProps.current[callback](); });

        expect(tabs().sent).toHaveAttribute('aria-selected', 'true');
        expect(sentProps.current.filters).toEqual({ search: '', status: filters.status, delivery: 'all', date: 'all', needsAttention: filters.needsAttention });
    });

    it('opens the Templates tab from Overview Active templates', () => {
        renderManager();
        React.act(() => { overviewProps.current.onViewTemplates(); });
        expect(tabs().templates).toHaveAttribute('aria-selected', 'true');
    });

    it("opens a Needs attention card's document in its details dialog, over the Overview", async () => {
        renderManager();
        React.act(() => {
            overviewProps.current.onOpenDocument({
                id: 'req-9',
                title: 'Artificial Failed Offer',
                recipientName: 'Artificial Person',
                recipientEmail: 'artificial.person@example.test',
                status: 'sent',
                sendEmail: true,
                emailStatus: 'failed',
                emailError: 'Mailbox unavailable',
            });
        });

        const dialog = await screen.findByRole('dialog', { name: 'Artificial Failed Offer' });
        expect(within(dialog).getByRole('alert')).toHaveTextContent('The email address was refused.');
        for (const name of ['Fix recipient and resend', 'Resend', 'Void']) {
            expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
        }
        expect(tabs().overview).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('passes the template library its actions, New template among them', () => {
        renderManager();
        fireEvent.click(tabs().templates);
        for (const callback of ['onSend', 'onEdit', 'onDuplicate', 'onConfigure', 'onDelete', 'onCreate']) {
            expect(typeof libraryProps.current[callback]).toBe('function');
        }
    });

    it('starts a new template from the library, as New Document → Create reusable template does', async () => {
        renderManager();
        fireEvent.click(tabs().templates);
        React.act(() => { libraryProps.current.onCreate(); });

        await screen.findByTestId('envelope-creator');
        expect(creatorProps.current).toMatchObject({ initialMode: 'template', editTemplateId: null, editRequestId: null });
    });

    it('gives no Delete to a team member who is not an admin: only admins may delete a template', () => {
        renderManager({ currentUserClaims: recruiterClaims });
        fireEvent.click(tabs().templates);
        expect(libraryProps.current.onDelete).toBeUndefined();
        for (const callback of ['onSend', 'onEdit', 'onDuplicate', 'onConfigure', 'onCreate']) {
            expect(typeof libraryProps.current[callback]).toBe('function');
        }
    });

    describe('a template delete the server refuses', () => {
        const refusal = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        let consoleError;

        beforeEach(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => {}); });
        afterEach(() => {
            consoleError.mockRestore();
            firestoreMocks.deleteDoc.mockImplementation(() => undefined);
        });

        it('says so plainly and keeps the confirmation open, instead of failing silently', async () => {
            firestoreMocks.deleteDoc.mockImplementation(() => Promise.reject(refusal));
            renderManager();
            fireEvent.click(tabs().templates);
            React.act(() => { libraryProps.current.onDelete('tpl-1'); });

            const confirm = await screen.findByRole('dialog', { name: /^Delete / });
            fireEvent.click(within(confirm).getByRole('button', { name: 'Delete template' }));

            // The rendered consequence first: the button comes back once the delete has settled.
            await waitFor(() => expect(within(confirm).getByRole('button', { name: 'Delete template' })).toBeEnabled());
            expect(toastMocks.showError).toHaveBeenCalledWith('Only a company admin can delete templates.');
            expect(screen.getByRole('dialog', { name: /^Delete / })).toBeInTheDocument();
        });

        it('names any other failure as one to try again', async () => {
            firestoreMocks.deleteDoc.mockImplementation(() => Promise.reject(new Error('offline')));
            renderManager();
            fireEvent.click(tabs().templates);
            React.act(() => { libraryProps.current.onDelete('tpl-1'); });

            const confirm = await screen.findByRole('dialog', { name: /^Delete / });
            fireEvent.click(within(confirm).getByRole('button', { name: 'Delete template' }));

            await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith('Could not delete this template. Please try again.'));
        });
    });

    it('opens the send wizard from the library Send action', () => {
        renderManager();
        fireEvent.click(tabs().templates);
        React.act(() => {
            libraryProps.current.onSend({ id: 'tpl-1', title: 'Artificial Template', fields: [] });
        });
        expect(screen.getByTestId('send-template-wizard')).toBeInTheDocument();
    });

    it('opens the creator for template editing from the library Edit action', async () => {
        renderManager();
        fireEvent.click(tabs().templates);
        React.act(() => { libraryProps.current.onEdit({ id: 'tpl-1', title: 'Artificial Template' }); });

        await screen.findByTestId('envelope-creator');
        expect(creatorProps.current).toMatchObject({
            initialMode: 'template',
            editTemplateId: 'tpl-1',
            editRequestId: null,
        });
    });

    it('sends Configure to the After-application forms view', () => {
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

    it('passes After-application forms the ordering, required and save contracts', () => {
        renderManager();
        fireEvent.click(tabs().forms);

        // The template list, and `usePostSubmitForms`'s result whole as `forms`.
        expect(Object.keys(formsProps.current).sort()).toEqual(['forms', 'templates', 'templatesLoading']);
        const { forms } = formsProps.current;
        for (const callback of [
            'togglePostSubmitRequired',
            'handleSavePostSubmitTemplates',
            'movePostSubmitTemplate',
            'isTemplateEnabledPostSubmit',
            'togglePostSubmitTemplate',
        ]) {
            expect(typeof forms[callback]).toBe('function');
        }
        expect(Array.isArray(forms.postSubmitTemplateIds)).toBe(true);
        expect(forms.postSubmitRequiredById).toEqual({});
        expect(forms.savingPostSubmitTemplates).toBe(false);
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

        expect(formsProps.current.forms.postSubmitTemplateIds).toEqual([
            'tpl-legacy-string',
            'tpl-optional',
            'tpl-required',
        ]);
        // Missing flag means REQUIRED — the backward-compatible default.
        expect(formsProps.current.forms.postSubmitRequiredById).toEqual({
            'tpl-legacy-string': true,
            'tpl-optional': false,
            'tpl-required': true,
        });
    });

    it('hands the send wizard the template-send flow whole, and closes it when idle', async () => {
        renderManager();
        fireEvent.click(tabs().templates);
        const template = { id: 'tpl-1', title: 'Artificial Offer Letter', fields: [] };
        React.act(() => { libraryProps.current.onSend(template); });

        // The picker's records have loaded (none here), so nothing is left in flight.
        await waitFor(() => expect(wizardProps.current?.flow.driversStatus).toBe('ready'), { timeout: 5000 });
        expect(screen.getByTestId('send-template-wizard')).toBeInTheDocument();
        expect(Object.keys(wizardProps.current).sort()).toEqual(['flow', 'onClose']);
        const { flow } = wizardProps.current;
        expect(flow.selectedTemplate).toBe(template);
        expect(flow).toMatchObject({
            manualName: '', manualEmail: '', manualPhone: '', deliveryMethod: 'email',
            sending: false, drivers: [], searchQuery: '', linkedRecord: null,
        });
        expect(flow.editablePrefillPartition).toEqual({ groups: [], plainFields: [] });
        for (const callback of [
            'setManualName', 'setManualEmail', 'setManualPhone', 'setDeliveryMethod',
            'setPrefillValues', 'setPrefillValuesByGroupKey', 'setSearchQuery',
            'handleQuickSelect', 'executeTemplateSend',
        ]) {
            expect(typeof flow[callback]).toBe('function');
        }

        React.act(() => { wizardProps.current.onClose(); });
        await waitFor(() => expect(screen.queryByTestId('send-template-wizard')).not.toBeInTheDocument());
    });

    it('never saves the post-application forms just because a toggle changed', () => {
        renderManager();
        fireEvent.click(tabs().forms);
        React.act(() => { formsProps.current.forms.togglePostSubmitTemplate('tpl-1'); });
        React.act(() => { formsProps.current.forms.togglePostSubmitRequired('tpl-1'); });
        React.act(() => { formsProps.current.forms.movePostSubmitTemplate('tpl-1', 'up'); });

        expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
    });
});
