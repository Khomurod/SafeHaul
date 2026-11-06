import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserWouldAsk, renderWithLeaveGuard } from './leaveGuard.support';

const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' };

const firestoreMocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segments) => segments.join('/'),
    getDoc: firestoreMocks.getDoc,
    setDoc: firestoreMocks.setDoc,
    serverTimestamp: firestoreMocks.serverTimestamp,
}));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => toastMocks,
}));

import { AutomatedSmsTab } from './AutomatedSmsTab';

const DOC_PATH = 'companies/company-1/settings/automated_sms';

function existingTemplates(data) {
    return {
        exists: () => true,
        data: () => data,
    };
}

function missingDoc() {
    return { exists: () => false, data: () => ({}) };
}

async function findTextarea(name) {
    return screen.findByRole('textbox', { name });
}

const saveBar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const barButton = (name) => within(saveBar()).getByRole('button', { name });

beforeEach(() => {
    // Every test starts from the same defaults, with no queued answer left over.
    vi.resetAllMocks();
    firestoreMocks.getDoc.mockResolvedValue(existingTemplates({
        templateContactAttempt1: 'First touch {driver name}',
        templateContactAttempt2: 'Second nudge',
        templateContactAttempt3: 'Final attempt from {user name}',
    }));
    firestoreMocks.setDoc.mockResolvedValue();
    firestoreMocks.serverTimestamp.mockReturnValue(SERVER_TIMESTAMP);
});

