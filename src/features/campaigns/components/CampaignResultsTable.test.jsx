import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CampaignResultsTable } from './CampaignResultsTable';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

// Mock Firebase. Query builders return inspectable objects so the exact
// Firestore read (path, order, limit) can be asserted; getDocs is controlled
// per test. All fixtures use artificial names and fictional 555-01xx contacts —
// never real recipient contact data.
vi.mock('@lib/firebase', () => ({
    db: {}
}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn((...a) => ({ __collection: a })),
    query: vi.fn((...a) => ({ __query: a })),
    orderBy: vi.fn((...a) => ({ __orderBy: a })),
    limit: vi.fn((...a) => ({ __limit: a })),
    getDocs: vi.fn()
}));

const asSnapshot = (rows) => ({ docs: rows.map((data) => ({ id: data.id, data: () => data })) });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CampaignResultsTable', () => {
    it('renders logs correctly', async () => {
        const mockLogs = [
            { id: '1', recipientName: 'John Doe', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => new Date() } },
            { id: '2', recipientName: 'Jane Smith', recipientIdentity: '555-0101', status: 'failed', error: 'Invalid number', timestamp: { toDate: () => new Date() } }
        ];

        getDocs.mockResolvedValue(asSnapshot(mockLogs));

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

    it('issues the exact Firestore query once (path, order, limit, getDocs)', async () => {
        getDocs.mockResolvedValue({ docs: [] });
        render(<CampaignResultsTable companyId="co-9" campaignId="camp-9" />);

        await waitFor(() => expect(getDocs).toHaveBeenCalledTimes(1));
        expect(collection).toHaveBeenCalledWith({}, 'companies', 'co-9', 'bulk_sessions', 'camp-9', 'logs');
        expect(orderBy).toHaveBeenCalledWith('timestamp', 'desc');
        expect(limit).toHaveBeenCalledWith(200);
        // The query is built from the collection, order and limit clauses.
        expect(query).toHaveBeenCalledWith(
            { __collection: [{}, 'companies', 'co-9', 'bulk_sessions', 'camp-9', 'logs'] },
            { __orderBy: ['timestamp', 'desc'] },
            { __limit: [200] },
        );
    });

    it.each([
        ['missing companyId', undefined, 'abc'],
        ['missing campaignId', '123', undefined],
    ])('does not query when %s', async (_label, companyId, campaignId) => {
        render(<CampaignResultsTable companyId={companyId} campaignId={campaignId} />);
        await waitFor(() => expect(screen.getByText('No messages sent yet.')).toBeInTheDocument());
        expect(getDocs).not.toHaveBeenCalled();
    });

    it('announces the loading state before the read resolves', async () => {
        let resolveDocs;
        getDocs.mockReturnValue(new Promise((resolve) => { resolveDocs = resolve; }));

        render(<CampaignResultsTable companyId="123" campaignId="abc" />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading detailed results...');

        await React.act(async () => { resolveDocs({ docs: [] }); });
        await waitFor(() => expect(screen.getByText('No messages sent yet.')).toBeInTheDocument());
    });

    it('filters across recipientName (case-insensitive) and recipientIdentity (substring)', async () => {
        getDocs.mockResolvedValue(asSnapshot([
            { id: '1', recipientName: 'Artificial Driver', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => new Date() } },
            { id: '2', recipientName: 'Second Person', recipientIdentity: '555-0199', status: 'delivered', timestamp: { toDate: () => new Date() } },
        ]));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);
        await screen.findByText('Artificial Driver');

        const search = screen.getByLabelText('Search recipients by name or contact');

        // Case-insensitive name match.
        fireEvent.change(search, { target: { value: 'artificial' } });
        expect(screen.getByText('Artificial Driver')).toBeInTheDocument();
        expect(screen.queryByText('Second Person')).not.toBeInTheDocument();

        // Substring match against the contact identity.
        fireEvent.change(search, { target: { value: '0199' } });
        expect(screen.getByText('Second Person')).toBeInTheDocument();
        expect(screen.queryByText('Artificial Driver')).not.toBeInTheDocument();

        // No matches shows the search-empty row without losing the table chrome.
        fireEvent.change(search, { target: { value: 'ZZZ-no-match' } });
        expect(screen.getByText('No recipients match your search.')).toBeInTheDocument();
        expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('maps delivered to Delivered and every other status to Failed', async () => {
        getDocs.mockResolvedValue(asSnapshot([
            { id: '1', recipientName: 'One', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => new Date() } },
            { id: '2', recipientName: 'Two', recipientIdentity: '555-0101', status: 'failed', timestamp: { toDate: () => new Date() } },
            { id: '3', recipientName: 'Three', recipientIdentity: '555-0102', status: 'queued', timestamp: { toDate: () => new Date() } },
            { id: '4', recipientName: 'Four', recipientIdentity: '555-0103', timestamp: { toDate: () => new Date() } },
        ]));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);
        await screen.findByText('One');

        expect(screen.getAllByText('Delivered')).toHaveLength(1);
        expect(screen.getAllByText('Failed')).toHaveLength(3);
    });

    it('formats the timestamp and falls back to Pending when absent', async () => {
        const sent = new Date('2026-07-24T15:30:00');
        const expected = sent.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        getDocs.mockResolvedValue(asSnapshot([
            { id: '1', recipientName: 'Timed', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => sent } },
            { id: '2', recipientName: 'Untimed', recipientIdentity: '555-0101', status: 'delivered' },
        ]));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);
        await screen.findByText('Timed');

        expect(screen.getByText(expected)).toBeInTheDocument();
        expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('shows a labelled search field and an accessible table with column headers', async () => {
        getDocs.mockResolvedValue(asSnapshot([
            { id: '1', recipientName: 'Header Check', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => new Date() } },
        ]));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);
        await screen.findByText('Header Check');

        expect(screen.getByLabelText('Search recipients by name or contact')).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'Recipient delivery log' })).toBeInTheDocument();
        ['Recipient', 'Contact', 'Status', 'Time'].forEach((name) =>
            expect(screen.getByRole('columnheader', { name })).toBeInTheDocument(),
        );
    });

    it('has no accessibility violations with results rendered', async () => {
        getDocs.mockResolvedValue(asSnapshot([
            { id: '1', recipientName: 'Axe One', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => new Date() } },
            { id: '2', recipientName: 'Axe Two', recipientIdentity: '555-0101', status: 'failed', error: 'Carrier rejected', timestamp: { toDate: () => new Date() } },
        ]));
        const { container } = render(<CampaignResultsTable companyId="123" campaignId="abc" />);
        await screen.findByText('Axe One');

        expect((await axe(container)).violations).toEqual([]);
    });
});
