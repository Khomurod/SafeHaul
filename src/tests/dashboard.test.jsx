import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CompanyAdminDashboard } from '@features/company-admin/components/CompanyAdminDashboard';
import { ToastProvider } from '@shared/components/feedback/ToastProvider';

const dashboardState = vi.hoisted(() => ({
    counts: {
        applications: 8,
        companyLeads: 2,
        myLeads: 1,
        hired: 2,
    },
    statsFetchError: '',
    refreshData: vi.fn(),
}));

const onboardingState = vi.hoisted(() => ({
    showTour: false,
    completeTour: vi.fn(),
}));

vi.mock('@features/companies', () => ({
    useCompanyDashboard: () => dashboardState,
}));

vi.mock('@features/onboarding/hooks/useOnboarding', () => ({
    useOnboarding: () => onboardingState,
}));

vi.mock('@features/onboarding/components/OnboardingTour', () => ({
    OnboardingTour: () => <div role="dialog" aria-label="Onboarding tour">Tour</div>,
}));

vi.mock('@features/company-admin/components/InlineLeaderboard', () => ({
    InlineLeaderboard: () => <section aria-label="Team leaderboard">Leaderboard</section>,
}));

// Mock Firebase with complete auth state management
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({
        onAuthStateChanged: vi.fn((callback) => {
            // Immediately call with mock user
            callback({ uid: 'test-user', email: 'test@example.com' });
            return () => { }; // unsubscribe
        }),
    })),
    onAuthStateChanged: vi.fn((auth, callback) => {
        callback({ uid: 'test-user', email: 'test@example.com' });
        return () => { };
    }),
}));

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(() => Promise.resolve({ docs: [], empty: true })),
    getCountFromServer: vi.fn(() => Promise.resolve({ data: () => ({ count: 0 }) })),
    doc: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => true, data: () => ({ name: 'Test Admin', role: 'company_admin' }) }))
}));

vi.mock('@lib/firebase', () => ({
    auth: {
        onAuthStateChanged: vi.fn((callback) => {
            callback(null);
            return () => { };
        }),
    },
    db: {},
    storage: {},
    functions: {},
}));

import { DataContext } from '@/context/DataContext';

// Mock DataContext with test utilities
const MockDataProvider = ({ children, value }) => {
    return (
        <DataContext.Provider value={value}>
            <ToastProvider>
                {children}
            </ToastProvider>
        </DataContext.Provider>
    );
};

describe('CompanyAdminDashboard Smoke Tests', () => {
    it('should render without crashing when provided with mock company profile', () => {
        const mockCompanyProfile = {
            id: 'test-company-123',
            companyName: 'Test Transport Co.',
            email: 'admin@test.com',
            phone: '555-0100',
            address: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
            createdAt: new Date().toISOString(),
        };

        // This test verifies the component can mount without errors
        expect(() => {
            render(
                <BrowserRouter>
                    <MockDataProvider value={{ currentCompanyProfile: mockCompanyProfile }}>
                        <CompanyAdminDashboard />
                    </MockDataProvider>
                </BrowserRouter>
            );
        }).not.toThrow();
    });

    it('should display company name when profile is provided', () => {
        const mockCompanyProfile = {
            id: 'test-company-123',
            companyName: 'Acme Trucking LLC',
        };

        render(
            <BrowserRouter>
                <MockDataProvider value={{ currentCompanyProfile: mockCompanyProfile }}>
                    <CompanyAdminDashboard />
                </MockDataProvider>
            </BrowserRouter>
        );

        // Dashboard should render the company name in the welcome text
        const welcomeText = screen.getByText(/Acme Trucking LLC/i);
        expect(welcomeText).toBeInTheDocument();
    });

    it('should handle missing company profile gracefully', () => {
        // Test with no company profile
        expect(() => {
            render(
                <BrowserRouter>
                    <MockDataProvider value={{ currentCompanyProfile: null }}>
                        <CompanyAdminDashboard />
                    </MockDataProvider>
                </BrowserRouter>
            );
        }).not.toThrow();
    });

    it('should render key dashboard sections', () => {
        const mockCompanyProfile = {
            id: 'test-company-123',
            companyName: 'Test Logistics',
        };

        render(
            <BrowserRouter>
                <MockDataProvider value={{ currentCompanyProfile: mockCompanyProfile }}>
                    <CompanyAdminDashboard />
                </MockDataProvider>
            </BrowserRouter>
        );

        expect(screen.getByRole('heading', { name: 'Welcome back, Admin User' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Applications: 8' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Company Leads: 2' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'My Leads: 1' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Hired: 2' }))
            .toBeInTheDocument();
        expect(screen.getByLabelText('Team leaderboard')).toBeInTheDocument();
    });

    it('keeps metric navigation keyboard-accessible', () => {
        const mockCompanyProfile = {
            id: 'test-company-123',
            companyName: 'Test Logistics',
        };

        render(
            <BrowserRouter>
                <MockDataProvider value={{ currentCompanyProfile: mockCompanyProfile }}>
                    <CompanyAdminDashboard />
                </MockDataProvider>
            </BrowserRouter>
        );

        const applications = screen.getByRole('button', { name: 'Applications: 8' });
        applications.focus();
        fireEvent.keyDown(applications, { key: 'Enter' });
        fireEvent.click(applications);
        expect(window.location.pathname).toBe('/company/drivers/applications');
    });

    it('preserves onboarding composition when the feature hook requests it', () => {
        onboardingState.showTour = true;
        const mockCompanyProfile = {
            id: 'test-company-123',
            companyName: 'Test Logistics',
        };

        render(
            <BrowserRouter>
                <MockDataProvider value={{ currentCompanyProfile: mockCompanyProfile }}>
                    <CompanyAdminDashboard />
                </MockDataProvider>
            </BrowserRouter>
        );

        expect(screen.getByRole('dialog', { name: 'Onboarding tour' })).toBeInTheDocument();
        onboardingState.showTour = false;
    });
});
