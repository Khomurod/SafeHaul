/**
 * The dossier's Activity and Notes tabs load their own code and nothing more.
 * They were imported through a barrel that also exported the Previous
 * Employment tab, so opening either one downloaded that tab's PDF tooling too.
 *
 * Notes also takes the record's shared history from the dossier, which has
 * already read the record, so the tab does not read it a second time. The
 * Documents tab, loaded with the dossier, holds the signing documents too.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const fx = vi.hoisted(() => ({ loaded: [], notesProps: null, signingProps: null }));

vi.mock('@features/company-admin/components/tabs/PEVTab', () => {
    fx.loaded.push('PEVTab');
    return { PEVTab: () => <p>Previous employment</p> };
});
vi.mock('@features/company-admin/components/tabs/ActivityHistoryTab', () => ({ ActivityHistoryTab: () => <p>Audit trail</p> }));
vi.mock('@features/company-admin/components/tabs/NotesTab', () => ({
    NotesTab: (props) => {
        fx.notesProps = props;
        return <p>Notes</p>;
    },
}));
vi.mock('@features/company-admin/components/tabs/DQFileTab', () => ({ DQFileTab: () => null }));
vi.mock('./tabs/ApplicationTab', () => ({ ApplicationTab: () => null }));
vi.mock('./tabs/DocumentsTab', () => ({ DocumentsTab: () => <p>Uploaded documents</p> }));
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
});

describe('the dossier tabs that load later', () => {
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
    it('shows the record\'s signing documents above the uploaded documents', () => {
        render(<DossierContent activeTab="documents" appData={{}} driverId="lead-1" companyId="co-1" collectionName="leads" />);

        const texts = [...document.querySelectorAll('p')].map((p) => p.textContent);
        expect(texts).toEqual(['Signing documents', 'Uploaded documents']);
        expect(fx.signingProps).toEqual({ companyId: 'co-1', recordId: 'lead-1', collectionName: 'leads' });
    });
});
