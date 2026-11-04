// The applicant's consents on the DQ row of the preserved original application.
//
// Rendered through `DQFileTab` with the shared DossierBodies harness, so what
// is proved is the row a recruiter sees: each consent the frozen submission
// record holds, with its own recorded answer, read from
// `applications/{id}/submission/{snapshotId}` only when asked for, and once.
// The presenter is the real one; only Firestore is faked.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./DossierBodies.contract.support')).libFirebaseMock());
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/firestore', async () => (await import('./DossierBodies.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./DossierBodies.contract.support')).firebaseStorageMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./DossierBodies.contract.support')).activityLoggerMock());
vi.mock('@features/applications/services/applicationPdfService', async () => (await import('./DossierBodies.contract.support')).applicationPdfServiceMock());
vi.mock('@features/auth/services/userService', async () => (await import('./DossierBodies.contract.support')).userServiceMock());
vi.mock('./dqFileSync', async () => (await import('./DossierBodies.contract.support')).dqFileSyncMock());
vi.mock('@features/applications/services/applicationFileLink', async () => (await import('./DossierBodies.contract.support')).applicationFileLinkMock());

import { DQFileTab } from './DQFileTab';
import { OriginalApplicationConsents } from './OriginalApplicationConsents';
import {
    makeRenderDq,
    resetHarness,
    snap,
    DQ_FILE,
    fs,
    downloadPreserved,
} from './DossierBodies.contract.support';

const renderDq = makeRenderDq(DQFileTab);

/** The DQ record `preserveApplicationPdf` writes for the original. */
const PRESERVED = {
    fileType: 'Application for Employment',
    fileName: 'Driver-Application-Marcus-Delgado-2026-07-14.pdf',
    url: null,
    storagePath: 'application_originals/co-1/app-1/v1.pdf',
    requiresAuditedAccess: true,
    snapshotId: 'v1',
};

/** One agreement as `submissionSnapshot.js` freezes it. */
const agreement = (over = {}) => ({
    id: 'clearinghouseConsent',
    version: 'v3',
    title: 'FMCSA CLEARINGHOUSE LIMITED QUERY CONSENT',
    body: 'I hereby provide consent to Artificial Freight Co ...',
    legacyWording: false,
    accepted: true,
    acceptedAt: '2026-07-14T15:22:41.000Z',
    acceptanceScope: 'individual',
    evidenceRecorded: true,
    signature: { type: 'drawn', capturedAt: '2026-07-14T15:22:00.000Z', present: true },
    ...over,
});

const SNAPSHOT = {
    frozen: true,
    sections: [],
    agreements: [
        agreement(),
        agreement({
            id: 'pspDisclosure',
            title: 'FMCSA PSP DISCLOSURE AND AUTHORIZATION',
            accepted: false,
            acceptedAt: null,
            acceptanceScope: null,
            evidenceRecorded: true,
            signature: null,
        }),
        agreement({
            id: 'fcraAuthorization',
            title: 'FCRA AUTHORIZATION',
            version: 'legacy-1',
            legacyWording: true,
            acceptanceScope: 'combined',
            signature: null,
        }),
    ],
};

const record = (data) => ({ exists: () => data !== null, data: () => data });

const showConsents = () => screen.getByRole('button', { name: /^Show consents/ });

/** Renders the DQ tab with the preserved original listed, and waits for its row. */
async function renderPreservedRow() {
    fs.getDocs.mockResolvedValue(snap([['application-pdf-v1', PRESERVED]]));
    const view = renderDq();
    await screen.findByRole('button', { name: /^Download Application for Employment/ });
    return view;
}

beforeEach(() => {
    resetHarness();
    fs.getDoc.mockResolvedValue(record(SNAPSHOT));
});

