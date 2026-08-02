import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Freeze the auth/redirect/reset contracts at the service boundary so the
// presentation migration can be verified without a live Firebase backend.
const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    loginUser: vi.fn(),
    resetPassword: vi.fn(),
    getPortalUser: vi.fn(),
    getMembershipsForUser: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('../services/authService', () => ({
    loginUser: mocks.loginUser,
    resetPassword: mocks.resetPassword,
}));

vi.mock('../services/userService', () => ({
    getPortalUser: mocks.getPortalUser,
    getMembershipsForUser: mocks.getMembershipsForUser,
}));

import { LoginScreen } from './LoginScreen';

function renderLogin(locationState) {
    const entry = locationState
        ? { pathname: '/login', state: locationState }
        : { pathname: '/login' };
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <LoginScreen />
        </MemoryRouter>,
    );
}

function authenticatedUser(claims = {}) {
    return {
        uid: 'user-1',
        getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
    };
}

function submitLogin({ email = 'driver@example.com', password = 'correct horse' } = {}) {
    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), {
        target: { value: email },
    });
    fireEvent.change(screen.getByPlaceholderText(/Enter your password/i), {
        target: { value: password },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginScreen — design-system migration', () => {
    beforeEach(() => {
        mocks.navigate.mockReset();
        mocks.loginUser.mockReset();
        mocks.resetPassword.mockReset();
        mocks.getPortalUser.mockReset();
        mocks.getMembershipsForUser.mockReset();
        // Safe redirect defaults: authenticated, no elevated claims, no company.
        mocks.loginUser.mockResolvedValue(authenticatedUser());
        mocks.getPortalUser.mockResolvedValue(null);
        mocks.getMembershipsForUser.mockResolvedValue({ empty: true });
        mocks.resetPassword.mockResolvedValue({ success: true });
    });

    it('renders labelled, accessible login controls with autofill attributes', async () => {
        const { container } = renderLogin();

        const email = screen.getByRole('textbox', { name: /email address/i });
        const password = screen.getByPlaceholderText(/Enter your password/i);

        expect(email).toHaveAttribute('type', 'email');
        expect(email).toHaveAttribute('autocomplete', 'email');
        expect(email).toBeRequired();
        expect(password).toHaveAttribute('type', 'password');
        expect(password).toHaveAttribute('autocomplete', 'current-password');
        expect(password).toBeRequired();
        expect(screen.getByRole('button', { name: /sign in/i })).toHaveAttribute('type', 'submit');

        expect((await axe(container)).violations).toEqual([]);
    });

    it('calls the login service with the entered credentials', async () => {
        renderLogin();
        submitLogin({ email: 'driver@example.com', password: 'correct horse' });

        await waitFor(() => {
            expect(mocks.loginUser).toHaveBeenCalledWith('driver@example.com', 'correct horse');
        });
    });

    it('honors a requested-route redirect and skips the role lookup', async () => {
        renderLogin({ from: '/company/candidates' });
        submitLogin();

        await waitFor(() => {
            expect(mocks.navigate).toHaveBeenCalledWith('/company/candidates', { replace: true });
        });
        expect(mocks.getPortalUser).not.toHaveBeenCalled();
        expect(mocks.getMembershipsForUser).not.toHaveBeenCalled();
    });

    it('redirects a Super Admin (claims) to the super-admin console', async () => {
        mocks.loginUser.mockResolvedValue(authenticatedUser({ super_admin: true }));
        renderLogin();
        submitLogin();

        await waitFor(() => {
            expect(mocks.navigate).toHaveBeenCalledWith('/super-admin', { replace: true });
        });
    });

    it('redirects a Super Admin via the Firestore role fallback', async () => {
        mocks.loginUser.mockResolvedValue(authenticatedUser({}));
        mocks.getPortalUser.mockResolvedValue({ role: 'super_admin' });
        renderLogin();
        submitLogin();

        await waitFor(() => {
            expect(mocks.navigate).toHaveBeenCalledWith('/super-admin', { replace: true });
        });
    });

    it('redirects a company member to the company dashboard', async () => {
        mocks.getMembershipsForUser.mockResolvedValue({ empty: false });
        renderLogin();
        submitLogin();

        await waitFor(() => {
            expect(mocks.navigate).toHaveBeenCalledWith('/company/dashboard', { replace: true });
        });
    });

    it('falls back to the root redirect when there is no membership', async () => {
        mocks.getMembershipsForUser.mockResolvedValue({ empty: true });
        renderLogin();
        submitLogin();

        await waitFor(() => {
            expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
        });
    });

    it('surfaces an authentication error and re-enables the submit control', async () => {
        mocks.loginUser.mockRejectedValue(new Error('Invalid email or password.'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderLogin();
        submitLogin();

        expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
        expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
        consoleError.mockRestore();
    });

    it('disables the submit control while authenticating', async () => {
        let resolveLogin;
        mocks.loginUser.mockImplementation(
            () => new Promise((resolve) => { resolveLogin = resolve; }),
        );
        renderLogin();
        submitLogin();

        expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
        resolveLogin(authenticatedUser());
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    });

    it('toggles password visibility with an accessible, labelled control', () => {
        renderLogin();
        const password = screen.getByPlaceholderText(/Enter your password/i);
        const toggle = screen.getByRole('button', { name: /show password/i });

        expect(password).toHaveAttribute('type', 'password');
        expect(toggle).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(toggle);
        expect(password).toHaveAttribute('type', 'text');
        expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
        expect(password).toHaveAttribute('type', 'password');
    });

    describe('password reset workflow', () => {
        function openReset(loginEmail) {
            renderLogin();
            if (loginEmail) {
                fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), {
                    target: { value: loginEmail },
                });
            }
            fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
            return screen.getByRole('dialog');
        }

        it('opens as an accessible dialog, pre-fills the login email, and focuses the field', async () => {
            const dialog = openReset('recruiter@example.com');

            expect(dialog).toHaveAccessibleName('Reset your password');
            const resetEmail = within(dialog).getByRole('textbox', { name: /email address/i });
            expect(resetEmail).toHaveValue('recruiter@example.com');
            await waitFor(() => expect(resetEmail).toHaveFocus());
        });

        it('validates an empty email without calling the reset service', async () => {
            const dialog = openReset();
            fireEvent.submit(dialog.querySelector('form'));

            expect(await within(dialog).findByText('Please enter your email address')).toBeInTheDocument();
            expect(mocks.resetPassword).not.toHaveBeenCalled();
        });

        it('sends the reset email and shows the success state', async () => {
            const dialog = openReset('recruiter@example.com');
            fireEvent.submit(dialog.querySelector('form'));

            await waitFor(() => {
                expect(mocks.resetPassword).toHaveBeenCalledWith('recruiter@example.com');
            });
            expect(await screen.findByText('Check your email')).toBeInTheDocument();
            expect(screen.getByText('recruiter@example.com')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument();
        });

        it('surfaces a reset failure message', async () => {
            mocks.resetPassword.mockRejectedValue(new Error('Reset service unavailable'));
            const dialog = openReset('recruiter@example.com');
            fireEvent.submit(dialog.querySelector('form'));

            expect(await within(dialog).findByText('Reset service unavailable')).toBeInTheDocument();
        });

        it('closes and resets the workflow from the back control', () => {
            openReset('recruiter@example.com');
            fireEvent.click(screen.getByRole('button', { name: /back to login/i }));

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('closes from the success confirmation', async () => {
            const dialog = openReset('recruiter@example.com');
            fireEvent.submit(dialog.querySelector('form'));

            const done = await screen.findByRole('button', { name: /back to sign in/i });
            fireEvent.click(done);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });
});
