import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanyCampaignsPage } from './CompanyCampaignsPage';
import { useData } from '@/context/DataContext';

vi.mock('@/context/DataContext', () => ({
  useData: vi.fn(),
}));

vi.mock('../CampaignsDashboard', () => ({
  CampaignsDashboard: ({ companyId }) => <div data-testid="campaigns-dashboard">{companyId}</div>,
}));

describe('CompanyCampaignsPage', () => {
  it('shows a guard message when no company is selected', () => {
    useData.mockReturnValue({ currentCompanyProfile: null });

    render(<CompanyCampaignsPage />);

    expect(screen.getByText(/please select a company/i)).toBeInTheDocument();
  });

  it('styles the guard message with a design-system token, not a legacy palette class', () => {
    useData.mockReturnValue({ currentCompanyProfile: null });

    render(<CompanyCampaignsPage />);

    const message = screen.getByText(/please select a company/i);
    expect(message).toHaveClass('text-ds-content-secondary');
    expect(message.className).not.toMatch(/text-gray-/);
  });

  it('mounts campaigns dashboard with selected company id', () => {
    useData.mockReturnValue({ currentCompanyProfile: { id: 'company-123' } });

    render(<CompanyCampaignsPage />);

    expect(screen.getByTestId('campaigns-dashboard')).toHaveTextContent('company-123');
  });
});
