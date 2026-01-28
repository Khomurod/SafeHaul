import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampaignDetails } from './CampaignDetails';
import { describe, it, expect, vi } from 'vitest';

describe('CampaignDetails', () => {
    const mockCampaign = {
        id: '123',
        name: 'Test Campaign',
        status: 'active',
        createdAt: { toDate: () => new Date('2023-01-01') },
        updatedAt: { toDate: () => new Date('2023-01-02') },
        progress: {
            processedCount: 50,
            totalCount: 100,
            failedCount: 5
        },
        messageConfig: {
            message: 'Hello World',
            method: 'SMS'
        }
    };

    it('renders campaign details correctly', () => {
        render(<CampaignDetails campaign={mockCampaign} onClose={() => {}} />);

        expect(screen.getByText('Test Campaign')).toBeInTheDocument();
        expect(screen.getByText('active')).toBeInTheDocument();
        expect(screen.getByText('50 / 100 leads processed')).toBeInTheDocument();
        expect(screen.getByText('Hello World')).toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
        const handleClose = vi.fn();
        render(<CampaignDetails campaign={mockCampaign} onClose={handleClose} />);

        // Use a more generic selector since the button has an icon
        const closeButton = screen.getByRole('button', { name: '' });
        // Or find by class or just the first button
        // In the component: <button onClick={onClose} ...> <ArrowLeft ... /> </button>
        // It's likely the first button in the header.

        // Let's rely on the fact that it's the back button
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[0]);

        expect(handleClose).toHaveBeenCalledTimes(1);
    });
});