describe('AutomatedSmsTab compatibility slice', () => {
    it('reads the existing document path and loads all three template values', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);

        expect(await findTextarea('Contact Attempt 1'))
            .toHaveValue('First touch {driver name}');
        expect(await findTextarea('Contact Attempt 2')).toHaveValue('Second nudge');
        expect(await findTextarea('Contact Attempt 3'))
            .toHaveValue('Final attempt from {user name}');

        expect(firestoreMocks.getDoc).toHaveBeenCalledWith(DOC_PATH);
    });

    it('names every placeholder the texts can use, the application link too', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);

        await findTextarea('Contact Attempt 1');
        for (const placeholder of ['{driver name}', '{user name}', '{application link}']) {
            expect(screen.getByText(placeholder)).toBeInTheDocument();
        }
    });

    it('falls back to empty strings when the document is missing', async () => {
        firestoreMocks.getDoc.mockResolvedValue(missingDoc());
        render(<AutomatedSmsTab companyId="company-1" />);

        expect(await findTextarea('Contact Attempt 1')).toHaveValue('');
        expect(await findTextarea('Contact Attempt 2')).toHaveValue('');
        expect(await findTextarea('Contact Attempt 3')).toHaveValue('');
    });

    it('falls back to empty strings when individual fields are absent', async () => {
        firestoreMocks.getDoc.mockResolvedValue(existingTemplates({
            templateContactAttempt2: 'Only the middle one',
        }));
        render(<AutomatedSmsTab companyId="company-1" />);

        expect(await findTextarea('Contact Attempt 1')).toHaveValue('');
        expect(await findTextarea('Contact Attempt 2')).toHaveValue('Only the middle one');
        expect(await findTextarea('Contact Attempt 3')).toHaveValue('');
    });

    it('gives each textarea a stable, unique, programmatically associated id', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);

        const one = await findTextarea('Contact Attempt 1');
        const two = await findTextarea('Contact Attempt 2');
        const three = await findTextarea('Contact Attempt 3');

        expect(one).toHaveAttribute('id', 'automated-sms-contact-attempt-1');
        expect(two).toHaveAttribute('id', 'automated-sms-contact-attempt-2');
        expect(three).toHaveAttribute('id', 'automated-sms-contact-attempt-3');
        expect(new Set([one.id, two.id, three.id]).size).toBe(3);
    });

    it('edits each template independently', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);

        const one = await findTextarea('Contact Attempt 1');
        const two = await findTextarea('Contact Attempt 2');
        const three = await findTextarea('Contact Attempt 3');

        fireEvent.change(one, { target: { value: 'Edited one' } });
        fireEvent.change(three, { target: { value: 'Edited three' } });

        expect(one).toHaveValue('Edited one');
        expect(two).toHaveValue('Second nudge');
        expect(three).toHaveValue('Edited three');
    });

    it('says the templates could not be loaded, and retries', async () => {
        firestoreMocks.getDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(<AutomatedSmsTab companyId="company-1" />);

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('Could not load automated SMS templates.');
        });
        expect(screen.getByRole('alert')).toHaveTextContent('The saved templates could not be loaded.');
        expect(await findTextarea('Contact Attempt 1')).toHaveValue('');

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await findTextarea('Contact Attempt 1')).toHaveValue('First touch {driver name}');
        expect(screen.queryByText('The saved templates could not be loaded.')).not.toBeInTheDocument();
        expect(firestoreMocks.getDoc).toHaveBeenCalledTimes(2);
        consoleError.mockRestore();
    });

    it('after a failed read, saves only the template typed in, so none it could not show is erased', async () => {
        firestoreMocks.getDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<AutomatedSmsTab companyId="company-1" />);

        fireEvent.change(await findTextarea('Contact Attempt 1'), { target: { value: 'Typed after the failure' } });
        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toBeNull());
        expect(firestoreMocks.setDoc.mock.calls[0][1]).toEqual({
            templateContactAttempt1: 'Typed after the failure',
            updatedAt: SERVER_TIMESTAMP,
        });
        consoleError.mockRestore();
    });

    it('does not read or write Firestore when companyId is missing (documented behavior)', async () => {
        render(<AutomatedSmsTab companyId={undefined} />);

        // The existing guard leaves the tab in its loading state and performs no read.
        expect(screen.getByRole('status')).toHaveTextContent('Loading');
        expect(firestoreMocks.getDoc).not.toHaveBeenCalled();
        expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
    });

    it('announces an accessible loading status while the read is in flight', async () => {
        // Deterministic home for this assertion. `e2e/company-settings-automated-sms.spec.cjs`
        // used to assert it in a real browser, but a loading state is transient by
        // definition and E2E could only observe it because the offline Firestore SDK
        // happened to take ~20s to give up — an accident of network timing, not a
        // property of the component. Once E2E Firestore was made to fail immediately
        // (`connectFirestoreEmulator` at a closed port) the state resolved too fast to
        // catch and the browser test failed. Holding the promise open here tests the
        // same behaviour with no race.
        let resolveLoad;
        firestoreMocks.getDoc.mockImplementation(() => new Promise((resolve) => {
            resolveLoad = resolve;
        }));

        render(<AutomatedSmsTab companyId="company-1" />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading');

        resolveLoad(existingTemplates({ templateContactAttempt1: 'done' }));
        // Once resolved the announcement must go away, or a screen reader would be
        // told the page is still loading forever.
        expect(await findTextarea('Contact Attempt 1')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not update state after unmount during an in-flight load', async () => {
        let resolveLoad;
        firestoreMocks.getDoc.mockImplementation(() => new Promise((resolve) => {
            resolveLoad = resolve;
        }));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { unmount } = render(<AutomatedSmsTab companyId="company-1" />);
        unmount();
        resolveLoad(existingTemplates({ templateContactAttempt1: 'late' }));

        await waitFor(() => expect(firestoreMocks.getDoc).toHaveBeenCalled());
        // The cancellation guard must swallow the resolved snapshot without warning.
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('has no structural accessibility violations', async () => {
        const { container } = render(<AutomatedSmsTab companyId="company-1" />);
        await findTextarea('Contact Attempt 1');

        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('AutomatedSmsTab save bar', () => {
    it('shows no save bar until a template changes, then names what changed', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);
        const one = await findTextarea('Contact Attempt 1');
        expect(saveBar()).toBeNull();
        // No Save of its own: the bar is the page's one way to save.
        expect(screen.queryByRole('button', { name: /save/i })).toBeNull();

        fireEvent.change(one, { target: { value: 'Updated first message' } });
        expect(saveBar()).toHaveTextContent('1 change · Contact Attempt 1');

        fireEvent.change(await findTextarea('Contact Attempt 3'), { target: { value: 'Updated third' } });
        expect(saveBar()).toHaveTextContent('2 changes · Contact Attempt 1, Contact Attempt 3');

        // Typed back to what is saved: nothing left to save.
        fireEvent.change(one, { target: { value: 'First touch {driver name}' } });
        fireEvent.change(await findTextarea('Contact Attempt 3'), { target: { value: 'Final attempt from {user name}' } });
        expect(saveBar()).toBeNull();
    });

    it('preserves the exact save document path, payload, and merge contract', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);

        const one = await findTextarea('Contact Attempt 1');
        fireEvent.change(one, { target: { value: 'Updated first message' } });
        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(saveBar()).toBeNull());
        expect(firestoreMocks.setDoc).toHaveBeenCalledOnce();
        const [reference, payload, options] = firestoreMocks.setDoc.mock.calls[0];
        expect(reference).toBe(DOC_PATH);
        // Only the changed template is written; the others stay as stored.
        expect(payload).toEqual({
            templateContactAttempt1: 'Updated first message',
            updatedAt: SERVER_TIMESTAMP,
        });
        expect(firestoreMocks.serverTimestamp).toHaveBeenCalled();
        expect(options).toEqual({ merge: true });
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Automated SMS templates saved.');
        expect(one).toHaveValue('Updated first message');
    });

    it('shows Save busy and holds Discard while saving', async () => {
        let resolveSave;
        firestoreMocks.setDoc.mockImplementation(() => new Promise((resolve) => {
            resolveSave = resolve;
        }));
        render(<AutomatedSmsTab companyId="company-1" />);
        fireEvent.change(await findTextarea('Contact Attempt 2'), { target: { value: 'Changed' } });

        fireEvent.click(barButton('Save'));

        await waitFor(() => expect(barButton('Save')).toHaveAttribute('aria-busy', 'true'));
        expect(barButton('Save')).toBeDisabled();
        expect(barButton('Discard')).toBeDisabled();
        await act(async () => resolveSave());
        await waitFor(() => expect(saveBar()).toBeNull());
    });

    it('puts every template back on Discard', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);
        const one = await findTextarea('Contact Attempt 1');
        const three = await findTextarea('Contact Attempt 3');
        fireEvent.change(one, { target: { value: 'Edited one' } });
        fireEvent.change(three, { target: { value: 'Edited three' } });

        fireEvent.click(barButton('Discard'));

        expect(saveBar()).toBeNull();
        expect(one).toHaveValue('First touch {driver name}');
        expect(three).toHaveValue('Final attempt from {user name}');
        expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
    });

    it('keeps the edits and the bar, with a plain message, when saving fails', async () => {
        const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        firestoreMocks.setDoc.mockRejectedValueOnce(failure);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<AutomatedSmsTab companyId="company-1" />);
        const one = await findTextarea('Contact Attempt 1');
        fireEvent.change(one, { target: { value: 'Updated first message' } });

        fireEvent.click(barButton('Save'));

        const alert = await within(await screen.findByRole('region', { name: 'Unsaved changes' })).findByRole('alert');
        expect(alert).toHaveTextContent('The templates could not be saved.');
        // The database's own words stay in the console, for whoever investigates.
        expect(alert).not.toHaveTextContent(/insufficient permissions/i);
        expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
        expect(one).toHaveValue('Updated first message');
        expect(barButton('Save')).toBeEnabled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();

        // Saving again succeeds and clears the message with the bar.
        fireEvent.click(barButton('Save'));
        await waitFor(() => expect(saveBar()).toBeNull());
        consoleError.mockRestore();
    });

    it('keeps an edit made while the save was on its way, still unsaved', async () => {
        let resolveSave;
        firestoreMocks.setDoc.mockImplementation(() => new Promise((resolve) => {
            resolveSave = resolve;
        }));
        render(<AutomatedSmsTab companyId="company-1" />);
        fireEvent.change(await findTextarea('Contact Attempt 1'), { target: { value: 'Sent one' } });
        fireEvent.click(barButton('Save'));
        fireEvent.change(await findTextarea('Contact Attempt 2'), { target: { value: 'Typed meanwhile' } });

        await act(async () => resolveSave());

        await waitFor(() => expect(saveBar()).toHaveTextContent('1 change · Contact Attempt 2'));
        expect(firestoreMocks.setDoc.mock.calls[0][1]).not.toHaveProperty('templateContactAttempt2');
    });

    it('asks before a move leaves unsaved templates, and lets a clean page go', async () => {
        const { leave } = renderWithLeaveGuard(<AutomatedSmsTab companyId="company-1" />);
        const one = await findTextarea('Contact Attempt 1');

        expect(browserWouldAsk()).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        expect(leave).toHaveBeenCalledTimes(1);

        fireEvent.change(one, { target: { value: 'Unsaved' } });
        expect(browserWouldAsk()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
        expect(leave).toHaveBeenCalledTimes(1);

        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(leave).toHaveBeenCalledTimes(1);
        expect(one).toHaveValue('Unsaved');

        fireEvent.click(screen.getByRole('button', { name: 'Leave this page' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' }))
            .getByRole('button', { name: 'Discard changes' }));
        expect(leave).toHaveBeenCalledTimes(2);
    });

    it('has no accessibility violations with unsaved edits', async () => {
        const { container } = render(<AutomatedSmsTab companyId="company-1" />);
        fireEvent.change(await findTextarea('Contact Attempt 1'), { target: { value: 'Unsaved' } });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('AutomatedSmsTab — a company switch', () => {
    it("never offers one company's templates as another's", async () => {
        const { rerender } = render(<AutomatedSmsTab companyId="company-1" />);
        expect(await findTextarea('Contact Attempt 1')).toHaveValue('First touch {driver name}');

        firestoreMocks.getDoc.mockResolvedValue(missingDoc());
        rerender(<AutomatedSmsTab companyId="company-2" />);

        await waitFor(async () => expect(await findTextarea('Contact Attempt 1')).toHaveValue(''));
        expect(await findTextarea('Contact Attempt 2')).toHaveValue('');
        expect(saveBar()).toBeNull();
    });
});
