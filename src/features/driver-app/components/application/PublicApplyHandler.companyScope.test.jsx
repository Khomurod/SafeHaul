/**
 * A signed-in staff member who opens a public application link keeps their own
 * company: the application's steps see the company applied to, and the session's
 * company is left alone.
 *
 * All names and ids below are artificial.
 */
import React, { useMemo, useState } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DataContext, useData } from '@/context/DataContext';

vi.mock('@shared/components/layout/Stepper', () => ({
    default: function StepsProbe() {
        const { currentCompanyProfile } = useData();
        return <p>Steps ask for {currentCompanyProfile?.companyName}</p>;
    },
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }),
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), getDoc: vi.fn(), collection: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: true,
    getE2EQueryParam: vi.fn((name, fallback) => fallback),
}));

import { PublicApplyHandler } from './PublicApplyHandler';

function SessionCompany() {
    const { currentCompanyProfile } = useData();
    return <p>Workspace is {currentCompanyProfile?.companyName}</p>;
}

// The signed-in session, holding its company the way DataProvider does.
function Session({ children }) {
    const [currentCompanyProfile, setCurrentCompanyProfile] = useState({ id: 'co-own', companyName: 'Own Freight' });
    const value = useMemo(() => ({ currentCompanyProfile, setCurrentCompanyProfile }), [currentCompanyProfile]);
    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

describe('a public application opened by a signed-in staff member', () => {
    it("asks for the company applied to and leaves the staff member's company alone", async () => {
        render(
            <Session>
                <SessionCompany />
                <MemoryRouter initialEntries={['/apply/e2e-company']}>
                    <Routes>
                        <Route path="/apply/:slug" element={<PublicApplyHandler />} />
                    </Routes>
                </MemoryRouter>
            </Session>,
        );

        expect(await screen.findByText('Steps ask for E2E Logistics')).toBeInTheDocument();
        expect(screen.getByText('Workspace is Own Freight')).toBeInTheDocument();
    });
});
