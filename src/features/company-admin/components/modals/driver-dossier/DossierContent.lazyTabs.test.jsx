/**
 * The dossier's Activity and Notes tabs load their own code and nothing more.
 * They were imported through a barrel that also exported the Previous
 * Employment tab, so opening either one downloaded that tab's PDF tooling too.
 *
 * Notes also takes the record's shared history from the dossier, which has
 * already read the record, so the tab does not read it a second time. The
 * Documents tab, loaded with the dossier, holds the driver's signing documents
 * only: the driver's uploads are in the DQ File tab, the one place for them.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const fx = vi.hoisted(() => ({ loaded: [], notesProps: null, signingProps: null, dqProps: null, mounts: [] }));

vi.mock('@features/company-admin/components/tabs/PEVTab', () => {
    fx.loaded.push('PEVTab');
    return { PEVTab: () => <p>Previous employment</p> };
});
vi.mock('@features/company-admin/components/tabs/ActivityHistoryTab', async () => {
    const { useEffect } = await import('react');
    return {
        ActivityHistoryTab: () => {
            // Each mount is a fresh read of the trail.
            useEffect(() => { fx.mounts.push('activity'); }, []);
            return <p>Audit trail</p>;
        },
    };
});
vi.mock('@features/company-admin/components/tabs/NotesTab', async () => {
    const { useEffect } = await import('react');
    return {
        NotesTab: (props) => {
            fx.notesProps = props;
            useEffect(() => { fx.mounts.push('notes'); }, []);
            return <p>Notes</p>;
        },
    };
});
vi.mock('@features/company-admin/components/tabs/DQFileTab', () => ({
    DQFileTab: (props) => {
        fx.dqProps = props;
        return null;
    },
}));
vi.mock('./tabs/ApplicationTab', () => ({ ApplicationTab: () => null }));
vi.mock('./tabs/SigningDocumentsSection', () => ({
    SigningDocumentsSection: (props) => {
        fx.signingProps = props;
        return <p>Signing documents</p>;
    },
}));

import { DossierContent } from './DossierContent';

afterEach(() => {
    cleanup();
    fx.notesProps = null;
    fx.signingProps = null;
    fx.dqProps = null;
    fx.mounts = [];
});

describe('the dossier tabs that load later', () => {
    // First in the file: a tab's code loads once, and a later render of it does not wait.
    it("announces the standard loading state while a tab's code loads", async () => {
        render(<DossierContent activeTab="activity" appData={{}} driverId="app-1" companyId="co-1" collectionName="applications" />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading this tab…');
        expect(screen.getByRole('heading', { level: 4, name: 'Loading this tab…' })).toBeInTheDocument();
        expect(await screen.findByText('Audit trail')).toBeInTheDocument();
    });

    it.each([
        ['activity', 'Audit trail'],
        ['notes', 'Notes'],
    ])('%s loads without the Previous Employment tab', async (tab, text) => {
        render(<DossierContent activeTab={tab} appData={{}} driverId="app-1" companyId="co-1" collectionName="applications" />);

        expect(await screen.findByText(text)).toBeInTheDocument();
        expect(fx.loaded).toEqual([]);
    });

    it('hands the Notes tab the shared history of the record already loaded', async () => {
        const sharedHistory = [{ text: 'Prior note', date: '2026-01-01T00:00:00.000Z' }];
        const appData = { status: 'New Application', sharedHistory };
        render(<DossierContent activeTab="notes" appData={appData} driverId="app-1" companyId="co-1" collectionName="leads" />);

        expect(await screen.findByText('Notes')).toBeInTheDocument();
        expect(fx.notesProps).toEqual({
            companyId: 'co-1',
            applicationId: 'app-1',
            collectionName: 'leads',
            sharedHistory,
            refreshKey: 0,
        });
        // The same array, so an unchanged record does not re-run the tab's read.
        expect(fx.notesProps.sharedHistory).toBe(sharedHistory);
    });

    it('loads the Previous Employment tab when it is opened', async () => {
        render(<DossierContent activeTab="pev" appData={{}} driverId="app-1" companyId="co-1" collectionName="applications" />);

        expect(await screen.findByText('Previous employment')).toBeInTheDocument();
        expect(fx.loaded).toEqual(['PEVTab']);
    });
});

describe('the Documents tab', () => {
    // It listed the application's uploads again below the signing documents, as
    // a gallery with a preview; the DQ File tab lists and opens the same files.
    it("shows the record's signing documents, and says where the driver's uploads are", () => {
        const appData = { 'cdl-front': { name: 'cdl.jpg', storagePath: 'companies/co-1/applications/guest_uploads/1_cdl.jpg' } };
        render(<DossierContent activeTab="documents" appData={appData} driverId="lead-1" companyId="co-1" collectionName="leads" fileUrls={{ 'cdl-front': 'https://x/cdl.jpg' }} />);

        const texts = [...document.querySelectorAll('p')].map((p) => p.textContent);
        expect(texts).toEqual(['Signing documents', "The driver's uploads, such as the CDL and the medical card, are in the DQ File tab."]);
        // The record too: Send a document sends to this driver.
        expect(fx.signingProps).toEqual({ companyId: 'co-1', recordId: 'lead-1', collectionName: 'leads', record: appData });
        expect(screen.queryByText('Uploaded Documents')).toBeNull();
    });
});

describe('a call logged in the dossier', () => {
    it('hands Notes the refresh, without starting it over (a note being written stays)', async () => {
        const props = { activeTab: 'notes', appData: {}, driverId: 'app-1', companyId: 'co-1', collectionName: 'applications' };
        const { rerender } = render(<DossierContent {...props} refreshKey={0} />);
        expect(await screen.findByText('Notes')).toBeInTheDocument();

        rerender(<DossierContent {...props} refreshKey={1} />);
        expect(fx.mounts).toEqual(['notes']);
        expect(fx.notesProps.refreshKey).toBe(1);
    });

    it.each([
        ['activity', 'Audit trail'],
    ])('reopens %s, which reads its entries once, so the call shows', async (tab, text) => {
        const props = { activeTab: tab, appData: {}, driverId: 'app-1', companyId: 'co-1', collectionName: 'applications' };
        const { rerender } = render(<DossierContent {...props} refreshKey={0} />);
        expect(await screen.findByText(text)).toBeInTheDocument();

        rerender(<DossierContent {...props} refreshKey={0} />);
        expect(fx.mounts).toEqual([tab]);

        rerender(<DossierContent {...props} refreshKey={1} />);
        expect(fx.mounts).toEqual([tab, tab]);
    });
});

describe('the DQ File tab', () => {
    it('takes the record already loaded, for its checklist\'s employers, and the way to their tab', () => {
        const appData = { employers: [{ companyName: 'Prairie Line Freight' }] };
        const onOpenTab = vi.fn();
        render(<DossierContent activeTab="dq" appData={appData} driverId="app-1" companyId="co-1" collectionName="applications" onOpenTab={onOpenTab} />);

        expect(fx.dqProps).toEqual({ companyId: 'co-1', applicationId: 'app-1', collectionName: 'applications', appData, onOpenTab });
        expect(fx.dqProps.appData).toBe(appData);
    });
});
