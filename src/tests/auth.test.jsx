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

        expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in|login/i })).toBeInTheDocument();
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

        const emailInput = screen.getByPlaceholderText(/email/i);
        const passwordInput = screen.getByPlaceholderText(/password/i);
        const submitButton = screen.getByRole('button', { name: /sign in|login/i });

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
        signInWithEmailAndPassword.mockRejectedValue({
            code: 'auth/wrong-password',
            message: 'The password is invalid',
        });

        // Mock window.alert
        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { });

        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        const emailInput = screen.getByPlaceholderText(/email/i);
        const passwordInput = screen.getByPlaceholderText(/password/i);
        const submitButton = screen.getByRole('button', { name: /sign in|login/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(alertMock).toHaveBeenCalled();
        });

        alertMock.mockRestore();
    });

    it('should display error message on network error', async () => {
        const { signInWithEmailAndPassword } = await import('firebase/auth');

        // Mock network error
        signInWithEmailAndPassword.mockRejectedValue({
            code: 'auth/network-request-failed',
            message: 'Network error',
        });

        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { });

        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        const emailInput = screen.getByPlaceholderText(/email/i);
        const passwordInput = screen.getByPlaceholderText(/password/i);
        const submitButton = screen.getByRole('button', { name: /sign in|login/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(alertMock).toHaveBeenCalled();
        });

        alertMock.mockRestore();
    });

    it('should show loading state during authentication', async () => {
        const { signInWithEmailAndPassword } = await import('firebase/auth');

        // Mock slow login
        signInWithEmailAndPassword.mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 100))
        );

        render(
            <BrowserRouter>
                <LoginScreen />
            </BrowserRouter>
        );

        const emailInput = screen.getByPlaceholderText(/email/i);
        const passwordInput = screen.getByPlaceholderText(/password/i);
        const submitButton = screen.getByRole('button', { name: /sign in|login/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
        fireEvent.click(submitButton);

        // Button should be disabled during loading
        expect(submitButton).toBeDisabled();
    });
});
