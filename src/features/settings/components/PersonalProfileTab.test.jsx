import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...segments) => segments.join('/')),
    getDoc: firestoreMocks.getDoc,
    setDoc: firestoreMocks.setDoc,
    updateDoc: firestoreMocks.updateDoc,
}));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => toastMocks,
}));

import { PersonalProfileTab } from './PersonalProfileTab';

const currentUser = {
    uid: 'user-1',
    email: 'admin@example.com',
};

const currentCompanyProfile = {
    id: 'company-1',
    appSlug: 'safehaul-logistics',
};

function existingUser(data = {}) {
    return {
        exists: () => true,
        data: () => ({
            name: 'Admin User',
            recruitingCode: 'ABC123',
            ...data,
        }),
    };
}

describe('PersonalProfileTab compatibility slice', () => {
    beforeEach(() => {
        firestoreMocks.getDoc.mockReset();
        firestoreMocks.setDoc.mockReset();
        firestoreMocks.updateDoc.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        firestoreMocks.getDoc.mockResolvedValue(existingUser());
        firestoreMocks.setDoc.mockResolvedValue();
        firestoreMocks.updateDoc.mockResolvedValue();

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue() },
        });
    });

    it('loads existing values and exposes labelled, accessible controls', async () => {
        const { container } = render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        expect(screen.getByRole('status')).toHaveTextContent(
            'Generating unique code...',
        );
        expect(await screen.findByRole('textbox', { name: 'Full Name' }))
            .toHaveValue('Admin User');

        const email = screen.getByRole('textbox', { name: 'Email' });
        expect(email).toHaveValue('admin@example.com');
        expect(email).toHaveAttribute('readonly');
        expect(email).toHaveAccessibleDescription('Email cannot be changed directly.');
        expect(screen.getByRole('region', { name: 'Profile details' }))
            .toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('preserves the existing name-only Firestore save contract and feedback', async () => {
        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        const name = await screen.findByRole('textbox', { name: 'Full Name' });
        fireEvent.change(name, { target: { value: 'Updated Admin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

        await waitFor(() => {
            expect(firestoreMocks.updateDoc).toHaveBeenCalledWith(
                'users/user-1',
                { name: 'Updated Admin' },
            );
        });
        expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Personal profile updated successfully.');
    });

    it('preserves recruiting-link generation and clipboard behavior', async () => {
        firestoreMocks.getDoc.mockResolvedValue(existingUser({
            recruitingCode: undefined,
        }));
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        await waitFor(() => expect(firestoreMocks.setDoc).toHaveBeenCalledOnce());
        const [linkReference, linkPayload] = firestoreMocks.setDoc.mock.calls[0];
        const generatedCode = linkReference.replace('recruiter_links/', '');

        expect(linkPayload).toEqual({
            userId: 'user-1',
            companyId: 'company-1',
            createdAt: expect.any(Date),
        });
        expect(firestoreMocks.updateDoc).toHaveBeenCalledWith(
            'users/user-1',
            { recruitingCode: generatedCode },
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            `${window.location.origin}/apply/safehaul-logistics?r=${generatedCode}`,
        );
        expect(toastMocks.showSuccess).toHaveBeenCalledWith('Short link copied!');
        random.mockRestore();
    });

    it('preserves the recruiting-link generation error feedback', async () => {
        firestoreMocks.getDoc.mockResolvedValue(existingUser({
            recruitingCode: undefined,
        }));
        firestoreMocks.setDoc.mockRejectedValueOnce(new Error('permission-denied'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('Could not generate tracking link.');
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('preserves the existing save error path and re-enables the action', async () => {
        firestoreMocks.updateDoc.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <PersonalProfileTab
                currentUser={currentUser}
                currentCompanyProfile={currentCompanyProfile}
            />,
        );

        await screen.findByRole('textbox', { name: 'Full Name' });
        fireEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

        await waitFor(() => {
            expect(toastMocks.showError).toHaveBeenCalledWith('Failed to update profile.');
        });
        expect(screen.getByRole('button', { name: 'Update Profile' })).toBeEnabled();
        consoleError.mockRestore();
    });
});
