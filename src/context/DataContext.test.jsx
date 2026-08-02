import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Minimal firebase mocks so DataProvider reaches the loaded (no-user) state.
vi.mock('@lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: (_auth, cb) => {
        cb(null); // no signed-in user -> provider finishes loading and renders children
        return () => {};
    },
}));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    collection: vi.fn(),
    getCountFromServer: vi.fn(),
}));

import { DataProvider, useData, useAuth, useCompany, useUI } from './DataContext';

afterEach(cleanup);

function Probe() {
    const data = useData();
    const authSlice = useAuth();
    const companySlice = useCompany();
    const uiSlice = useUI();
    return (
        <div>
            <span data-testid="data-keys">{Object.keys(data).sort().join(',')}</span>
            <span data-testid="auth-keys">{Object.keys(authSlice).sort().join(',')}</span>
            <span data-testid="company-keys">{Object.keys(companySlice).sort().join(',')}</span>
            <span data-testid="ui-keys">{Object.keys(uiSlice).sort().join(',')}</span>
        </div>
    );
}

describe('DataContext split (D2)', () => {
    it('useData() shim preserves the full former public surface', async () => {
        render(<DataProvider><Probe /></DataProvider>);
        await waitFor(() => expect(screen.getByTestId('data-keys')).toBeInTheDocument());
        const keys = screen.getByTestId('data-keys').textContent.split(',');
        for (const k of [
            'currentUser', 'currentUserClaims', 'userRole', 'currentCompanyProfile',
            'setCurrentCompanyProfile', 'loginToCompany', 'handleLogout', 'logout',
            'returnToCompanyChooser', 'setShowCompanyChooser', 'loading',
        ]) {
            expect(keys).toContain(k);
        }
    });

    it('exposes granular auth / company / ui slices', async () => {
        render(<DataProvider><Probe /></DataProvider>);
        await waitFor(() => expect(screen.getByTestId('auth-keys')).toBeInTheDocument());
        expect(screen.getByTestId('auth-keys').textContent).toContain('currentUser');
        expect(screen.getByTestId('auth-keys').textContent).toContain('userRole');
        expect(screen.getByTestId('company-keys').textContent).toContain('currentCompanyProfile');
        expect(screen.getByTestId('company-keys').textContent).toContain('loginToCompany');
        expect(screen.getByTestId('ui-keys').textContent).toContain('setShowCompanyChooser');
    });
});
