/**
 * Signing in returns to the page a signed-out visitor asked for, and an account
 * that belongs to no company is told so, with a way to sign out, instead of
 * being left on a blank page.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ value: {} }));
vi.mock('@/context/DataContext', () => ({ useData: () => session.value }));

// The sign-in form itself is LoginScreen's own test; here it only shows where
// it was sent from, and how.
vi.mock('@features/auth', async () => ({
    LoginScreen: function LoginProbe() {
        const location = useLocation();
        return <p>Sign-in form, from {String(location.state?.from)}, by {useNavigationType()}</p>;
    },
    NoAccessScreen: (await import('@features/auth/components/NoAccessScreen')).NoAccessScreen,
    returnPathFrom: (await import('@features/auth/returnPath')).returnPathFrom,
}));

import { AuthGuardedLogin, ProtectedRoute, RootRedirect } from './authRouteGuards';

const RECRUITER = { uid: 'u-1', email: 'rita.recruiter@example.com' };

function signedIn(user, userRole) {
    session.value = { currentUser: user, userRole, loading: false, handleLogout: vi.fn() };
}

function Applications() {
    const { search, hash } = useLocation();
    return <p>Applications page {search}{hash}</p>;
}

// Fails a test that sends the visitor between "/" and the sign-in page for ever,
// instead of letting it hang.
const visits = { root: 0 };
function CountedRoot() {
    visits.root += 1;
    if (visits.root > 20) throw new Error('Redirected between "/" and /login over and over');
    return <RootRedirect />;
}

function routes() {
    return (
        <Routes>
            <Route path="/login" element={<AuthGuardedLogin />} />
            <Route path="/" element={<CountedRoot />} />
            <Route
                path="/company/drivers/applications"
                element={<ProtectedRoute allowedRoles={['recruiter']}><Applications /></ProtectedRoute>}
            />
            <Route path="/company/dashboard" element={<p>Company dashboard</p>} />
            <Route path="/super-admin" element={<p>Super admin console</p>} />
        </Routes>
    );
}

function renderAt(entry) {
    return render(<MemoryRouter initialEntries={[entry]}>{routes()}</MemoryRouter>);
}

beforeEach(() => {
    session.value = { currentUser: null, userRole: null, loading: false, handleLogout: vi.fn() };
    visits.root = 0;
});

describe('signing in', () => {
    it('sends a signed-out visitor to sign in, replacing the page they asked for', () => {
        renderAt('/company/drivers/applications?tab=leads#row-3');

        expect(screen.getByText(
            'Sign-in form, from /company/drivers/applications?tab=leads#row-3, by REPLACE',
        )).toBeInTheDocument();
    });

    it('returns to the page asked for once signed in', () => {
        const { rerender } = renderAt('/company/drivers/applications?tab=leads#row-3');

        signedIn(RECRUITER, 'recruiter');
        rerender(<MemoryRouter>{routes()}</MemoryRouter>);

        expect(screen.getByText('Applications page ?tab=leads#row-3')).toBeInTheDocument();
    });

    it('goes to the workspace when no page was asked for', () => {
        signedIn(RECRUITER, 'recruiter');
        renderAt('/login');

        expect(screen.getByText('Company dashboard')).toBeInTheDocument();
    });

    it('ignores a return address that is not a page of this app', () => {
        signedIn(RECRUITER, 'recruiter');
        renderAt({ pathname: '/login', state: { from: '//elsewhere.example/phish' } });

        expect(screen.getByText('Company dashboard')).toBeInTheDocument();
    });
});

describe('an account that belongs to no company', () => {
    it('is told so, with the address it signed in with, instead of a blank page', () => {
        signedIn(RECRUITER, null);
        renderAt('/');

        expect(screen.getByRole('main', { name: 'Your account has no company access' })).toBeInTheDocument();
        expect(screen.getByText(/rita\.recruiter@example\.com/)).toBeInTheDocument();
    });

    it('can sign out from there', async () => {
        signedIn(RECRUITER, null);
        renderAt('/');

        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

        expect(session.value.handleLogout).toHaveBeenCalledTimes(1);
    });

    it('gets the same screen from the sign-in page and from a workspace link', () => {
        signedIn(RECRUITER, null);
        renderAt({ pathname: '/login', state: { from: '/company/drivers/applications' } });

        expect(screen.getByRole('heading', { level: 1, name: 'Your account has no company access' })).toBeInTheDocument();
    });

    it('gets it for a role the workspace does not know, rather than being sent to sign in again', () => {
        signedIn(RECRUITER, 'driver');
        renderAt('/');

        expect(screen.getByRole('heading', { level: 1, name: 'Your account has no company access' })).toBeInTheDocument();
        expect(screen.queryByText(/Sign-in form/)).not.toBeInTheDocument();
    });

    it('leaves a super admin and a company member where they belong', () => {
        signedIn(RECRUITER, 'super_admin');
        const { unmount } = renderAt('/');
        expect(screen.getByText('Super admin console')).toBeInTheDocument();
        unmount();

        signedIn(RECRUITER, 'hr_user');
        renderAt('/');
        expect(screen.getByText('Company dashboard')).toBeInTheDocument();
    });
});
