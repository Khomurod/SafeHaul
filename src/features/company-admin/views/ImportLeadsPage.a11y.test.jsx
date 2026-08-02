/**
 * Accessibility proof for the migrated `ImportLeadsPage`.
 *
 * The real `CompanyBulkUpload` is rendered (with its hooks stubbed) so the axe
 * scan covers the page shell and the embedded import surface together — the
 * combination that used to put a full-screen modal overlay on top of the page's
 * own header.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dataMock = vi.hoisted(() => ({ value: {} }));
const navigateMock = vi.hoisted(() => vi.fn());
const bulkImport = vi.hoisted(() => ({ value: {} }));
const leadUpload = vi.hoisted(() => ({ value: {} }));

vi.mock('@/context/DataContext', () => ({ useData: () => dataMock.value }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('@shared/hooks', () => ({ useBulkImport: () => bulkImport.value }));
vi.mock('@features/company-admin/hooks/useCompanyLeadUpload', () => ({
    useCompanyLeadUpload: () => leadUpload.value,
}));
vi.mock('../hooks/useCompanyLeadUpload', () => ({
    useCompanyLeadUpload: () => leadUpload.value,
}));

import { ImportLeadsPage } from './ImportLeadsPage';

const COMPANY_ID = 'artificial-company-1';

beforeEach(() => {
    vi.clearAllMocks();
    dataMock.value = {
        currentCompanyProfile: { id: COMPANY_ID },
        currentUserClaims: { roles: { [COMPANY_ID]: 'company_admin' } },
    };
    bulkImport.value = {
        csvData: [],
        step: 'upload', setStep: vi.fn(),
        importMethod: 'file', setImportMethod: vi.fn(),
        sheetUrl: '', setSheetUrl: vi.fn(),
        processingSheet: false,
        handleSheetImport: vi.fn(),
        handleFileChange: vi.fn(),
        reset: vi.fn(),
    };
    leadUpload.value = {
        uploading: false,
        progress: '',
        progressCount: { current: 0, total: 0 },
        stats: { created: 0, updated: 0 },
        step: 'upload', setStep: vi.fn(),
        assignmentMode: 'unassigned', setAssignmentMode: vi.fn(),
        teamMembers: [], selectedUserIds: [], setSelectedUserIds: vi.fn(),
        uploadLeads: vi.fn(),
        runDataRepair: vi.fn(),
    };
});

describe('ImportLeadsPage — accessibility', () => {
    it('keeps the page header reachable instead of covering it with an overlay', () => {
        render(<ImportLeadsPage />);

        expect(screen.getByRole('heading', { level: 1, name: 'Import Leads' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.querySelector('.fixed.inset-0')).toBeNull();
    });

    it('nests the import surface heading under the page heading', () => {
        render(<ImportLeadsPage />);

        const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));
        expect(levels[0]).toBe(1);
        // No level is skipped relative to the one before it.
        for (let i = 1; i < levels.length; i += 1) {
            expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
        }
    });

    it('has no axe violations for a company admin', async () => {
        const { container } = render(<ImportLeadsPage />);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no axe violations in the access-denied state', async () => {
        dataMock.value = {
            currentCompanyProfile: { id: COMPANY_ID },
            currentUserClaims: { roles: { [COMPANY_ID]: 'recruiter' } },
        };
        const { container } = render(<ImportLeadsPage />);

        expect(screen.getByRole('heading', { level: 1, name: 'Access Denied' })).toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no axe violations in the feature-locked state', async () => {
        dataMock.value = {
            currentCompanyProfile: { id: COMPANY_ID, features: { importLeads: false } },
            currentUserClaims: { roles: { [COMPANY_ID]: 'company_admin' } },
        };
        const { container } = render(<ImportLeadsPage />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
