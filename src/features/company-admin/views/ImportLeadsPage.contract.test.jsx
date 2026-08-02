/**
 * Contract freeze for `ImportLeadsPage`.
 *
 * Pins the permission rule, the feature-flag rule, and every navigation
 * destination before the design-system migration touches the shell. The
 * bulk-upload component is mocked so this file tests only the page's contract.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dataMock = vi.hoisted(() => ({ value: {} }));
const navigateMock = vi.hoisted(() => vi.fn());
const bulkUploadProps = vi.hoisted(() => ({ value: null }));

vi.mock('@/context/DataContext', () => ({ useData: () => dataMock.value }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('@features/company-admin/components/CompanyBulkUpload', () => ({
    CompanyBulkUpload: (props) => {
        bulkUploadProps.value = props;
        return <div data-testid="bulk-upload" />;
    },
}));

import { ImportLeadsPage } from './ImportLeadsPage';

const COMPANY_ID = 'artificial-company-1';

function setContext({ features, roles } = {}) {
    dataMock.value = {
        currentCompanyProfile: { id: COMPANY_ID, ...(features ? { features } : {}) },
        currentUserClaims: { roles: roles ?? { [COMPANY_ID]: 'company_admin' } },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    bulkUploadProps.value = null;
    setContext();
});

describe('ImportLeadsPage — preserved contracts', () => {
    it('renders the frozen page heading and description for a company admin', () => {
        render(<ImportLeadsPage />);

        expect(screen.getByRole('heading', { name: 'Import Leads' })).toBeInTheDocument();
        expect(screen.getByText('Bulk upload leads from a CSV file.')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-upload')).toBeInTheDocument();
    });

    it('names the page heading at level 1', () => {
        render(<ImportLeadsPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Import Leads' })).toBeInTheDocument();
    });

    it('passes the company id and both callbacks to the bulk upload', () => {
        render(<ImportLeadsPage />);

        expect(bulkUploadProps.value.companyId).toBe(COMPANY_ID);

        bulkUploadProps.value.onUploadComplete();
        expect(navigateMock).toHaveBeenCalledWith('/company/drivers/leads/company');

        bulkUploadProps.value.onClose();
        expect(navigateMock).toHaveBeenCalledWith('/company/dashboard');
    });

    it('renders the bulk upload embedded in the page rather than as an overlay', () => {
        render(<ImportLeadsPage />);
        expect(bulkUploadProps.value.isEmbedded).toBe(true);
    });

    it('grants access to a super admin without a company role', () => {
        setContext({ roles: { globalRole: 'super_admin' } });
        render(<ImportLeadsPage />);
        expect(screen.getByTestId('bulk-upload')).toBeInTheDocument();
    });

    it('denies access to a non-admin with the frozen copy and dashboard route', () => {
        setContext({ roles: { [COMPANY_ID]: 'recruiter' } });
        render(<ImportLeadsPage />);

        expect(screen.queryByTestId('bulk-upload')).toBeNull();
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
        expect(screen.getByText(
            'You do not have permission to import leads. Please contact your Company Admin to request access.',
        )).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Return to Dashboard' }));
        expect(navigateMock).toHaveBeenCalledWith('/company/dashboard');
    });

    it('shows the feature-locked state only when the flag is explicitly false', () => {
        setContext({ features: { importLeads: false } });
        const { unmount } = render(<ImportLeadsPage />);

        expect(screen.queryByTestId('bulk-upload')).toBeNull();
        expect(screen.getByText('Import Leads')).toBeInTheDocument();
        expect(screen.getByText(
            'This feature is currently turned off for your company. Please contact our Sales Team to enable it.',
        )).toBeInTheDocument();
        unmount();

        setContext({ features: { importLeads: true } });
        render(<ImportLeadsPage />);
        expect(screen.getByTestId('bulk-upload')).toBeInTheDocument();
    });

    it('treats a missing feature flag as enabled', () => {
        setContext();
        render(<ImportLeadsPage />);
        expect(screen.getByTestId('bulk-upload')).toBeInTheDocument();
    });

    it('checks the feature flag before the permission rule', () => {
        setContext({ features: { importLeads: false }, roles: { [COMPANY_ID]: 'recruiter' } });
        render(<ImportLeadsPage />);

        expect(screen.queryByText('Access Denied')).toBeNull();
        expect(screen.getByText(
            'This feature is currently turned off for your company. Please contact our Sales Team to enable it.',
        )).toBeInTheDocument();
    });

    it('returns to the dashboard when the feature-locked state is dismissed', () => {
        setContext({ features: { importLeads: false } });
        render(<ImportLeadsPage />);

        // The shared FeatureLockedModal exposes both an icon close and a text
        // close; either must return to the dashboard.
        const closeControls = screen.getAllByRole('button', { name: 'Close' });
        expect(closeControls.length).toBeGreaterThan(0);
        fireEvent.click(closeControls[0]);
        expect(navigateMock).toHaveBeenCalledWith('/company/dashboard');
    });
});
