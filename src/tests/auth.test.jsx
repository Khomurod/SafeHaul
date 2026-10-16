import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LoginScreen } from '@features/auth';

// Mock Firebase auth module
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({})),
    signInWithEmailAndPassword: vi.fn(),
    onAuthStateChanged: vi.fn((auth, callback) => {
        // Mock unsubscribe function
        return () => { };
    }),
}));

// Mock Firebase config
vi.mock('@lib/firebase', () => ({
    auth: {
        onAuthStateChanged: vi.fn((callback) => () => { }),
    },
    db: {},
    storage: {},
    functions: {},
}));

describe('Authentication Flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render login form with email and password fields', () => {
        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Enter your password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('should handle successful login', async () => {
        const { signInWithEmailAndPassword } = await import('firebase/auth');

        // Mock successful login
        signInWithEmailAndPassword.mockResolvedValue({
            user: {
                uid: 'test-uid-123',
                email: 'test@example.com',
            },
        });

        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        const emailInput = screen.getByPlaceholderText(/you@example.com/i);
        const passwordInput = screen.getByPlaceholderText(/Enter your password/i);
        const submitButton = screen.getByRole('button', { name: /sign in/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
                expect.anything(),
                'test@example.com',
                'password123'
            );
        });
    });

    it('should display error message on wrong password', async () => {
        const { signInWithEmailAndPassword } = await import('firebase/auth');

        // Mock failed login with wrong password error
        const authError = new Error('Firebase error');
        authError.code = 'auth/wrong-password';
        signInWithEmailAndPassword.mockRejectedValue(authError);

        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        const emailInput = screen.getByPlaceholderText(/you@example.com/i);
        const passwordInput = screen.getByPlaceholderText(/Enter your password/i);
        const submitButton = screen.getByRole('button', { name: /sign in/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
        });
    });

    it('should display error message on network error', async () => {
        const { signInWithEmailAndPassword } = await import('firebase/auth');

        // Mock network error
        signInWithEmailAndPassword.mockRejectedValue(new Error('Network error'));

        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        const emailInput = screen.getByPlaceholderText(/you@example.com/i);
        const passwordInput = screen.getByPlaceholderText(/Enter your password/i);
        const submitButton = screen.getByRole('button', { name: /sign in/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
        });
    });

    /**
     * The pending sign-in is settled INSIDE the test.
     *
     * A sign-in mocked to resolve on a timer the test does not wait for fires
     * while the file's environment is tearing down: `loginUser` throws on
     * `undefined.user`, `LoginScreen`'s catch calls `console.error`, and Vitest
     * fails the whole run with `EnvironmentTeardownError: Closing rpc while
     * "onUserConsoleLog" was pending` — every test passed, exit code 1.
     *
     * So the promise is a deferred the test rejects, and the test waits for the
     * rendered consequence before it ends (.claude/rules/testing.md).
     */
    it('disables Sign in while authentication is pending, and re-enables it after', async () => {
        const { signInWithEmailAndPassword } = await import('firebase/auth');

        let settle;
        signInWithEmailAndPassword.mockImplementation(
            () => new Promise((_resolve, reject) => { settle = reject; })
        );

        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        const emailInput = screen.getByPlaceholderText(/you@example.com/i);
        const passwordInput = screen.getByPlaceholderText(/Enter your password/i);
        const submitButton = screen.getByRole('button', { name: /sign in/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitButton);

        // Button should be disabled during loading
        expect(submitButton).toBeDisabled();

        settle(new Error('Network error'));

        await waitFor(() => {
            expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
            expect(submitButton).not.toBeDisabled();
        });
    });
});
