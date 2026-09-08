/**
 * The three things a recruiter presses, driven through the REAL editor and the
 * REAL link panel.
 *
 * The existing suite for this page stands its children in for simplified stubs,
 * which is the right trade for what it pins — the mode chooser, and that one
 * driver's state never leaks into the next. It is the wrong trade for this,
 * because the defect WAS the controls: Save and "Create the driver's link" were
 * `disabled` whenever their prerequisites were unmet and nothing said what those
 * were, so a stub that exposes an `onClick` cannot see the bug. Everything here
 * therefore goes through the schema-rendered `#email` and `#phone` and the
 * panel's own buttons.
 *
 * Three properties, in order of how much they cost:
 *
 *  1. Clickable, always. The press explains what is missing and moves focus to it.
 *  2. Clickable is NOT a licence to skip validation — nothing is saved, minted or
 *     copied when the prerequisites are unmet.
 *  3. A link addresses the SAVED application. Minting or copying with unsaved
 *     edits would hand the driver a different version, and after a contact
 *     correction a different RECORD, since the key is derived from the email and
 *     phone.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const callables = vi.hoisted(() => ({ httpsCallable: vi.fn(), calls: [], fail: null }));

vi.mock('firebase/functions', () => ({ httpsCallable: callables.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1', appSlug: 'blue-line' } }),
}));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(), isUploading: false }),
}));

import { StartApplicationPage } from './StartApplicationPage';

/** Saved keys are derived from the contact details, so a correction moves them. */
const keyFor = (email) => `key-${email || 'none'}`;

function clipboard(writeText) {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

beforeEach(() => {
    vi.resetAllMocks();
    callables.calls = [];
    callables.fail = null;
    callables.httpsCallable.mockImplementation((_functions, name) => async (payload) => {
        callables.calls.push({ name, payload });
        if (callables.fail === name) throw Object.assign(new Error('nope'), { code: 'functions/unavailable' });
        if (name === 'listCompanyPreparedApplications') return { data: { applications: [] } };
        if (name === 'saveCompanyPreparedApplication') {
            return { data: { saved: true, applicantKey: keyFor(payload.email), lockedEmployers: [] } };
        }
        if (name === 'mintApplicationInvite') {
            return { data: { inviteToken: 'tok-abc', applicantKey: payload.applicantKey, expiresInDays: 14 } };
        }
        return { data: {} };
    });
    clipboard(vi.fn().mockResolvedValue(undefined));
});

/** Into the editor, with a fresh application open. */
async function openEditor() {
    render(<StartApplicationPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Start typing/i }));
    await screen.findByRole('heading', { name: 'Driver details' });
}

/**
 * A schema-rendered field.
 *
 * `SchemaRenderer` suffixes its ids with `-edit` in edit mode, which is the mode
 * this screen is always in — the driver's wizard renders the same fields as
 * `#email`. Going through the real id rather than a `data-testid` is the point of
 * this file: the defect was in the controls.
 */
const field = (id) => document.getElementById(`${id}-edit`);

