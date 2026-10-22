// The VOE document prints the release naming this employer, when the applicant
// accepted one, exactly as the request PDF does: the frozen document and the one
// statement for this employer, under the signature it was accepted with.
import React from 'react';
import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (...parts) => parts.slice(1).join('/'), getDoc: (...args) => mocks.getDoc(...args) }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@/context/DataContext', async () => (await import('./VOEPreviewModal.contract.support')).dataContextMock());
vi.mock('@shared/utils/sanitizeUserContent', async (importOriginal) => (await import('./VOEPreviewModal.contract.support')).sanitizeUserContentMock(importOriginal));
vi.mock('html2canvas', async () => (await import('./VOEPreviewModal.contract.support')).html2canvasMock());
vi.mock('jspdf', async () => (await import('./VOEPreviewModal.contract.support')).jspdfMock());

import { VOEPreviewModal } from './VOEPreviewModal';
import { RELEASE_PARAGRAPHS } from '@shared/legal/previousEmployerRelease';
import { makeRenderModal, resetHarness, documentNode, dataMock, APPLICANT } from './VOEPreviewModal.contract.support';

const require = createRequire(import.meta.url);
const { buildApplicationDefinition } = require('../../../../../functions/shared/applicationDefinition.js');
const { buildSubmissionSnapshot } = require('../../../../../functions/shared/submissionSnapshot.js');

const renderModal = makeRenderModal(VOEPreviewModal);
const STATEMENT = '2. I authorize Acme Freight to release to Northwind Carriers the information described above.';

/** The record a submission naming two employers, accepting the release with `signature`, holds. */
function recordSignedWith(signature) {
    const employers = [{ companyName: 'First Lines' }, { companyName: 'Acme Freight' }];
    return buildSubmissionSnapshot({
        definition: buildApplicationDefinition({ company: { companyName: 'Northwind Carriers' } }),
        formData: { employers },
        acceptances: { previousEmployerRelease: { accepted: true, version: 'v3', employersShown: ['First Lines', 'Acme Freight'] } },
        signature: { image: signature, type: 'drawn' },
    });
}
const found = (data) => ({ exists: () => true, data: () => data });
const APPLICANT_ON_FILE = { ...APPLICANT, signatureDate: '2026-09-01T15:00:00Z', submissionRecord: { snapshotId: 'v1' } };
const printButton = () => screen.getByRole('button', { name: /Print/ });

beforeEach(() => {
    resetHarness();
    dataMock.value = { currentCompanyProfile: { id: 'co-1', name: 'Northwind Carriers' } };
    mocks.getDoc.mockReset();
});
afterEach(cleanup);

describe('the VOE release naming this employer', () => {
    it("prints the frozen document and this employer's statement, and no other employer", async () => {
        mocks.getDoc.mockResolvedValue(found(recordSignedWith(APPLICANT.signature)));
        renderModal({ applicant: APPLICANT_ON_FILE });

        const named = await screen.findByTestId('voe-employer-release');
        expect(mocks.getDoc).toHaveBeenCalledWith('companies/co-1/applications/app-abc123/submission/v1');
        expect(named).toHaveTextContent(STATEMENT);
        expect(named).toHaveTextContent('AUTHORIZATION FOR PREVIOUS EMPLOYERS TO RELEASE INFORMATION');
        expect(documentNode()).not.toHaveTextContent('First Lines');
        expect(documentNode()).toHaveTextContent("Applicant's Authorization (Signed With the Application)");
        expect(documentNode()).not.toHaveTextContent(RELEASE_PARAGRAPHS[0].slice(0, 60));
        expect(within(documentNode()).getByAltText('Signature')).toBeInTheDocument();
        expect(printButton()).toBeEnabled();
    });

    it('prints the certification release when the signature on file is not the one it was accepted with', async () => {
        mocks.getDoc.mockResolvedValue(found(recordSignedWith('TEXT_SIGNATURE:Someone Else')));
        renderModal({ applicant: APPLICANT_ON_FILE });

        await waitFor(() => expect(printButton()).toBeEnabled());
        expect(screen.queryByTestId('voe-employer-release')).toBeNull();
        expect(documentNode()).toHaveTextContent(RELEASE_PARAGRAPHS[0].slice(0, 60));
    });

    it('prints the certification release when the record cannot be read', async () => {
        mocks.getDoc.mockRejectedValue(new Error('permission-denied'));
        renderModal({ applicant: APPLICANT_ON_FILE });

        await waitFor(() => expect(printButton()).toBeEnabled());
        expect(screen.queryByTestId('voe-employer-release')).toBeNull();
        expect(documentNode()).toHaveTextContent(RELEASE_PARAGRAPHS[0].slice(0, 60));
    });

    it('holds Print and Download until the record answers', async () => {
        let answer;
        mocks.getDoc.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        renderModal({ applicant: APPLICANT_ON_FILE });

        expect(printButton()).toBeDisabled();
        expect(screen.getByRole('button', { name: /Download PDF/ })).toBeDisabled();
        await act(async () => answer(found(recordSignedWith(APPLICANT.signature))));
        await waitFor(() => expect(printButton()).toBeEnabled());
        expect(screen.getByTestId('voe-employer-release')).toHaveTextContent(STATEMENT);
    });

    it('reads nothing for an application that points at no record', () => {
        renderModal();
        expect(mocks.getDoc).not.toHaveBeenCalled();
        expect(printButton()).toBeEnabled();
    });
});
