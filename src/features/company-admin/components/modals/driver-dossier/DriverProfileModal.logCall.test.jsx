/**
 * Log call in the dossier, beside Call: it opens the call log the lists open
 * (`CallOutcomeModal` and its real dialog) for the record on screen, as a list
 * row hands it, and once the call is saved the dossier reads the record again
 * (its stage and last call) and reopens Activity and Notes on the new entry.
 * Offered to whoever may work the record (`canEdit`), on a loaded record with a
 * phone, as the list offers a call only on a number.
 *
 * `useCallOutcome` is replaced by a stand-in that records what the dossier gave
 * it and "saves" by calling back as the real hook does after its writes, so
 * nothing is written, emailed or texted. All names and ids are artificial.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const fx = vi.hoisted(() => ({ view: null, callArgs: null, contentProps: null }));

vi.mock('@features/company-admin/hooks/useApplicationView', () => ({
    useApplicationView: () => fx.view,
}));
vi.mock('@features/applications/hooks/useApplicationDelete', () => ({
    useApplicationDelete: () => ({ deleting: false, deleteApplication: vi.fn() }),
}));
// The template read is Firestore's; `useContactAttemptTexts.test.js` covers it.
vi.mock('./useContactAttemptTexts', () => ({ useContactAttemptTexts: () => () => null }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentUserClaims: { roles: { 'co-1': 'recruiter' } } }),
}));
vi.mock('./DossierContent', () => ({
    DossierContent: (props) => {
        fx.contentProps = props;
        return <p>Tab body</p>;
    },
}));
vi.mock('@shared/hooks/useCallOutcome', () => ({
    useCallOutcome: (lead, companyId, onUpdate, onClose) => {
        fx.callArgs = { lead, companyId };
        return {
            outcome: 'interested', setOutcome: () => {},
            notes: '', setNotes: () => {},
            driverType: '', setDriverType: () => {},
            experienceLevel: '', setExperienceLevel: () => {},
            position: '', setPosition: () => {},
            callbackDate: '', setCallbackDate: () => {},
            callbackTime: '', setCallbackTime: () => {},
            saving: false,
            // What `useCallOutcome` does once its writes are done.
            handleSave: (event) => {
                event?.preventDefault?.();
                onUpdate({ converted: false, applicationId: lead.id });
                onClose();
            },
            showDetailInputs: false,
            showCallbackSelect: false,
            reminderLabel: '',
            onQuickReminder: () => {},
        };
    },
}));

import { DriverProfileModal } from './DriverProfileModal';

const RECORD = { firstName: 'Maria', lastName: 'Garcia', email: 'maria@example.com', phone: '5125551234', status: 'New Application', submittedAt: '2026-10-01T10:00:00.000Z' };

const baseView = () => ({
    loading: false,
    error: '',
    // As `useAppFetch` loads it: `docSnap.data()`, which holds no `id`.
    appData: RECORD,
    currentStatus: 'New Application',
    canEdit: true,
    handleStatusUpdate: vi.fn(),
    handleAssignChange: vi.fn(),
    handleDownloadPdf: vi.fn(),
    refreshRecord: vi.fn(async () => {}),
    fileUrls: {},
    dqStatus: 'complete',
    collectionName: 'applications',
    teamMembers: [],
    assignedTo: '',
});

const renderDossier = () => render(
    <DriverProfileModal companyId="co-1" driverId="app-1" isOpen onClose={vi.fn()} />,
);
const logCall = () => screen.queryByRole('button', { name: 'Log call' });

beforeEach(() => {
    fx.view = baseView();
    fx.callArgs = null;
    fx.contentProps = null;
});

afterEach(cleanup);

describe('Log call in the dossier', () => {
    it('sits between Call and Email', () => {
        renderDossier();
        const call = screen.getByRole('link', { name: 'Call' });
        const email = screen.getByRole('link', { name: 'Email' });
        const tiles = [...call.parentElement.children];
        expect(tiles.indexOf(logCall())).toBe(tiles.indexOf(call) + 1);
        expect(tiles.indexOf(email)).toBe(tiles.indexOf(logCall()) + 1);
    });

    it('opens the call log the lists open, for this record as a list row gives it', () => {
        renderDossier();
        fireEvent.click(logCall());

        const dialog = screen.getByRole('dialog', { name: /Log Call Result/ });
        expect(dialog).toHaveTextContent('Maria Garcia');
        expect(fx.callArgs).toEqual({ companyId: 'co-1', lead: { ...RECORD, id: 'app-1', companyId: 'co-1' } });
    });

    it('closes only the call log on Escape, leaving the dossier open', () => {
        renderDossier();
        fireEvent.click(logCall());
        fireEvent.keyDown(screen.getByRole('dialog', { name: /Log Call Result/ }), { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: /Log Call Result/ })).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Driver dossier' })).toBeInTheDocument();
        expect(fx.view.refreshRecord).not.toHaveBeenCalled();
    });

    it('shows the new state once the call is saved: the record again, and Activity and Notes read again', () => {
        renderDossier();
        expect(fx.contentProps.refreshKey).toBe(0);

        fireEvent.click(logCall());
        fireEvent.click(within(screen.getByRole('dialog', { name: /Log Call Result/ })).getByRole('button', { name: 'Save Result' }));

        expect(screen.queryByRole('dialog', { name: /Log Call Result/ })).toBeNull();
        expect(fx.view.refreshRecord).toHaveBeenCalledTimes(1);
        expect(fx.contentProps.refreshKey).toBe(1);
        // The tab the recruiter was on stays.
        expect(fx.contentProps.activeTab).toBe('application');
    });

    it.each([
        ['to someone who may not work the record', { canEdit: false }],
        ['for a record with no phone', { appData: { ...RECORD, phone: '' } }],
        ['while the record loads', { loading: true }],
        ['when the record could not load', { error: 'Could not find record (ID: app-1).' }],
    ])('is not offered %s', (_when, state) => {
        fx.view = { ...baseView(), ...state };
        renderDossier();
        expect(logCall()).toBeNull();
    });
});