const save = () => screen.getByRole('button', { name: /^Save$/i });
const createLink = () => screen.getByRole('button', { name: /Create the driver's link/i });
const called = (name) => callables.calls.filter((entry) => entry.name === name);

describe('Save, with nothing to identify the application', () => {
    it('is clickable, explains what it needs, and focuses the field', async () => {
        await openEditor();

        expect(save()).toBeEnabled();
        fireEvent.click(save());

        expect(await screen.findByRole('alert')).toHaveTextContent(/email address or mobile number/i);
        expect(field('email')).toHaveFocus();
        // Clickable is not a licence to save an application with no identity.
        expect(called('saveCompanyPreparedApplication')).toHaveLength(0);
    });

    it.each([
        ['an email on its own', 'email', 'dana@example.test'],
        ['a phone on its own', 'phone', '2145550147'],
    ])('accepts %s — never both', async (_label, name, value) => {
        await openEditor();

        fireEvent.change(field(name), { target: { value } });
        fireEvent.click(save());

        await waitFor(() => expect(called('saveCompanyPreparedApplication')).toHaveLength(1));
    });

    it('refuses an address that cannot be an address, rather than keying a draft on it', async () => {
        // Neither side validated the format, so `dana@` became an application's
        // primary key.
        await openEditor();

        fireEvent.change(field('email'), { target: { value: 'dana@' } });
        fireEvent.click(save());

        expect(await screen.findByRole('alert')).toHaveTextContent(/does not look right/i);
        expect(called('saveCompanyPreparedApplication')).toHaveLength(0);
    });

    it('does not require the answers only the driver can give', async () => {
        // A prepared application is deliberately partial. No SSN, no signature, no
        // licence, no employer — the driver answers the rest.
        await openEditor();

        fireEvent.change(field('email'), { target: { value: 'dana@example.test' } });
        fireEvent.click(save());

        await waitFor(() => expect(called('saveCompanyPreparedApplication')).toHaveLength(1));
        const { payload } = called('saveCompanyPreparedApplication')[0];
        expect(payload.formData.ssn).toBeUndefined();
        expect(payload.formData.signature).toBeUndefined();
    });
});

describe("the driver's link", () => {
    async function savedApplication(email = 'dana@example.test') {
        await openEditor();
        fireEvent.change(field('email'), { target: { value: email } });
        fireEvent.click(save());
        await waitFor(() => expect(called('saveCompanyPreparedApplication')).toHaveLength(1));
    }

    it('is clickable before anything is saved, and offers to save', async () => {
        // The real precondition was "save first", and that sentence appeared
        // nowhere — `canMint` was `Boolean(applicantKey)`, which only a save sets.
        await openEditor();
        fireEvent.change(field('email'), { target: { value: 'dana@example.test' } });

        expect(createLink()).toBeEnabled();
        fireEvent.click(createLink());

        expect(await screen.findByRole('alert')).toHaveTextContent(/Save this application first/i);
        expect(called('mintApplicationInvite')).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: /Save and create the link/i }));

        await waitFor(() => expect(called('mintApplicationInvite')).toHaveLength(1));
        expect(await screen.findByTestId('invite-link')).toHaveTextContent('invite=tok-abc');
    });

    it('still needs the identity, and says so instead of the save', async () => {
        await openEditor();

        fireEvent.click(createLink());

        expect(await screen.findByRole('alert')).toHaveTextContent(/email address or mobile number/i);
        expect(screen.queryByRole('button', { name: /Save and create the link/i })).not.toBeInTheDocument();
    });

    it('is not minted for a version the driver would never see', async () => {
        await savedApplication();

        // Typed after the save. Minting now hands the driver the answers as they
        // were, and nothing used to say so.
        fireEvent.change(field('firstName'), { target: { value: 'Dana' } });
        fireEvent.click(createLink());

        expect(await screen.findByRole('alert')).toHaveTextContent(/Save your changes first/i);
        expect(called('mintApplicationInvite')).toHaveLength(0);
    });

    it('is not minted for a different record after a contact correction', async () => {
        // The sharpest case. `applicantKey` is the key of the last save, so minting
        // after a corrected email addressed the OLD document — and `identityLocked`
        // then froze the new email on screen beside a link opening the old record.
        await savedApplication('dana@exampl.test');

        fireEvent.change(field('email'), { target: { value: 'dana@example.test' } });
        fireEvent.click(createLink());

        expect(await screen.findByRole('alert')).toHaveTextContent(/Save your changes first/i);
        expect(called('mintApplicationInvite')).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: /Save and create the link/i }));

        await waitFor(() => expect(called('mintApplicationInvite')).toHaveLength(1));
        // The corrected key, not the one the screen was holding.
        expect(called('mintApplicationInvite')[0].payload.applicantKey).toBe(keyFor('dana@example.test'));
    });

    it('retires the document it moved off, so one driver is not two rows', async () => {
        await savedApplication('dana@exampl.test');

        fireEvent.change(field('email'), { target: { value: 'dana@example.test' } });
        fireEvent.click(save());

        await waitFor(() => expect(called('saveCompanyPreparedApplication')).toHaveLength(2));
        expect(called('saveCompanyPreparedApplication')[1].payload.previousApplicantKey)
            .toBe(keyFor('dana@exampl.test'));
    });
});

describe('copying it', () => {
    async function linkOnScreen() {
        await openEditor();
        fireEvent.change(field('email'), { target: { value: 'dana@example.test' } });
        fireEvent.click(save());
        await waitFor(() => expect(called('saveCompanyPreparedApplication')).toHaveLength(1));
        fireEvent.click(createLink());
        await screen.findByTestId('invite-link');
    }

    it('copies the link that is on screen', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        clipboard(writeText);
        await linkOnScreen();

        fireEvent.click(screen.getByRole('button', { name: /Copy link/i }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('invite=tok-abc')));
    });

    it('says so when the browser refuses, and points at the link', async () => {
        // A refused clipboard was entirely silent: the label just never changed to
        // "Copied", which reads as nothing having happened.
        clipboard(vi.fn().mockRejectedValue(new Error('denied')));
        await linkOnScreen();

        fireEvent.click(screen.getByRole('button', { name: /Copy link/i }));

        expect(await screen.findByText(/would not let us copy it/i)).toBeInTheDocument();
        expect(screen.getByText(/Select the link above/i)).toBeInTheDocument();
        // The link is still there to select, which is what makes this a lost
        // convenience rather than a lost link.
        expect(screen.getByTestId('invite-link')).toHaveTextContent('invite=tok-abc');
    });

    it('refuses to copy a link that no longer matches what is on screen', async () => {
        await linkOnScreen();

        fireEvent.change(field('firstName'), { target: { value: 'Dana' } });
        fireEvent.click(screen.getByRole('button', { name: /Copy link/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/Save your changes first/i);
    });
});

describe('while something is happening, and when it fails', () => {
    it('does not save twice on a double press', async () => {
        let release;
        callables.httpsCallable.mockImplementation((_functions, name) => async (payload) => {
            callables.calls.push({ name, payload });
            if (name === 'listCompanyPreparedApplications') return { data: { applications: [] } };
            if (name === 'saveCompanyPreparedApplication') {
                await new Promise((resolve) => { release = resolve; });
                return { data: { saved: true, applicantKey: keyFor(payload.email), lockedEmployers: [] } };
            }
            return { data: {} };
        });
        await openEditor();
        fireEvent.change(field('email'), { target: { value: 'dana@example.test' } });

        fireEvent.click(save());
        await waitFor(() => expect(save()).toBeDisabled());
        fireEvent.click(save());

        release();
        await waitFor(() => expect(save()).toBeEnabled());
        expect(called('saveCompanyPreparedApplication')).toHaveLength(1);
    });

    it('leaves the controls usable after a failed save, and says what happened', async () => {
        callables.fail = 'saveCompanyPreparedApplication';
        await openEditor();
        fireEvent.change(field('email'), { target: { value: 'dana@example.test' } });

        fireEvent.click(save());

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(save()).toBeEnabled();
    });
});
