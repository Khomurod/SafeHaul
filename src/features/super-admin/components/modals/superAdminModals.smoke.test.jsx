import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DeleteCompanyModal } from './DeleteCompanyModal';
import { ViewCompanyAppsModal } from './ViewCompanyAppsModal';

const mockDeleteCompany = vi.fn(() => Promise.resolve({ data: { success: true } }));
const mockLoadApplicationsPage = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockDeleteCompany),
}));

vi.mock('@lib/firebase', () => ({
  functions: {},
}));

vi.mock('@features/applications/services/applicationService', () => ({
  loadApplicationsPage: (...args) => mockLoadApplicationsPage(...args),
  countApplications: async () => 1,
}));

describe('Super-admin modals post-cleanup smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DeleteCompanyModal mounts with expected root id', () => {
    render(
      <DeleteCompanyModal
        companyId="co-1"
        companyName="Test Co"
        onClose={() => {}}
        onConfirm={async () => {}}
      />,
    );
    expect(document.getElementById('delete-company-modal')).toBeTruthy();
  });

  it('ViewCompanyAppsModal reads the first page of applications for companyId', async () => {
    mockLoadApplicationsPage.mockResolvedValue({
      applications: [{ id: 'app-1', firstName: 'Jane', lastName: 'Doe', status: 'new' }],
      next: null,
    });

    render(
      <ViewCompanyAppsModal
        companyId="co-1"
        companyName="Test Co"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(mockLoadApplicationsPage).toHaveBeenCalledWith('co-1');
    });
  });
});
