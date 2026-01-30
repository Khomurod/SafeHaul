import { render, screen, waitFor } from '@testing-library/react';
import { CampaignResultsTable } from './CampaignResultsTable';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { getDocs } from 'firebase/firestore';

// Mock Firebase
vi.mock('@lib/firebase', () => ({
    db: {}
}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    getDocs: vi.fn()
}));

describe('CampaignResultsTable', () => {
    it('renders logs correctly', async () => {
        const mockLogs = [
            { id: '1', recipientName: 'John Doe', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => new Date() } },
            { id: '2', recipientName: 'Jane Smith', recipientIdentity: '555-0101', status: 'failed', error: 'Invalid number', timestamp: { toDate: () => new Date() } }
        ];

        getDocs.mockResolvedValue({
            docs: mockLogs.map(data => ({ id: data.id, data: () => data }))
        });

        render(<CampaignResultsTable companyId="123" campaignId="abc" />);

        await waitFor(() => {
            expect(screen.getByText('John Doe')).toBeInTheDocument();
            expect(screen.getByText('Jane Smith')).toBeInTheDocument();
            expect(screen.getByText('Delivered')).toBeInTheDocument();
            expect(screen.getByText('Failed')).toBeInTheDocument();
            expect(screen.getByText('Invalid number')).toBeInTheDocument();
        });
    });

    it('handles empty state', async () => {
        getDocs.mockResolvedValue({ docs: [] });
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);
        await waitFor(() => {
            expect(screen.getByText('No messages sent yet.')).toBeInTheDocument();
        });
    });
});
