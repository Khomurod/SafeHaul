// Focused coverage for the Documents workspace shell: the page header and its
// two actions, the four-view tab interface (roles, ARIA relationships, roving
// tabIndex, keyboard navigation), the New Document choices and the exact props
// each view receives. The individual panels, the history table, the send flow
// and the Firebase operations are stubbed so the shell can be asserted in
// isolation; all fixtures are artificial.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const useDataMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
// Records the props each child is mounted with, so the frozen child contracts
// can be asserted without reaching into any child's internals.
const creatorProps = vi.hoisted(() => ({ current: null }));
const overviewProps = vi.hoisted(() => ({ current: null }));
const sentProps = vi.hoisted(() => ({ current: null }));
const libraryProps = vi.hoisted(() => ({ current: null }));
const formsProps = vi.hoisted(() => ({ current: null }));
const firestoreMocks = vi.hoisted(() => ({
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    addDoc: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn() })),
    getDocs: vi.fn(async () => ({ docs: [] })),
}));
const functionsMocks = vi.hoisted(() => ({ getFunctions: vi.fn(() => ({})), httpsCallable: vi.fn(() => vi.fn()) }));
const signingRequestsMock = vi.hoisted(() => ({
    current: { documents: [], isLoading: false, loadError: null, retry: vi.fn() },
}));

vi.mock('@/context/DataContext', () => ({ useData: () => useDataMock() }));
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => navigateMock,
}));
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'user-1' } } }));
vi.mock('firebase/functions', () => functionsMocks);
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => ({})),
    query: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    onSnapshot: vi.fn(() => () => {}),
    doc: vi.fn(() => ({})),
    Timestamp: { fromMillis: vi.fn(() => ({})) },
    serverTimestamp: vi.fn(() => '__ts__'),
    ...firestoreMocks,
}));
vi.mock('@features/signing/hooks/useSigningRequests', () => ({
    useSigningRequests: () => signingRequestsMock.current,
}));
vi.mock('@features/signing/EnvelopeCreator', () => ({
    default: (props) => {
        creatorProps.current = props;
        return <div data-testid="envelope-creator">Envelope Creator</div>;
    },
}));
vi.mock('../components/documents/DocumentsOverview', () => ({
    DocumentsOverview: (props) => {
        overviewProps.current = props;
        return <div data-testid="documents-overview">Overview</div>;
    },
}));
vi.mock('../components/documents/SentDocumentsPanel', () => ({
    SentDocumentsPanel: (props) => {
        sentProps.current = props;
        return <div data-testid="sent-documents">Sent</div>;
    },
}));
vi.mock('../components/documents/TemplateLibraryPanel', () => ({
    TemplateLibraryPanel: (props) => {
        libraryProps.current = props;
        return <div data-testid="template-library">Templates</div>;
    },
}));
vi.mock('../components/documents/ApplicationFormsPanel', () => ({
    ApplicationFormsPanel: (props) => {
        formsProps.current = props;
        return <div data-testid="application-forms">Forms</div>;
    },
}));
vi.mock('../components/documents/SendTemplateWizard', () => ({
    SendTemplateWizard: () => <div data-testid="send-template-wizard">Send</div>,
}));
vi.mock('@shared/components/feedback', () => ({
    GlobalLoadingState: () => <div>Loading…</div>,
    useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

import DocumentsManager from './DocumentsManager';

const company = { id: 'company-1', companyName: 'Artificial Freight Co', features: { eDocs: true } };

function renderManager({ currentCompanyProfile = company, loading = false } = {}) {
    useDataMock.mockReturnValue({ currentCompanyProfile, loading });
    return render(
        <MemoryRouter initialEntries={['/company/e-docs']}>
            <DocumentsManager />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    creatorProps.current = null;
    overviewProps.current = null;
    sentProps.current = null;
    libraryProps.current = null;
    formsProps.current = null;
    signingRequestsMock.current = { documents: [], isLoading: false, loadError: null, retry: vi.fn() };
});

function tabs() {
    return {
        overview: screen.getByRole('tab', { name: /^Overview/ }),
        sent: screen.getByRole('tab', { name: /^Sent Documents/ }),
        templates: screen.getByRole('tab', { name: /^Templates/ }),
        forms: screen.getByRole('tab', { name: /^Application Forms/ }),
    };
}

const openNewDocument = () => fireEvent.click(screen.getByRole('button', { name: 'New Document' }));

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

    it('exposes a labelled tablist with connected tabs and panel', () => {
        renderManager();
        expect(screen.getByRole('tablist', { name: 'Documents workspace views' })).toBeInTheDocument();

        const panel = screen.getByRole('tabpanel');
        const all = tabs();
        for (const tab of Object.values(all)) {
            expect(tab).toHaveAttribute('aria-controls', panel.id);
            expect(tab.id).toBeTruthy();
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

    it('states the selected tab with text as well as colour', () => {
        renderManager();
        expect(tabs().overview).toHaveTextContent('(selected)');
        expect(tabs().sent).not.toHaveTextContent('(selected)');
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

describe('DocumentsManager gating', () => {
    it('locks the workspace when E-Docs is disabled for the company', () => {
        renderManager({ currentCompanyProfile: { ...company, features: { eDocs: false } } });
        expect(screen.queryByRole('heading', { level: 1, name: 'Documents' })).not.toBeInTheDocument();
    });
});
