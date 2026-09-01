// PRIVACY: recipient names, emails, phone numbers, signing links and document
// URLs are sensitive. Every fixture below is artificial — reserved example
// domains (RFC 2606) and fictional 555-01xx numbers (NANP reserved range). No
// real signing link or document URL is ever asserted, logged or snapshotted.
//
// =====================================================================
// Shared harness for the EnvelopeHistory suites.
//
// `vi.mock` is hoisted per file, so each suite keeps its own registrations,
// whose factories delegate to the `*Mock()` functions below. This module must
// not import `EnvelopeHistory` or any module the suites mock — the component
// transitively imports the mocked firebase modules, and loading either here
// fires a mock factory that is itself awaiting this module, which deadlocks
// vitest silently (learned on `CA-3`). Each suite imports the component and
// passes it to `makeRenderHistory`. `unsubSpy` is an ESM live binding so the
// subscription tests read the spy `resetHarness` installed for that test.
// =====================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

export const fs = {
    collection: vi.fn((_db, ...segments) => ({ __path: segments.join('/') })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    orderBy: vi.fn((field, dir) => ({ __orderBy: [field, dir] })),
    onSnapshot: vi.fn(),
    doc: vi.fn((_db, ...segments) => ({ __docPath: segments.join('/') })),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
};
export const callables = { getSigningLink: vi.fn(), getSignedDocumentUrl: vi.fn() };
export const fnMocks = {
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn((_fns, name) => callables[name]),
};
export const toast = { showSuccess: vi.fn(), showError: vi.fn() };

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const firebaseFirestoreMock = () => fs;
export const firebaseFunctionsMock = () => fnMocks;
export const libFirebaseMock = () => ({ db: {} });
export const feedbackMock = () => ({ useToast: () => toast });

// --- fixtures and helpers, verbatim ----------------------------------------

let snapshotCb;
let errorCb;
export let unsubSpy;

export const SIGNING_LINK = 'https://sign.example.test/artificial-token';
export const DOC_URL = 'https://files.example.test/artificial-signed.pdf';

export function makeDoc(overrides = {}) {
    return {
        id: 'req-1',
        title: 'Offer Letter',
        recipientName: 'Pat Example',
        recipientEmail: 'pat@example.test',
        status: 'sent',
        sendEmail: true,
        createdAt: { seconds: 1700000000 },
        ...overrides,
    };
}

// Snapshot callbacks originate outside React, so they must be flushed in act().
export function emit(docsArray) {
    React.act(() => {
        snapshotCb({
            docs: docsArray.map((d) => ({
                id: d.id,
                // Firestore's data() excludes the document id.
                data: () => Object.fromEntries(Object.entries(d).filter(([key]) => key !== 'id')),
            })),
        });
    });
}

export function emitError(err) {
    React.act(() => { errorCb(err); });
}

export const makeRenderHistory = (EnvelopeHistory) => (props = {}) => {
    const onCorrect = props.onCorrect;
    // `companyId` is only omitted when the key is explicitly absent, so a test
    // can pass `companyId: undefined` to exercise the no-subscription guard.
    const companyId = 'companyId' in props ? props.companyId : 'co-1';
    const utils = render(<EnvelopeHistory companyId={companyId} onCorrect={onCorrect} />);
    return { onCorrect, ...utils };
};

/** Activates a row (the generic details action) and returns its details dialog. */
export async function openDetails(rowName = 'Details for Offer Letter') {
    fireEvent.click(screen.getByRole('row', { name: rowName }));
    return screen.findByRole('dialog');
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    unsubSpy = vi.fn();
    snapshotCb = undefined;
    errorCb = undefined;
    fs.onSnapshot.mockImplementation((q, onNext, onError) => {
        snapshotCb = onNext;
        errorCb = onError;
        return unsubSpy;
    });
    callables.getSigningLink.mockResolvedValue({ data: { signingLink: SIGNING_LINK } });
    callables.getSignedDocumentUrl.mockResolvedValue({ data: { url: DOC_URL } });
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue() },
    });
}

/** The original suite's `afterEach` body, verbatim. */
export function restoreHarness() {
    vi.unstubAllGlobals();
}
