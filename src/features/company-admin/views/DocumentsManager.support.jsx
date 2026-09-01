// Focused coverage for the Documents workspace shell: the page header and its
// two actions, the four-view tab interface (roles, ARIA relationships, roving
// tabIndex, keyboard navigation), the New Document choices and the exact props
// each view receives. The individual panels, the history table, the send flow
// and the Firebase operations are stubbed so the shell can be asserted in
// isolation; all fixtures are artificial.
//
// =====================================================================
// Shared harness for the DocumentsManager suites.
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below; the module
// registry hands every caller this same instance, so the recorded props and
// spies a suite imports are the ones the view talks to. This module does NOT
// import the view — a static import here would evaluate the view while the
// suite's mock factories are still awaiting this module — so each suite
// imports the view itself, after its own hoisted mocks, and passes it to
// `makeRenderManager`. For the same reason this module must not import ANY
// module the suites mock: importing `react-router-dom` here deadlocked
// vitest silently, because loading this module fired that mock's factory,
// which was awaiting this module. The suites import `MemoryRouter`
// themselves and pass it alongside the view.
// =====================================================================

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

export const useDataMock = vi.fn();
export const navigateMock = vi.fn();
// Records the props each child is mounted with, so the frozen child contracts
// can be asserted without reaching into any child's internals.
export const creatorProps = { current: null };
export const overviewProps = { current: null };
export const sentProps = { current: null };
export const libraryProps = { current: null };
export const formsProps = { current: null };
export const firestoreMocks = {
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    addDoc: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn() })),
    getDocs: vi.fn(async () => ({ docs: [] })),
};
export const functionsMocks = { getFunctions: vi.fn(() => ({})), httpsCallable: vi.fn(() => vi.fn()) };
export const signingRequestsMock = {
    current: { documents: [], isLoading: false, loadError: null, retry: vi.fn() },
};

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const dataContextMock = () => ({ useData: () => useDataMock() });
export const reactRouterMock = async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => navigateMock,
});
export const libFirebaseMock = () => ({ db: {}, auth: { currentUser: { uid: 'user-1' } } });
export const firebaseFunctionsMock = () => functionsMocks;
export const firebaseFirestoreMock = () => ({
    collection: vi.fn(() => ({})),
    query: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    onSnapshot: vi.fn(() => () => {}),
    doc: vi.fn(() => ({})),
    Timestamp: { fromMillis: vi.fn(() => ({})) },
    serverTimestamp: vi.fn(() => '__ts__'),
    ...firestoreMocks,
});
export const useSigningRequestsMock = () => ({
    useSigningRequests: () => signingRequestsMock.current,
});
export const envelopeCreatorMock = () => ({
    default: (props) => {
        creatorProps.current = props;
        return <div data-testid="envelope-creator">Envelope Creator</div>;
    },
});
export const documentsOverviewMock = () => ({
    DocumentsOverview: (props) => {
        overviewProps.current = props;
        return <div data-testid="documents-overview">Overview</div>;
    },
});
export const sentDocumentsPanelMock = () => ({
    SentDocumentsPanel: (props) => {
        sentProps.current = props;
        return <div data-testid="sent-documents">Sent</div>;
    },
});
export const templateLibraryPanelMock = () => ({
    TemplateLibraryPanel: (props) => {
        libraryProps.current = props;
        return <div data-testid="template-library">Templates</div>;
    },
});
export const applicationFormsPanelMock = () => ({
    ApplicationFormsPanel: (props) => {
        formsProps.current = props;
        return <div data-testid="application-forms">Forms</div>;
    },
});
export const sendTemplateWizardMock = () => ({
    SendTemplateWizard: () => <div data-testid="send-template-wizard">Send</div>,
});
export const feedbackMock = () => ({
    GlobalLoadingState: () => <div>Loading…</div>,
    useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
});

// --- fixtures and helpers, verbatim ----------------------------------------

export const company = { id: 'company-1', companyName: 'Artificial Freight Co', features: { eDocs: true } };

/**
 * The original `renderManager`, verbatim, except the view and `MemoryRouter`
 * arrive as arguments: each suite imports both after its own hoisted mocks.
 */
export function makeRenderManager(DocumentsManager, MemoryRouter) {
    return function renderManager({ currentCompanyProfile = company, loading = false } = {}) {
        useDataMock.mockReturnValue({ currentCompanyProfile, loading });
        return render(
            <MemoryRouter initialEntries={['/company/e-docs']}>
                <DocumentsManager />
            </MemoryRouter>,
        );
    };
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    creatorProps.current = null;
    overviewProps.current = null;
    sentProps.current = null;
    libraryProps.current = null;
    formsProps.current = null;
    signingRequestsMock.current = { documents: [], isLoading: false, loadError: null, retry: vi.fn() };
}

export function tabs() {
    return {
        overview: screen.getByRole('tab', { name: /^Overview/ }),
        sent: screen.getByRole('tab', { name: /^Sent Documents/ }),
        templates: screen.getByRole('tab', { name: /^Templates/ }),
        forms: screen.getByRole('tab', { name: /^Application Forms/ }),
    };
}

export const openNewDocument = () => fireEvent.click(screen.getByRole('button', { name: 'New Document' }));
