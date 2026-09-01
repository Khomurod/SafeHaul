/**
 * Contract freeze + a11y proof for the three dossier tab bodies migrated on
 * 2026-07-28: `DQFileTab`, `ActivityHistoryTab` and `NotesTab`.
 *
 * All three were deliberately left unmigrated by the 2026-07-27 dossier
 * foundation slice ("DQ, PEV/VOE, Activity and Notes bodies are deliberately not
 * migrated") and recorded as residual debt since. PEV/VOE was closed separately.
 *
 * These bodies own DOT-compliance data, so the paths, payloads and audit-log
 * calls are frozen here before any presentation change:
 *
 *  - DQ: the `dq_files` sub-collection path and ordering, the Storage path
 *    (including its deliberate `applications` segment for leads), the upload
 *    document shape, both `logActivity` calls and their exact detail strings, the
 *    delete-Storage-then-Firestore order, and the expiration thresholds.
 *  - Activity: the `leads`/`applications` collection normalisation, the
 *    `activity_logs` path and ordering, the five filter rules, and the
 *    Today/Yesterday/Recent grouping.
 *  - Notes: the `internal_notes` path, the `sharedHistory` anonymisation,
 *    `sanitizeUserContent` on read and write, the merge-and-sort rule, the written
 *    note shape and the `logActivity` truncation rule.
 *
 * All names, file names and ids below are artificial test fixtures.
 *
 * =====================================================================
 * Shared harness for the DossierBodies contract suites.
 *
 * `vi.mock` is hoisted per file, so each suite keeps its own registrations,
 * whose factories delegate to the `*Mock()` functions below. This module must
 * not import the tab components OR any module the suites mock — the tabs
 * transitively import the mocked firebase modules, and loading either here
 * fires a mock factory that is itself awaiting this module, which deadlocks
 * vitest silently (learned on `CA-3`). Each suite imports the tabs it renders
 * and passes them to the `makeRender*` factories.
 * =====================================================================
 */
import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

export const fs = {
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
};
export const storageMocks = {
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(),
    ref: vi.fn((_s, path) => ({ path })),
};
export const logActivity = vi.fn();
export const getPortalUser = vi.fn();
export const downloadPreserved = vi.fn();

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const libFirebaseMock = () => ({ db: {}, storage: {}, auth: { currentUser: { uid: 'user-1' } } });
export const firebaseFirestoreMock = () => ({
    // The real `collection()` accepts either `(db, ...pathSegments)` — used by
    // ActivityHistoryTab and NotesTab — or `(parentDocRef, name)`, used by
    // DQFileTab. Both forms resolve to the same `{ parent.path, name }` shape here.
    collection: (first, ...rest) => (first?.kind === 'doc'
        ? { kind: 'collection', parent: first, name: rest[0] }
        : { kind: 'collection', parent: { path: rest.slice(0, -1).join('/') }, name: rest[rest.length - 1] }),
    doc: (a, ...rest) => (a?.kind === 'collection'
        ? { kind: 'doc', in: a, id: rest[0] }
        : { kind: 'doc', path: rest.join('/') }),
    query: (ref, ...clauses) => ({ ref, clauses }),
    orderBy: (field, dir) => ({ field, dir }),
    getDocs: (...a) => fs.getDocs(...a),
    getDoc: (...a) => fs.getDoc(...a),
    addDoc: (...a) => fs.addDoc(...a),
    deleteDoc: (...a) => fs.deleteDoc(...a),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
});
export const firebaseStorageMock = () => ({
    ref: (...a) => storageMocks.ref(...a),
    uploadBytes: (...a) => storageMocks.uploadBytes(...a),
    getDownloadURL: (...a) => storageMocks.getDownloadURL(...a),
    deleteObject: (...a) => storageMocks.deleteObject(...a),
});
export const activityLoggerMock = () => ({ logActivity: (...a) => logActivity(...a) });
export const applicationPdfServiceMock = () => ({
    NoPreservedPdfError: class NoPreservedPdfError extends Error {},
    downloadPreservedApplicationPdf: (...a) => downloadPreserved(...a),
});
export const userServiceMock = () => ({ getPortalUser: (...a) => getPortalUser(...a) });

// --- helpers and fixtures, verbatim ----------------------------------------

export function snap(docs) {
    return { docs: docs.map(([id, data]) => ({ id, data: () => data })) };
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    vi.clearAllMocks();
    fs.getDocs.mockResolvedValue(snap([]));
    fs.getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    fs.addDoc.mockResolvedValue({ id: 'new-1' });
    fs.deleteDoc.mockResolvedValue(undefined);
    storageMocks.uploadBytes.mockResolvedValue(undefined);
    storageMocks.getDownloadURL.mockResolvedValue('https://example.test/signed');
    storageMocks.deleteObject.mockResolvedValue(undefined);
    logActivity.mockResolvedValue(undefined);
    getPortalUser.mockResolvedValue({ name: 'Test Recruiter' });
    downloadPreserved.mockResolvedValue({ url: 'https://signed.test/original.pdf' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
}

// ---------------------------------------------------------------- DQFileTab

export const DQ_FILE = {
    fileType: 'Medical Card',
    fileName: 'medcard.pdf',
    url: 'https://example.test/medcard.pdf',
    storagePath: 'companies/co-1/applications/app-1/dq_files/Medical_Card_medcard.pdf',
};

export const makeRenderDq = (DQFileTab) => (props = {}) =>
    render(<DQFileTab companyId="co-1" applicationId="app-1" {...props} />);

// -------------------------------------------------------- ActivityHistoryTab

export function tsDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return { seconds: Math.floor(d.getTime() / 1000) };
}

export const LOGS = [
    ['l1', { action: 'Call logged', type: 'call', timestamp: tsDaysAgo(0), performedByName: 'Test Recruiter', duration: 42, outcomeLabel: 'Connected' }],
    ['l2', { action: 'Note Added', type: 'note', timestamp: tsDaysAgo(1), details: 'Left a voicemail' }],
    ['l3', { action: 'Status changed to Rejected', timestamp: tsDaysAgo(9) }],
    ['l4', { action: 'Document uploaded', type: 'upload' }],
];

export const makeRenderActivity = (ActivityHistoryTab) => (props = {}) =>
    render(<ActivityHistoryTab companyId="co-1" applicationId="app-1" collectionName="applications" {...props} />);

// ----------------------------------------------------------------- NotesTab

export const makeRenderNotes = (NotesTab) => (props = {}) =>
    render(<NotesTab companyId="co-1" applicationId="app-1" {...props} />);
