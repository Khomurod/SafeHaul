import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DeleteCompanyModal } from './DeleteCompanyModal';
import { ViewCompanyAppsModal } from './ViewCompanyAppsModal';

const mockDeleteCompany = vi.fn(() => Promise.resolve({ data: { success: true } }));
const mockLoadApplications = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockDeleteCompany),
}));

vi.mock('@lib/firebase', () => ({
  functions: {},
}));

vi.mock('@features/applications/services/applicationService', () => ({
  loadApplications: (...args) => mockLoadApplications(...args),
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

  it('ViewCompanyAppsModal calls loadApplications for companyId', async () => {
    mockLoadApplications.mockResolvedValue([
      { id: 'app-1', firstName: 'Jane', lastName: 'Doe', status: 'new' },
    ]);

    render(
      <ViewCompanyAppsModal
        companyId="co-1"
        companyName="Test Co"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(mockLoadApplications).toHaveBeenCalledWith('co-1');
    });
  });
});
