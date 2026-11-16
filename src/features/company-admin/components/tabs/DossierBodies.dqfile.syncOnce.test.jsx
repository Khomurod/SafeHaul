// `DQFileTab` with the real `dqFileSync`: the server files the record's uploads
// (`syncDqFiles`) the first time the DQ tab opens in a dossier opening, not on
// every return to the tab; leads too. A failed filing is tried again on the next
// opening, another record is filed on its own, and a new opening of the dossier
// (`forgetDriverUploadFilings`, when it closes) files again.
//
// All ids below are artificial.
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sync = vi.hoisted(() => ({ calls: [], answer: async () => ({ data: { filed: 0 } }) }));

vi.mock('@lib/firebase', async () => ({ ...(await import('./DossierBodies.contract.support')).libFirebaseMock(), functions: {} }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/firestore', async () => (await import('./DossierBodies.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./DossierBodies.contract.support')).firebaseStorageMock());
vi.mock('@shared/utils/activityLogger', async () => (await import('./DossierBodies.contract.support')).activityLoggerMock());
vi.mock('@features/applications/services/applicationPdfService', async () => (await import('./DossierBodies.contract.support')).applicationPdfServiceMock());
vi.mock('@features/auth/services/userService', async () => (await import('./DossierBodies.contract.support')).userServiceMock());
vi.mock('@features/applications/services/applicationFileLink', async () => (await import('./DossierBodies.contract.support')).applicationFileLinkMock());
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (payload) => {
        sync.calls.push({ name, payload });
        return sync.answer(payload);
    },
}));

import { DQFileTab } from './DQFileTab';
import { forgetDriverUploadFilings } from './dqFileSync';
import { fs, resetHarness, snap, DQ_FILE } from './DossierBodies.contract.support';

const EMPTY = 'No DQ files have been uploaded for this driver.';

/** The DQ tab of one record opened, then left. */
async function visitDqTab(props = {}) {
    const view = render(<DQFileTab companyId="co-1" applicationId="lead-1" collectionName="leads" {...props} />);
    await screen.findByText(EMPTY);
    await waitFor(() => expect(sync.calls.length).toBeGreaterThan(0));
    view.unmount();
}

beforeEach(() => {
    resetHarness();
    sync.calls = [];
    sync.answer = async () => ({ data: { filed: 0 } });
});
afterEach(() => {
    forgetDriverUploadFilings();
});

describe('DQFileTab — filing the record\'s uploads once while the dossier is open', () => {
    it('asks the server on the first opening only, and reads the list on each', async () => {
        await visitDqTab();
        await visitDqTab();
        render(<DQFileTab companyId="co-1" applicationId="lead-1" collectionName="leads" />);

        expect(await screen.findByText(EMPTY)).toBeInTheDocument();
        expect(sync.calls).toEqual([
            { name: 'syncDqFiles', payload: { companyId: 'co-1', collectionName: 'leads', applicationId: 'lead-1' } },
        ]);
        expect(fs.getDocs).toHaveBeenCalledTimes(3);
    });

    it('files another record on its first opening too', async () => {
        await visitDqTab();
        await visitDqTab({ applicationId: 'app-2', collectionName: 'applications' });

        expect(sync.calls.map(({ payload }) => payload.applicationId)).toEqual(['lead-1', 'app-2']);
    });

    it('lists what the first opening filed when the tab is opened again', async () => {
        sync.answer = async () => ({ data: { filed: 1 } });
        const reads = [snap([])];
        fs.getDocs.mockImplementation(async () => reads.shift() ?? snap([['f1', DQ_FILE]]));
        const first = render(<DQFileTab companyId="co-1" applicationId="lead-1" collectionName="leads" />);
        expect(await screen.findByRole('link', { name: /^Download Medical Card: medcard\.pdf/ })).toBeInTheDocument();
        first.unmount();

        render(<DQFileTab companyId="co-1" applicationId="lead-1" collectionName="leads" />);

        expect(await screen.findByRole('link', { name: /^Download Medical Card: medcard\.pdf/ })).toBeInTheDocument();
        expect(sync.calls).toHaveLength(1);
    });

    it('tries again on the next opening after a failed filing', async () => {
        sync.answer = async () => { throw new Error('unavailable'); };
        const first = render(<DQFileTab companyId="co-1" applicationId="lead-1" collectionName="leads" />);
        expect(await screen.findByText("Some of the driver's uploads could not be added here. Open this tab again to retry."))
            .toBeInTheDocument();
        first.unmount();

        sync.answer = async () => ({ data: { filed: 0 } });
        await visitDqTab();

        expect(sync.calls).toHaveLength(2);
    });

    it('files again in a new opening of the dossier', async () => {
        await visitDqTab();
        forgetDriverUploadFilings();
        await visitDqTab();

        expect(sync.calls).toHaveLength(2);
    });
});
