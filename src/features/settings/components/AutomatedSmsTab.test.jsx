import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    doc: vi.fn((_db, ...segments) => segments.join('/')),
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

describe('AutomatedSmsTab compatibility slice', () => {
    beforeEach(() => {
        firestoreMocks.getDoc.mockReset();
        firestoreMocks.setDoc.mockReset();
        firestoreMocks.serverTimestamp.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();

        firestoreMocks.getDoc.mockResolvedValue(existingTemplates({
            templateContactAttempt1: 'First touch {driver name}',
            templateContactAttempt2: 'Second nudge',
            templateContactAttempt3: 'Final attempt from {user name}',
        }));
        firestoreMocks.setDoc.mockResolvedValue();
        firestoreMocks.serverTimestamp.mockReturnValue(SERVER_TIMESTAMP);
    });

    it('reads the existing document path and loads all three template values', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);

        expect(await findTextarea('Contact Attempt 1'))
            .toHaveValue('First touch {driver name}');
        expect(await findTextarea('Contact Attempt 2')).toHaveValue('Second nudge');
        expect(await findTextarea('Contact Attempt 3'))
            .toHaveValue('Final attempt from {user name}');

        expect(firestoreMocks.getDoc).toHaveBeenCalledWith(DOC_PATH);
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

    it('preserves the exact save document path, payload, and merge contract', async () => {
        render(<AutomatedSmsTab companyId="company-1" />);

        const one = await findTextarea('Contact Attempt 1');
        fireEvent.change(one, { target: { value: 'Updated first message' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save templates' }));

        await waitFor(() => expect(firestoreMocks.setDoc).toHaveBeenCalledOnce());

        const [reference, payload, options] = firestoreMocks.setDoc.mock.calls[0];
        expect(reference).toBe(DOC_PATH);
        expect(payload).toEqual({
            templateContactAttempt1: 'Updated first message',
            templateContactAttempt2: 'Second nudge',
            templateContactAttempt3: 'Final attempt from {user name}',
            updatedAt: SERVER_TIMESTAMP,
        });
        expect(payload.updatedAt).toBe(SERVER_TIMESTAMP);
        expect(firestoreMocks.serverTimestamp).toHaveBeenCalled();
        expect(options).toEqual({ merge: true });
    });

    it('disables the save button while saving and shows the success message', async () => {
        let resolveSave;
        firestoreMocks.setDoc.mockImplementation(() => new Promise((resolve) => {
            resolveSave = resolve;
        }));

        render(<AutomatedSmsTab companyId="company-1" />);
        await findTextarea('Contact Attempt 1');

        const saveButton = screen.getByRole('button', { name: 'Save templates' });
        fireEvent.click(saveButton);

        await waitFor(() => expect(saveButton).toBeDisabled());
        expect(saveButton).toHaveAttribute('aria-busy', 'true');

        resolveSave();
        await waitFor(() => expect(saveButton).toBeEnabled());
        expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Automated SMS templates saved.');
    });

    it('preserves the save-error message and re-enables the action', async () => {
        firestoreMocks.setDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(<AutomatedSmsTab companyId="company-1" />);
        await findTextarea('Contact Attempt 1');
        fireEvent.click(screen.getByRole('button', { name: 'Save templates' }));

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to save templates.');
        });
        expect(screen.getByRole('button', { name: 'Save templates' })).toBeEnabled();
        consoleError.mockRestore();
    });

    it('preserves the load-error message', async () => {
        firestoreMocks.getDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(<AutomatedSmsTab companyId="company-1" />);

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('Could not load automated SMS templates.');
        });
        // Load failure still resolves the loading state so the form is usable.
        expect(await findTextarea('Contact Attempt 1')).toBeInTheDocument();
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
