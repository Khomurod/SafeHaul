/**
 * The dossier's Activity and Notes tabs load their own code and nothing more.
 * They were imported through a barrel that also exported the Previous
 * Employment tab, so opening either one downloaded that tab's PDF tooling too.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const fx = vi.hoisted(() => ({ loaded: [] }));

vi.mock('@features/company-admin/components/tabs/PEVTab', () => {
    fx.loaded.push('PEVTab');
    return { PEVTab: () => <p>Previous employment</p> };
});
vi.mock('@features/company-admin/components/tabs/ActivityHistoryTab', () => ({ ActivityHistoryTab: () => <p>Audit trail</p> }));
vi.mock('@features/company-admin/components/tabs/NotesTab', () => ({ NotesTab: () => <p>Notes</p> }));
vi.mock('@features/company-admin/components/tabs/DQFileTab', () => ({ DQFileTab: () => null }));
vi.mock('./tabs/ApplicationTab', () => ({ ApplicationTab: () => null }));
vi.mock('./tabs/DocumentsTab', () => ({ DocumentsTab: () => null }));

import { DossierContent } from './DossierContent';

afterEach(cleanup);

describe('the dossier tabs that load later', () => {
    it.each([
        ['activity', 'Audit trail'],
        ['notes', 'Notes'],
    ])('%s loads without the Previous Employment tab', async (tab, text) => {
        render(<DossierContent activeTab={tab} appData={{}} driverId="app-1" companyId="co-1" collectionName="applications" />);

        expect(await screen.findByText(text)).toBeInTheDocument();
        expect(fx.loaded).toEqual([]);
    });

    it('loads the Previous Employment tab when it is opened', async () => {
        render(<DossierContent activeTab="pev" appData={{}} driverId="app-1" companyId="co-1" collectionName="applications" />);

        expect(await screen.findByText('Previous employment')).toBeInTheDocument();
        expect(fx.loaded).toEqual(['PEVTab']);
    });
});
