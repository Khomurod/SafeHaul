import React from 'react';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Minimal firebase mocks so DataProvider reaches the loaded (no-user) state.
// `authState.settle = false` holds the first auth answer back until a test
// calls `authState.callback`.
const authState = vi.hoisted(() => ({ settle: true, callback: null }));
vi.mock('@lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: (_auth, cb) => {
        authState.callback = cb;
        if (authState.settle) cb(null); // no signed-in user -> provider finishes loading and renders children
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

afterEach(() => {
    cleanup();
    authState.settle = true;
    authState.callback = null;
});

function Probe() {
    const data = useData();
    return <span data-testid="data-keys">{Object.keys(data).sort().join(',')}</span>;
}

describe('DataContext', () => {
    it('useData() exposes the session and company surface', async () => {
        render(<DataProvider><Probe /></DataProvider>);
        await waitFor(() => expect(screen.getByTestId('data-keys')).toBeInTheDocument());
        expect(screen.getByTestId('data-keys').textContent.split(',')).toEqual([
            'currentCompanyProfile', 'currentUser', 'currentUserClaims', 'handleLogout',
            'loginToCompany', 'returnToCompanyChooser', 'userRole',
        ]);
    });

    // Why the surface has no `loading`: nothing inside the provider renders
    // until the session has settled, so no consumer could ever read it true.
    it('renders nothing inside it until the session settles', async () => {
        authState.settle = false;
        render(<DataProvider><Probe /></DataProvider>);
        expect(screen.getByText('Loading Platform...')).toBeInTheDocument();
        expect(screen.queryByTestId('data-keys')).toBeNull();

        await act(async () => { authState.callback(null); });
        expect(await screen.findByTestId('data-keys')).toBeInTheDocument();
        expect(screen.queryByText('Loading Platform...')).toBeNull();
    });
});
