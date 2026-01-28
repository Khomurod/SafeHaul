import { render, screen, fireEvent } from '@testing-library/react';
import { AudienceBuilder } from './AudienceBuilder';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

// Mocks
vi.mock('@/shared/hooks/useCompanyTeam', () => ({
    useCompanyTeam: () => ({
        team: [
            { id: 'recruiter1', name: 'John Doe' },
            { id: 'recruiter2', name: 'Jane Smith' }
        ],
        isLoading: false
    })
}));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentUser: { uid: 'user1' } })
}));

const mockSetFilters = vi.fn();

vi.mock('../hooks/useCampaignTargeting', () => ({
    useCampaignTargeting: () => ({
        previewLeads: [
            { id: 'lead1', firstName: 'Alice', lastName: 'Driver', phone: '111' },
            { id: 'lead2', firstName: 'Bob', lastName: 'Trucker', phone: '222' }
        ],
        isPreviewLoading: false,
        matchCount: 10,
        previewError: null,
        setFilters: mockSetFilters
    })
}));

describe('AudienceBuilder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders and handles exclusions', () => {
        const handleChange = vi.fn();
        // Initial filters prop
        const filters = { limit: 100, excludedLeadIds: [] };

        const { rerender } = render(<AudienceBuilder companyId="123" filters={filters} onChange={handleChange} />);

        // Check if leads are displayed
        expect(screen.getByText('Alice Driver')).toBeInTheDocument();
        expect(screen.getByText('Bob Trucker')).toBeInTheDocument();

        // Check initial selection count
        expect(screen.getByText('10')).toBeInTheDocument(); // Match count display
        expect(screen.getByText('Recipients Selected')).toBeInTheDocument();

        // Find checkboxes
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(2);

        // Alice is first. Expect checked.
        expect(checkboxes[0]).toBeChecked();

        // Uncheck Alice
        fireEvent.click(checkboxes[0]);

        // Expect handleChange to be called with excludedLeadIds containing 'lead1'
        expect(handleChange).toHaveBeenCalledWith(
            expect.objectContaining({
                excludedLeadIds: ['lead1']
            }),
            10
        );

        // Simulate parent updating props (as real app would)
        const newFilters = { ...filters, excludedLeadIds: ['lead1'] };
        rerender(<AudienceBuilder companyId="123" filters={newFilters} onChange={handleChange} />);

        // Now Alice should be unchecked
        const newCheckboxes = screen.getAllByRole('checkbox');
        expect(newCheckboxes[0]).not.toBeChecked();

        // Bob should still be checked
        expect(newCheckboxes[1]).toBeChecked();

        // Check if "excluded manually" text appears
        expect(screen.getByText('1 excluded manually')).toBeInTheDocument();
    });
});
