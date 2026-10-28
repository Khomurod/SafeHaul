import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import React from 'react';

// The page itself is covered by sms/SmsSettingsPage.*.test.jsx; this proves the tab hands it the company.
vi.mock('./sms/SmsSettingsPage', () => ({
    SmsSettingsPage: ({ companyId, companyName }) => (
        <div data-testid="sms-page">sms:{companyId}:{companyName}</div>
    ),
}));

import { SmsSettingsTab } from './SmsSettingsTab';

describe('SmsSettingsTab (company-admin SMS configuration)', () => {
    it('renders the SMS page for the company', () => {
        render(<SmsSettingsTab currentCompanyProfile={{ id: 'co1', companyName: 'Wenze Investment' }} />);
        expect(screen.getByTestId('sms-page')).toHaveTextContent('sms:co1:Wenze Investment');
    });

    it('falls back to the name field when companyName is absent', () => {
        render(<SmsSettingsTab currentCompanyProfile={{ id: 'co1', name: 'Acme' }} />);
        expect(screen.getByTestId('sms-page')).toHaveTextContent('sms:co1:Acme');
    });

    it('shows a guard message and no page without a company id', () => {
        render(<SmsSettingsTab currentCompanyProfile={{}} />);
        expect(screen.queryByTestId('sms-page')).not.toBeInTheDocument();
        expect(screen.getByText(/Select a company/i)).toBeInTheDocument();
    });
});
