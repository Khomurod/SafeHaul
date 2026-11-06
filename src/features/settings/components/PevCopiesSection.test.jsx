import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({ saveCompanySettings: vi.fn() }));
const toastMocks = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));
const fsMocks = vi.hoisted(() => ({ getDoc: vi.fn() }));

vi.mock('@features/companies', () => ({ saveCompanySettings: serviceMocks.saveCompanySettings }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (...parts) => parts.slice(1).join('/'), getDoc: (...args) => fsMocks.getDoc(...args) }));

import { PevCopiesSection } from './PevCopiesSection';
import { usePevCopiesDraft } from '../hooks/usePevCopiesDraft';

/**
 * The field with its draft, and the two moves Settings → Email's save bar
 * makes with it: check then save, and discard.
 */
function Harness({ profile }) {
    const draft = usePevCopiesDraft(profile);
    const [said, setSaid] = useState('');
    const save = async () => {
        const problem = draft.validate();
        setSaid(problem ?? (await draft.save()) ?? 'Saved');
    };
    return (
        <>
            <PevCopiesSection text={draft.text} error={draft.error} onChange={draft.onChange} />
            <p>{draft.dirty ? 'Unsaved' : 'Clean'}</p>
            <button type="button" onClick={save}>Save</button>
            <button type="button" onClick={draft.discard}>Discard</button>
            <output>{said}</output>
        </>
    );
}

const field = () => screen.getByRole('textbox', { name: /CC addresses/i });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const said = () => screen.getByRole('status');

describe('PevCopiesSection with its draft', () => {
    beforeEach(() => {
        // Every test starts from the same defaults, with no queued answer left over.
        vi.resetAllMocks();
        serviceMocks.saveCompanySettings.mockResolvedValue();
        // No newer list on the company document, unless a test says otherwise.
        fsMocks.getDoc.mockResolvedValue({ exists: () => false });
    });

    // The signed-in profile is read once per session. A list saved since,
    // here or in another tab, must show when Settings opens again.
    it('shows the list saved since the profile was loaded, with nothing to save', async () => {
        fsMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ pevCcEmails: ['safety@carrier.test'] }) });
        render(<Harness profile={{ id: 'co-1' }} />);

        await waitFor(() => expect(field()).toHaveValue('safety@carrier.test'));
        expect(fsMocks.getDoc).toHaveBeenCalledWith('companies/co-1');
        expect(screen.getByText('Clean')).toBeInTheDocument();
    });

    it('starts from the saved list', () => {
        render(<Harness profile={{ id: 'co-1', pevCcEmails: ['ops@carrier.test', 'hr@carrier.test'] }} />);
        expect(field()).toHaveValue('ops@carrier.test, hr@carrier.test');
        expect(screen.getByText('Clean')).toBeInTheDocument();
    });

    it('keeps what was typed when the saved list arrives later', async () => {
        let answer;
        fsMocks.getDoc.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        render(<Harness profile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });

        await act(async () => answer({ exists: () => true, data: () => ({ pevCcEmails: ['safety@carrier.test'] }) }));
        expect(field()).toHaveValue('ops@carrier.test');
        expect(screen.getByText('Unsaved')).toBeInTheDocument();

        // Discard shows the list the company document now holds.
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(field()).toHaveValue('safety@carrier.test');
        expect(screen.getByText('Clean')).toBeInTheDocument();
    });

    it('follows a list that arrives after a change was discarded', async () => {
        let answer;
        fsMocks.getDoc.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        render(<Harness profile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

        await act(async () => answer({ exists: () => true, data: () => ({ pevCcEmails: ['safety@carrier.test'] }) }));
        expect(field()).toHaveValue('safety@carrier.test');
        expect(screen.getByText('Clean')).toBeInTheDocument();
    });

    it('keeps the list just saved when an older read answers after the save', async () => {
        let answer;
        fsMocks.getDoc.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        render(<Harness profile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });
        save();
        await waitFor(() => expect(said()).toHaveTextContent('Saved'));
        expect(toastMocks.showSuccess).toHaveBeenCalled();

        await act(async () => answer({ exists: () => true, data: () => ({ pevCcEmails: ['old@carrier.test'] }) }));
        expect(field()).toHaveValue('ops@carrier.test');
        expect(screen.getByText('Clean')).toBeInTheDocument();
    });

    it('saves the list as the server reads it: lower-cased, each once', async () => {
        render(<Harness profile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'Ops@Carrier.test; ops@carrier.test safety@carrier.test' } });
        save();

        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verification copies saved.'));
        expect(field()).toHaveValue('ops@carrier.test, safety@carrier.test');
        expect(screen.getByText('Clean')).toBeInTheDocument();
        expect(serviceMocks.saveCompanySettings).toHaveBeenCalledWith('co-1', {
            pevCcEmails: ['ops@carrier.test', 'safety@carrier.test'],
        });
    });

    it('saves an empty field as copying no one', async () => {
        render(<Harness profile={{ id: 'co-1', pevCcEmails: ['ops@carrier.test'] }} />);
        fireEvent.change(field(), { target: { value: '' } });
        save();

        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Verification requests will copy no one by default.'));
        expect(serviceMocks.saveCompanySettings).toHaveBeenCalledWith('co-1', { pevCcEmails: [] });
    });

    it('saves nothing while an address is not one, and says which', () => {
        render(<Harness profile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test, nope' } });
        save();

        expect(serviceMocks.saveCompanySettings).not.toHaveBeenCalled();
        expect(field()).toHaveAccessibleDescription(expect.stringContaining('"nope" is not a valid email address.'));
        expect(said()).toHaveTextContent('Check the CC addresses, then save again.');

        // Typing clears the field's error.
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });
        expect(field()).not.toHaveAccessibleDescription(expect.stringContaining('not a valid'));
    });

    it('keeps the typed list and says so plainly when the save fails', async () => {
        const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        serviceMocks.saveCompanySettings.mockRejectedValue(failure);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<Harness profile={{ id: 'co-1' }} />);
        fireEvent.change(field(), { target: { value: 'ops@carrier.test' } });
        save();

        await waitFor(() => expect(said()).toHaveTextContent('Could not save the verification copies. Try again.'));
        expect(said()).not.toHaveTextContent(/permission/i);
        expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
        expect(field()).toHaveValue('ops@carrier.test');
        expect(screen.getByText('Unsaved')).toBeInTheDocument();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