describe('DQFileTab — the consents on the preserved original', () => {
    it('lists each consent with its own recorded answer, read only when asked for', async () => {
        await renderPreservedRow();

        // Nothing is read when the tab opens; the toggle names its file.
        expect(fs.getDoc).not.toHaveBeenCalled();
        expect(showConsents()).toHaveAttribute('aria-expanded', 'false');
        expect(showConsents()).toHaveAccessibleName(`Show consents in ${PRESERVED.fileName}`);

        fireEvent.click(showConsents());

        const list = await screen.findByRole('list', { name: 'Consents in this submission' });
        expect(fs.getDoc).toHaveBeenCalledWith({
            kind: 'doc',
            path: 'companies/co-1/applications/app-1/submission/v1',
        });
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByText('FMCSA CLEARINGHOUSE LIMITED QUERY CONSENT')).toBeInTheDocument();
        expect(within(rows[0]).getByText('Accepted and signed by the applicant')).toBeInTheDocument();
        expect(within(rows[0]).getByText(/Signed electronically \(drawn\)/)).toBeInTheDocument();
        expect(within(rows[1]).getByText('The applicant did not accept this agreement')).toBeInTheDocument();
        expect(within(rows[1]).queryByText(/Signed electronically/)).toBeNull();
        expect(within(rows[2]).getByText('Certified as part of a single combined acknowledgement')).toBeInTheDocument();
        expect(within(rows[2]).getByText(/Wording in force at the time/)).toBeInTheDocument();
        // The full wording stays in the PDF; the row lists the answers.
        expect(screen.queryByText(/I hereby provide consent/)).toBeNull();

        const hide = screen.getByRole('button', { name: /^Hide consents/ });
        expect(hide).toHaveAttribute('aria-expanded', 'true');
        expect(hide).toHaveAttribute('aria-controls', list.closest('[id]').id);
    });

    it('reads the record once, however often the list is opened', async () => {
        await renderPreservedRow();

        fireEvent.click(showConsents());
        await screen.findByRole('list', { name: 'Consents in this submission' });
        fireEvent.click(screen.getByRole('button', { name: /^Hide consents/ }));
        expect(screen.queryByRole('list', { name: 'Consents in this submission' })).toBeNull();
        fireEvent.click(showConsents());

        expect(screen.getByRole('list', { name: 'Consents in this submission' })).toBeInTheDocument();
        expect(fs.getDoc).toHaveBeenCalledTimes(1);
    });

    it('keeps the PDF on the audited download and adds no other way to it', async () => {
        await renderPreservedRow();
        fireEvent.click(showConsents());
        await screen.findByRole('list', { name: 'Consents in this submission' });

        expect(screen.queryAllByRole('link')).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: /^Download Application for Employment/ }));
        await waitFor(() => expect(downloadPreserved).toHaveBeenCalledWith({
            companyId: 'co-1',
            applicationId: 'app-1',
            snapshotId: 'v1',
        }));
    });

    it('says so while it reads', async () => {
        let finish;
        fs.getDoc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        await renderPreservedRow();

        fireEvent.click(showConsents());
        expect(screen.getByText('Loading consents…')).toBeInTheDocument();

        finish(record(SNAPSHOT));
        expect(await screen.findByRole('list', { name: 'Consents in this submission' })).toBeInTheDocument();
        expect(screen.queryByText('Loading consents…')).toBeNull();
    });

    it('says calmly when the record cannot be read, and reads it again on reopening', async () => {
        fs.getDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        await renderPreservedRow();

        fireEvent.click(showConsents());
        expect(await screen.findByText('The consents could not be loaded. Hide them and show them again to try once more.'))
            .toBeInTheDocument();
        // The tab's own error region stays for the tab's own failures.
        expect(screen.queryByRole('alert')).toBeEmptyDOMElement();

        fs.getDoc.mockResolvedValue(record(SNAPSHOT));
        fireEvent.click(screen.getByRole('button', { name: /^Hide consents/ }));
        fireEvent.click(showConsents());

        expect(await screen.findByRole('list', { name: 'Consents in this submission' })).toBeInTheDocument();
        expect(fs.getDoc).toHaveBeenCalledTimes(2);
    });

    it('says so when the submission record is not there', async () => {
        fs.getDoc.mockResolvedValue(record(null));
        await renderPreservedRow();

        fireEvent.click(showConsents());
        expect(await screen.findByText(
            "This submission's record could not be found, so its consents cannot be listed here.",
        )).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Consents in this submission' })).toBeNull();
    });

    it('says so when the submission recorded no consents', async () => {
        fs.getDoc.mockResolvedValue(record({ ...SNAPSHOT, agreements: [] }));
        await renderPreservedRow();

        fireEvent.click(showConsents());
        expect(await screen.findByText('No consents were recorded with this submission.')).toBeInTheDocument();
    });

    it('offers nothing on any other DQ row', async () => {
        fs.getDocs.mockResolvedValue(snap([
            ['dq-1', DQ_FILE],
            // Defensive: an original whose record names no snapshot has nothing to read.
            ['application-pdf-x', { ...PRESERVED, fileName: 'no-snapshot.pdf', snapshotId: undefined }],
        ]));
        renderDq();

        await screen.findByRole('link', { name: /^Download Medical Card/ });
        expect(screen.queryByRole('button', { name: /Show consents/ })).toBeNull();
        expect(fs.getDoc).not.toHaveBeenCalled();
    });

    it('has no jsdom axe violations with the consents listed', async () => {
        const { container } = await renderPreservedRow();
        fireEvent.click(showConsents());
        await screen.findByRole('list', { name: 'Consents in this submission' });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('OriginalApplicationConsents — one record at a time', () => {
    it("never shows one application's consents under another's", async () => {
        const { rerender } = render(
            <OriginalApplicationConsents companyId="co-1" applicationId="app-1" file={PRESERVED} />,
        );
        fireEvent.click(showConsents());
        await screen.findByText('FMCSA CLEARINGHOUSE LIMITED QUERY CONSENT');

        // The same DQ record id (`application-pdf-v1`) under the next driver.
        rerender(<OriginalApplicationConsents companyId="co-1" applicationId="app-2" file={PRESERVED} />);

        expect(screen.queryByText('FMCSA CLEARINGHOUSE LIMITED QUERY CONSENT')).toBeNull();
        expect(showConsents()).toHaveAttribute('aria-expanded', 'false');

        fs.getDoc.mockResolvedValue(record({ ...SNAPSHOT, agreements: [agreement({ title: 'SECOND DRIVER CONSENT' })] }));
        fireEvent.click(showConsents());
        expect(await screen.findByText('SECOND DRIVER CONSENT')).toBeInTheDocument();
        expect(fs.getDoc).toHaveBeenLastCalledWith({
            kind: 'doc',
            path: 'companies/co-1/applications/app-2/submission/v1',
        });
    });

    it("drops a read that answers after the record changed, while the next one's is loading", async () => {
        const reads = [];
        fs.getDoc.mockImplementation(() => new Promise((resolve) => { reads.push(resolve); }));
        const { rerender } = render(
            <OriginalApplicationConsents companyId="co-1" applicationId="app-1" file={PRESERVED} />,
        );
        fireEvent.click(showConsents());
        rerender(<OriginalApplicationConsents companyId="co-1" applicationId="app-2" file={PRESERVED} />);
        fireEvent.click(showConsents());
        expect(reads).toHaveLength(2);

        // The first driver's record answers while the second driver's is read.
        reads[0](record(SNAPSHOT));
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(screen.queryByText('FMCSA CLEARINGHOUSE LIMITED QUERY CONSENT')).toBeNull();
        expect(screen.getByText('Loading consents…')).toBeInTheDocument();

        reads[1](record({ ...SNAPSHOT, agreements: [agreement({ title: 'SECOND DRIVER CONSENT' })] }));
        expect(await screen.findByText('SECOND DRIVER CONSENT')).toBeInTheDocument();
    });
});
