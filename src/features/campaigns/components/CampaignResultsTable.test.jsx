import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CampaignResultsTable } from './CampaignResultsTable';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { collection, query, orderBy, limit, getDocs, getCountFromServer, startAfter } from 'firebase/firestore';

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
    startAfter: vi.fn((...a) => ({ __startAfter: a })),
    where: vi.fn((...a) => ({ __where: a })),
    getDocs: vi.fn(),
    getCountFromServer: vi.fn(async () => ({ data: () => ({ count: 0 }) })),
}));

const asSnapshot = (rows) => ({ docs: rows.map((data) => ({ id: data.id, data: () => data })) });

/** `n` delivered logs numbered from `from`, with fictional 555-01xx contacts. */
const recipients = (from, n) => Array.from({ length: n }, (_, i) => ({
    id: `log-${from + i}`,
    recipientName: `Recipient ${from + i + 1}`,
    recipientIdentity: `555-01${String((from + i) % 100).padStart(2, '0')}`,
    status: 'delivered',
    timestamp: { toDate: () => new Date() },
}));
const countOf = (count) => ({ data: () => ({ count }) });

beforeEach(() => {
    vi.resetAllMocks();
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
            expect(screen.getByText('Sent')).toBeInTheDocument();
            expect(screen.getByText('Not sent')).toBeInTheDocument();
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

    it('says Sent for a message the provider took and Not sent, with its reason, for any other', async () => {
        getDocs.mockResolvedValue(asSnapshot([
            { id: '1', recipientName: 'One', recipientIdentity: '555-0100', status: 'delivered', timestamp: { toDate: () => new Date() } },
            { id: '2', recipientName: 'Two', recipientIdentity: '555-0101', status: 'failed', error: 'Invalid number', timestamp: { toDate: () => new Date() } },
            { id: '3', recipientName: 'Three', recipientIdentity: '555-0102', status: 'queued', timestamp: { toDate: () => new Date() } },
            { id: '4', recipientName: 'Four', recipientIdentity: '555-0103', timestamp: { toDate: () => new Date() } },
        ]));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);
        await screen.findByText('One');

        expect(screen.getAllByText('Sent')).toHaveLength(1);
        expect(screen.getAllByText('Not sent')).toHaveLength(3);
        // "Delivered" claimed what the provider cannot tell us.
        expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
        expect(screen.getByText('Invalid number')).toBeInTheDocument();
        expect(screen.getAllByText('No reason was recorded')).toHaveLength(2);
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
        // The shared table inside the card, its rows capped at 400px under the header.
        const frame = screen.getByRole('table', { name: 'Recipient delivery log' }).closest('.ds-data-table');
        expect(frame).toHaveAttribute('data-embedded', 'true');
        expect(frame).toHaveAttribute('data-max-height', 'md');
        expect(screen.getByRole('rowheader', { name: 'Header Check' })).toBeInTheDocument();
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

    it("shows what RingCentral reported for each text, and reloads when asked", async () => {
        const at = { toDate: () => new Date() };
        getDocs.mockResolvedValue(asSnapshot([
            { id: '1', recipientName: 'Arrived', recipientIdentity: '555-0100', status: 'delivered', isSuccess: true, delivery: { state: 'delivered' }, timestamp: at },
            { id: '2', recipientName: 'Waiting', recipientIdentity: '555-0101', status: 'delivered', isSuccess: true, delivery: { state: 'pending' }, timestamp: at },
            {
                id: '3', recipientName: 'Refused', recipientIdentity: '555-0102', status: 'failed', isSuccess: false,
                error: 'Not delivered: RingCentral reported DeliveryFailed, code SMS-CAR-430.', delivery: { state: 'failed' }, timestamp: at,
            },
        ]));
        const { rerender } = render(<CampaignResultsTable companyId="123" campaignId="abc" refreshKey={0} />);
        await screen.findByText('Arrived');

        expect(screen.getByText('Delivered')).toBeInTheDocument();
        expect(screen.getByText('Awaiting delivery')).toBeInTheDocument();
        expect(screen.getByText('RingCentral has not confirmed delivery yet.')).toBeInTheDocument();
        expect(screen.getByText('Not delivered')).toBeInTheDocument();
        expect(screen.getByText('Not delivered: RingCentral reported DeliveryFailed, code SMS-CAR-430.')).toBeInTheDocument();
        expect(getDocs).toHaveBeenCalledTimes(1);

        getDocs.mockResolvedValue(asSnapshot([
            { id: '2', recipientName: 'Waiting', recipientIdentity: '555-0101', status: 'delivered', isSuccess: true, delivery: { state: 'unknown' }, timestamp: at },
        ]));
        rerender(<CampaignResultsTable companyId="123" campaignId="abc" refreshKey={1} />);
        await waitFor(() => expect(screen.getByText('Delivery unknown')).toBeInTheDocument());
        expect(getDocs).toHaveBeenCalledTimes(2);
    });

    it('keeps the newest results when an older read finishes after a reload', async () => {
        const at = { toDate: () => new Date() };
        let finishFirstRead;
        getDocs
            .mockImplementationOnce(() => new Promise((resolve) => { finishFirstRead = resolve; }))
            .mockResolvedValueOnce(asSnapshot([
                { id: '1', recipientName: 'Driver One', recipientIdentity: '555-0100', status: 'delivered', isSuccess: true, delivery: { state: 'delivered' }, timestamp: at },
            ]));
        const { rerender } = render(<CampaignResultsTable companyId="123" campaignId="abc" refreshKey={0} />);
        rerender(<CampaignResultsTable companyId="123" campaignId="abc" refreshKey={1} />);
        await screen.findByText('Delivered');

        finishFirstRead(asSnapshot([
            { id: '1', recipientName: 'Driver One', recipientIdentity: '555-0100', status: 'delivered', isSuccess: true, delivery: { state: 'pending' }, timestamp: at },
        ]));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(screen.getByText('Delivered')).toBeInTheDocument();
        expect(screen.queryByText('Awaiting delivery')).not.toBeInTheDocument();
    });

    it('says how many recipients exist and loads the next 200', async () => {
        const firstPage = asSnapshot(recipients(0, 200));
        getDocs
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(asSnapshot(recipients(200, 200)));
        getCountFromServer.mockResolvedValue(countOf(450));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);

        expect(await screen.findByText('Showing the newest 200 of 450 recipients.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load more recipients' }));

        expect(await screen.findByRole('rowheader', { name: 'Recipient 201' })).toBeInTheDocument();
        expect(screen.getByText('Showing the newest 400 of 450 recipients.')).toBeInTheDocument();
        expect(startAfter).toHaveBeenCalledWith(firstPage.docs[199]);
        expect(getDocs).toHaveBeenCalledTimes(2);
    });

    it('says nothing more when every recipient is already shown', async () => {
        getDocs.mockResolvedValue(asSnapshot(recipients(0, 200)));
        getCountFromServer.mockResolvedValue(countOf(200));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);

        await screen.findByRole('rowheader', { name: 'Recipient 200' });
        await waitFor(() => expect(getCountFromServer).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByText(/Showing the newest/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Load more recipients' })).not.toBeInTheDocument();
    });

    it('says the search looks only at the loaded recipients while a term is typed', async () => {
        getDocs.mockResolvedValue(asSnapshot(recipients(0, 200)));
        getCountFromServer.mockResolvedValue(countOf(1200));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);

        expect(await screen.findByText('Showing the newest 200 of 1,200 recipients.')).toBeInTheDocument();
        const search = screen.getByLabelText('Search recipients by name or contact');
        fireEvent.change(search, { target: { value: 'Recipient 7' } });
        expect(screen.getByText('Showing the newest 200 of 1,200 recipients. Search looks at these only.')).toBeInTheDocument();
        fireEvent.change(search, { target: { value: '' } });
        expect(screen.getByText('Showing the newest 200 of 1,200 recipients.')).toBeInTheDocument();
    });

    it('keeps the rows and says so when the next recipients cannot be loaded', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        getDocs
            .mockResolvedValueOnce(asSnapshot(recipients(0, 200)))
            .mockRejectedValueOnce(new Error('unavailable'));
        getCountFromServer.mockResolvedValue(countOf(450));
        render(<CampaignResultsTable companyId="123" campaignId="abc" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Load more recipients' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('More recipients could not be loaded.');
        expect(screen.getByRole('rowheader', { name: 'Recipient 200' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more recipients' })).toBeEnabled();
        consoleError.mockRestore();
    });
});
