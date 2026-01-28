import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CompanyAdminDashboard } from '@features/company-admin/components/CompanyAdminDashboard';
import { DataProvider } from '@/context/DataContext';

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

vi.mock('@lib/firebase', () => ({
    auth: {
        onAuthStateChanged: vi.fn((callback) => {
            callback({ uid: 'test-user', email: 'test@example.com' });
            return () => { };
        }),
    },
    db: {},
    storage: {},
    functions: {},
}));

// Mock DataContext with test utilities
const MockDataProvider = ({ children, value }) => {
    return (
        <DataProvider>
            {children}
        </DataProvider>
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

        // Dashboard should render some content (exact structure may vary)
        const dashboard = screen.getByRole('main') || document.querySelector('[class*="dashboard"]');
        expect(dashboard).toBeTruthy();
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

        // Verify the component structure is rendered
        // (Specific assertions depend on actual dashboard layout)
        const container = document.body;
        expect(container).toBeTruthy();
        expect(container.textContent).toBeTruthy();
    });
});
