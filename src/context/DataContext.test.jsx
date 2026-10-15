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

import { DataProvider, useData } from './DataContext';

afterEach(cleanup);

function Probe() {
    const data = useData();
    return <span data-testid="data-keys">{Object.keys(data).sort().join(',')}</span>;
}

describe('DataContext', () => {
    it('useData() exposes the session and company surface', async () => {
        render(<DataProvider><Probe /></DataProvider>);
        await waitFor(() => expect(screen.getByTestId('data-keys')).toBeInTheDocument());
        expect(screen.getByTestId('data-keys').textContent.split(',')).toEqual([
            'currentCompanyProfile', 'currentUser', 'currentUserClaims', 'handleLogout', 'loading',
            'loginToCompany', 'returnToCompanyChooser', 'setCurrentCompanyProfile', 'setShowCompanyChooser', 'userRole',
        ]);
    });
});
