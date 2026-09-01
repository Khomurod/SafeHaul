// AI Field Assistant scan orchestration: scope resolution, progress,
// cancellation, stale-response rejection, hybrid precedence and editing.
//
// The AI provider is never reached: `analyzeEdocFieldPlacement` is a vitest
// mock and PDF.js is replaced with stubs. Every page, field and label is
// artificial.
//
// =====================================================================
// Shared harness for the useAiFieldAssistant suites. `vi.mock` is hoisted
// per file, so each suite keeps its own registrations, whose factories
// delegate to the `*Mock()` functions below. This module must not import
// the hook or any mocked module — the hook imports the mocked
// firebase/functions, and loading either here fires a mock factory that is
// itself awaiting this module, which deadlocks vitest silently (learned on
// `CA-3`). Each suite imports the hook itself and passes it to `makeSetup`.
// =====================================================================
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';

export const callable = vi.fn();
export const pdfMocks = {
    loadPdfDocument: vi.fn(),
    renderPageToDataUrl: vi.fn(),
    inspectPdfDocument: vi.fn(),
};

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const firebaseFunctionsMock = () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => callable),
});
export const pdfPageRasterizerMock = () => ({
    loadPdfDocument: (...args) => pdfMocks.loadPdfDocument(...args),
    renderPageToDataUrl: (...args) => pdfMocks.renderPageToDataUrl(...args),
});
export const pdfFieldInspectorMock = async (importOriginal) => ({
    ...(await importOriginal()),
    inspectPdfDocument: (...args) => pdfMocks.inspectPdfDocument(...args),
});

// --- fixtures and helpers, verbatim ----------------------------------------

export const FILE = { name: 'artificial.pdf' };

export const visionSuggestion = (overrides = {}) => ({
    page: 1,
    category: 'signature',
    type: 'signature',
    bindingKey: '',
    label: 'Sign here',
    required: true,
    confidence: 0.9,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    ...overrides,
});

/**
 * The original `setup`, verbatim, except the hook arrives as an argument:
 * each suite imports it after its own hoisted mocks.
 */
export const makeSetup = (useAiFieldAssistant) => (overrides = {}) =>
    renderHook((props) => useAiFieldAssistant(props), {
        initialProps: {
            companyId: 'co-1',
            file: FILE,
            numPages: 3,
            activePage: 2,
            fields: [],
            ...overrides,
        },
    });

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    pdfMocks.loadPdfDocument.mockResolvedValue({ destroy: vi.fn() });
    pdfMocks.inspectPdfDocument.mockResolvedValue({
        rawSuggestions: [],
        manualReview: [],
        pagesWithText: [],
    });
    pdfMocks.renderPageToDataUrl.mockResolvedValue('data:image/jpeg;base64,AAA');
    callable.mockResolvedValue({ data: { suggestions: [], manualReview: [] } });
}
