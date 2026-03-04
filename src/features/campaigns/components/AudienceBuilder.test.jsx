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
        matchCount: 10,
        isLoading: false,
        excludedPhones: new Set(),
    })
}));

vi.mock('./VirtualLeadList', () => ({
    default: ({ filters, excludedIds, onToggleExclusion }) => (
        <div data-testid="virtual-lead-list">
            <label>
                <input
                    type="checkbox"
                    checked={!excludedIds?.includes('lead1')}
                    onChange={() => onToggleExclusion('lead1')}
                />
                Alice Driver
            </label>
            <label>
                <input
                    type="checkbox"
                    checked={!excludedIds?.includes('lead2')}
                    onChange={() => onToggleExclusion('lead2')}
                />
                Bob Trucker
            </label>
        </div>
    )
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
        expect(screen.getByText('1 manually excluded')).toBeInTheDocument();
    });
});
