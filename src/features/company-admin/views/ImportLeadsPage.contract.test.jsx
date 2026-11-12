/**
 * Contract freeze for `ImportLeadsPage`.
 *
 * Pins the permission rule, the feature-flag rule, and every navigation
 * destination: the leads list, but for the access-denied state's Return to
 * Dashboard. The
 * bulk-upload component is mocked so this file tests only the page's contract.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

    it('passes the company id and both callbacks to the bulk upload, each returning to the leads list', () => {
        render(<ImportLeadsPage />);

        expect(bulkUploadProps.value.companyId).toBe(COMPANY_ID);

        bulkUploadProps.value.onUploadComplete();
        expect(navigateMock).toHaveBeenLastCalledWith('/company/drivers/leads/company');

        // The import's Close once done.
        bulkUploadProps.value.onClose();
        expect(navigateMock).toHaveBeenCalledTimes(2);
        expect(navigateMock).toHaveBeenLastCalledWith('/company/drivers/leads/company');
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

    it('grants access to a super admin whose role sits at the token root, as the menu and the route do', () => {
        dataMock.value = {
            currentCompanyProfile: { id: COMPANY_ID },
            currentUserClaims: { globalRole: 'super_admin', roles: {} },
        };
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

    it('returns to the leads list when the feature-locked state is dismissed', () => {
        setContext({ features: { importLeads: false } });
        render(<ImportLeadsPage />);

        // The shared FeatureLockedModal exposes both an icon close and a text
        // close; either must return to the leads list.
        const closeControls = screen.getAllByRole('button', { name: 'Close' });
        expect(closeControls.length).toBeGreaterThan(0);
        fireEvent.click(closeControls[0]);
        expect(navigateMock).toHaveBeenCalledWith('/company/drivers/leads/company');
    });
});

describe('ImportLeadsPage — C2 header', () => {
    it('names the section it belongs to above the title', () => {
        render(<ImportLeadsPage />);
        expect(within(screen.getByRole('banner')).getByText('Driver Applications & Leads')).toBeInTheDocument();
    });

    it("links back to the person's leads list, followed inside the app", () => {
        render(<ImportLeadsPage />);

        const back = screen.getByRole('link', { name: 'Leads' });
        expect(back).toHaveAttribute('href', '/company/drivers/leads/company');
        fireEvent.click(back);
        expect(navigateMock).toHaveBeenCalledWith('/company/drivers/leads/company');
    });

    it('leaves a click with a modifier key to the browser (a new tab)', () => {
        render(<ImportLeadsPage />);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
        screen.getByRole('link', { name: 'Leads' }).dispatchEvent(event);
        expect(navigateMock).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('shows the import steps in the header, following the step the upload reports', () => {
        render(<ImportLeadsPage />);

        const steps = within(screen.getByRole('banner')).getByRole('list', { name: 'Import steps' });
        const items = within(steps).getAllByRole('listitem');
        expect(items.map((item) => item.getAttribute('aria-current'))).toEqual(['step', null, null]);

        act(() => bulkUploadProps.value.onStepChange('preview'));
        expect(items[1]).toHaveAttribute('aria-current', 'step');
        expect(items[0]).toHaveTextContent('completed');
    });

    it('keeps the steps on the title row from 560px of page, as C2 does', () => {
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 560, height: 0, top: 0, left: 0, right: 560, bottom: 0, x: 0, y: 0 });
        try {
            render(<ImportLeadsPage />);
            const header = screen.getByRole('banner');
            expect(within(header).getByRole('list', { name: 'Import steps' })).toBeInTheDocument();
            expect(screen.getAllByRole('list', { name: 'Import steps' })).toHaveLength(1);
        } finally {
            rect.mockRestore();
        }
    });

    it('puts the steps on a row of their own where the page is too narrow for the title row', () => {
        const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 432, height: 0, top: 0, left: 0, right: 432, bottom: 0, x: 0, y: 0 });
        try {
            render(<ImportLeadsPage />);
            expect(screen.getAllByRole('list', { name: 'Import steps' })).toHaveLength(1);
            expect(within(screen.getByRole('banner')).queryByRole('list', { name: 'Import steps' })).toBeNull();
        } finally {
            rect.mockRestore();
        }
    });
});
