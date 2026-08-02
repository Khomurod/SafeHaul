import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import React from 'react';

// Stub the heavy children; we only assert the tab composes both for company admins.
vi.mock('@/features/super-admin/components/integrations/LineManager', () => ({
    LineManager: ({ companyId, companyName }) => (
        <div data-testid="line-manager">wallet:{companyId}:{companyName}</div>
    ),
}));
vi.mock('./NumberAssignmentManager', () => ({
    NumberAssignmentManager: ({ companyId }) => (
        <div data-testid="assignments">assign:{companyId}</div>
    ),
}));

import { SmsSettingsTab } from './SmsSettingsTab';

describe('SmsSettingsTab (company-admin SMS configuration)', () => {
    it('renders the Phone Line Wallet + Number Assignments for a company', () => {
        render(<SmsSettingsTab currentCompanyProfile={{ id: 'co1', companyName: 'Wenze Investment' }} />);
        expect(screen.getByTestId('line-manager')).toHaveTextContent('wallet:co1:Wenze Investment');
        expect(screen.getByTestId('assignments')).toHaveTextContent('assign:co1');
    });

    it('falls back to the name field when companyName is absent', () => {
        render(<SmsSettingsTab currentCompanyProfile={{ id: 'co1', name: 'Acme' }} />);
        expect(screen.getByTestId('line-manager')).toHaveTextContent('wallet:co1:Acme');
    });

    it('shows a guard message and renders neither child without a company id', () => {
        render(<SmsSettingsTab currentCompanyProfile={{}} />);
        expect(screen.queryByTestId('line-manager')).not.toBeInTheDocument();
        expect(screen.queryByTestId('assignments')).not.toBeInTheDocument();
        expect(screen.getByText(/Select a company/i)).toBeInTheDocument();
    });
});
