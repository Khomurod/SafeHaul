// The Documents workspace shell, part 2 of 3: the four-view tab interface
// (roles, ARIA relationships, roving tabIndex, keyboard navigation) and the
// E-Docs feature gate.
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
    company,
    navigateMock,
    firestoreMocks,
    functionsMocks,
} from './DocumentsManager.support';

const renderManager = makeRenderManager(DocumentsManager, MemoryRouter);

beforeEach(resetHarness);

describe('DocumentsManager views', () => {
    it('starts on Overview, not on a tool', () => {
        renderManager();
        expect(tabs().overview).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('documents-overview')).toBeInTheDocument();
        expect(screen.queryByTestId('sent-documents')).not.toBeInTheDocument();
    });

    it.each([
        ['sent', 'sent-documents'],
        ['templates', 'template-library'],
        ['forms', 'application-forms'],
    ])('switches to the %s view', (tabKey, testId) => {
        renderManager();
        fireEvent.click(tabs()[tabKey]);
        expect(tabs()[tabKey]).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId(testId)).toBeInTheDocument();
        expect(screen.queryByTestId('documents-overview')).not.toBeInTheDocument();
    });

    /*
     * The strip is the design system's `TabList` since 2026-08-25.
     *
     * `aria-controls` is on the SELECTED tab only. One panel is rendered, so
     * pointing all four tabs at it was fine here but is not the primitive's
     * contract — it renders a panel per selected tab, and an unselected tab
     * pointing at an id that does not exist is a dangling IDREF. The ARIA tab
     * pattern makes the attribute optional in exactly that case.
     */
    it('exposes a labelled tablist with connected tabs and panel', () => {
        renderManager();
        expect(screen.getByRole('tablist', { name: 'Documents workspace views' })).toBeInTheDocument();

        const panel = screen.getByRole('tabpanel');
        const all = tabs();
        expect(all.overview).toHaveAttribute('aria-controls', panel.id);
        for (const [name, tab] of Object.entries(all)) {
            expect(tab.id).toBeTruthy();
            if (name !== 'overview') expect(tab).not.toHaveAttribute('aria-controls');
        }
        expect(new Set(Object.values(all).map((tab) => tab.id)).size).toBe(4);
        expect(panel).toHaveAttribute('aria-labelledby', all.overview.id);

        fireEvent.click(all.forms);
        expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs().forms.id);
    });

    it('keeps a roving tabIndex on the selected tab only', () => {
        renderManager();
        expect(tabs().overview).toHaveAttribute('tabindex', '0');
        expect(tabs().sent).toHaveAttribute('tabindex', '-1');

        fireEvent.click(tabs().sent);
        expect(tabs().overview).toHaveAttribute('tabindex', '-1');
        expect(tabs().sent).toHaveAttribute('tabindex', '0');
    });

    /*
     * Selection is `aria-selected`, and the name is only the label.
     *
     * This used to assert a visually-hidden "(selected)" inside the tab. The
     * primitive dropped it: it made the selected tab announce its state twice and
     * put state inside the accessible NAME, so every exact-match query for a tab
     * had to know about it. The visual concern it was aimed at — selection by
     * colour alone — is handled by a `forced-colors` rule in `Tabs.css`.
     */
    it('states the selected tab in aria-selected, not in its name', () => {
        renderManager();
        expect(tabs().overview).toHaveAttribute('aria-selected', 'true');
        expect(tabs().overview).toHaveAccessibleName('Overview');
        expect(tabs().sent).toHaveAttribute('aria-selected', 'false');
    });

    it('moves selection and focus with ArrowRight and ArrowLeft, wrapping at the ends', () => {
        renderManager();
        const tablist = screen.getByRole('tablist');
        tabs().overview.focus();

        fireEvent.keyDown(tabs().overview, { key: 'ArrowRight' });
        expect(tabs().sent).toHaveAttribute('aria-selected', 'true');
        expect(tabs().sent).toHaveFocus();

        fireEvent.keyDown(tabs().sent, { key: 'ArrowLeft' });
        expect(tabs().overview).toHaveAttribute('aria-selected', 'true');
        expect(tabs().overview).toHaveFocus();

        // ArrowLeft from the first tab wraps to the last.
        fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
        expect(tabs().forms).toHaveAttribute('aria-selected', 'true');

        // ArrowRight from the last tab wraps to the first.
        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
        expect(tabs().overview).toHaveAttribute('aria-selected', 'true');
    });

    it('moves to the first and last tab with Home and End', () => {
        renderManager();
        const tablist = screen.getByRole('tablist');

        fireEvent.keyDown(tablist, { key: 'End' });
        expect(tabs().forms).toHaveAttribute('aria-selected', 'true');
        expect(tabs().forms).toHaveFocus();

        fireEvent.keyDown(tablist, { key: 'Home' });
        expect(tabs().overview).toHaveAttribute('aria-selected', 'true');
        expect(tabs().overview).toHaveFocus();
    });

    it('ignores keys that are not part of the tab contract', () => {
        renderManager();
        const tablist = screen.getByRole('tablist');
        fireEvent.keyDown(tablist, { key: 'ArrowDown' });
        fireEvent.keyDown(tablist, { key: 'a' });
        expect(tabs().overview).toHaveAttribute('aria-selected', 'true');
    });

    it('performs no Firebase write, callable or send action when switching views', () => {
        renderManager();
        functionsMocks.httpsCallable.mockClear();

        fireEvent.click(tabs().sent);
        fireEvent.click(tabs().templates);
        fireEvent.click(tabs().forms);
        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });

        expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.deleteDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.addDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
        expect(functionsMocks.httpsCallable).not.toHaveBeenCalled();
        expect(screen.queryByTestId('send-template-wizard')).not.toBeInTheDocument();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('has no accessibility violations on any view', async () => {
        const { container } = renderManager();
        expect((await axe(container)).violations).toEqual([]);

        for (const key of ['sent', 'templates', 'forms']) {
            fireEvent.click(tabs()[key]);
            // eslint-disable-next-line no-await-in-loop
            expect((await axe(container)).violations).toEqual([]);
        }
    });
});


describe('DocumentsManager gating', () => {
    it('locks the workspace when E-Docs is disabled for the company', () => {
        renderManager({ currentCompanyProfile: { ...company, features: { eDocs: false } } });
        expect(screen.queryByRole('heading', { level: 1, name: 'Documents' })).not.toBeInTheDocument();
    });
});
