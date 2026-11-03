import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CampaignsDashboard } from './CampaignsDashboard';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { useData } from '@/context/DataContext';

// Mocks
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: vi.fn(() => ({ showSuccess: vi.fn(), showError: vi.fn() }))
}));

vi.mock('@/context/DataContext', () => ({
    useData: vi.fn(() => ({
        currentCompanyProfile: { features: { campaignsEnabled: true } }
    }))
}));

// Mock Firestore. Returns are opaque objects the tests can inspect: doc() surfaces
// its path, collection() records its segments, and every onSnapshot hands back a
// tracked unsubscribe so listener cleanup can be asserted. The server totals
// answer from `serverTotals`, which a test may set and `beforeEach` resets.
const mockOnSnapshot = vi.fn();
const mockDeleteDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockCollection = vi.fn((...a) => ({ __collection: a }));
const mockUnsubscribes = [];
const serverTotals = {};
const resetServerTotals = () => Object.assign(serverTotals, { count: 0, outreach: 0, outreachError: null });
resetServerTotals();
const mockGetCountFromServer = vi.fn(async () => ({ data: () => ({ count: serverTotals.count }) }));
const mockGetAggregateFromServer = vi.fn(async () => {
    if (serverTotals.outreachError) throw serverTotals.outreachError;
    return { data: () => ({ outreach: serverTotals.outreach }) };
});
vi.mock('firebase/firestore', () => ({
    collection: (...a) => mockCollection(...a),
    query: (...a) => ({ __query: a }),
    orderBy: (...a) => ({ __orderBy: a }),
    limit: (...a) => ({ __limit: a }),
    where: (...a) => ({ __where: a }),
    sum: (...a) => ({ __sum: a }),
    getCountFromServer: (...a) => mockGetCountFromServer(...a),
    getAggregateFromServer: (...a) => mockGetAggregateFromServer(...a),
    onSnapshot: (q, cb, fail) => {
        mockOnSnapshot(q, cb, fail);
        const unsub = vi.fn();
        mockUnsubscribes.push(unsub);
        return unsub;
    },
    doc: (_db, ...segs) => ({ path: segs.join('/') }),
    setDoc: (...a) => mockSetDoc(...a),
    deleteDoc: (...args) => mockDeleteDoc(...args),
    serverTimestamp: () => '__serverTimestamp__'
}));

// Which of the dashboard's listeners a query belongs to: the drafts, the live
// sessions (the only one filtered by status) or the session history.
const listenerKind = (q) => {
    const text = JSON.stringify(q);
    if (text.includes('campaign_drafts')) return 'drafts';
    return text.includes('__where') ? 'live' : 'history';
};
// The `limit` a listener's query carries, if any.
const limitOf = (q) => q?.__query.find((part) => part.__limit)?.__limit[0];
const queriesOf = (kind) => mockOnSnapshot.mock.calls.map(([q]) => q).filter((q) => listenerKind(q) === kind);

const mockCancelCallable = vi.fn().mockResolvedValue({ data: { success: true } });
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (...args) => {
        if (name === 'cancelBulkSession') return mockCancelCallable(...args);
        throw new Error(`Unexpected callable in test: ${name}`);
    },
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    functions: {}
}));

// Mock child components — surface the cancel/delete affordances so the
// dashboard handlers can be exercised, and record the props each card receives
// so the frozen prop contract can be verified.
const mockCardProps = [];
vi.mock('./components/CampaignCard', () => ({
    CampaignCard: (props) => {
        const { campaign, onCancel, onDelete, onClick } = props;
        mockCardProps.push(props);
        return (
            <div data-testid="campaign-card">
                {campaign.name} - {campaign.status}
                {onClick && <button onClick={onClick}>open {campaign.id}</button>}
                {onCancel && (
                    <button onClick={() => onCancel(campaign)}>cancel {campaign.id}</button>
                )}
                {onDelete && (
                    <button onClick={() => onDelete(campaign)}>delete {campaign.id}</button>
                )}
            </div>
        );
    }
}));

vi.mock('./CampaignEditor', () => ({
    CampaignEditor: () => <div>Editor</div>
}));

vi.mock('./components/CampaignDetails', () => ({
    CampaignDetails: ({ campaign, onClose }) => (
        <div data-testid="campaign-details">
            {campaign.name}: {campaign.status}, {campaign.progress?.processedCount ?? 0} sent
            <button onClick={onClose}>close details</button>
        </div>
    ),
}));

describe('CampaignsDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches and displays campaigns and sessions', async () => {
        const callbacks = {};
        mockOnSnapshot.mockImplementation((q, cb) => {
            callbacks[listenerKind(q)] = cb;
        });

        render(<CampaignsDashboard companyId="123" />);

        // Simulate data update
        const draftDocs = [
            { id: 'd1', data: () => ({ name: 'Draft 1', status: 'draft', updatedAt: { toDate: () => new Date() } }) }
        ];
        const sessionDocs = [
            {
                id: 's1',
                data: () => ({
                    name: 'Live 1',
                    status: 'active',
                    createdAt: { toDate: () => new Date() },
                    progress: { totalCount: 100, processedCount: 50 }
                })
            }
        ];

        // Trigger updates
        await React.act(async () => {
            callbacks.drafts({ docs: draftDocs });
            callbacks.history({ docs: sessionDocs });
        });

        // Check if Drafts are shown by default
        await waitFor(() => {
            expect(screen.getByText('Draft 1 - draft')).toBeInTheDocument();
        });

        // Switch to History/Live tab
        const historyTab = screen.getByText(/Past Sequences/i); // Or whatever the text is "Past Sequences"
        fireEvent.click(historyTab);

        // Check if Sessions are shown
        await waitFor(() => {
            expect(screen.getByText('Live 1 - active')).toBeInTheDocument();
        });

        // Check Stats (Live Campaigns = 1)
        expect(screen.getByText('1')).toBeInTheDocument(); // Value for Live Campaigns
        expect(screen.getByText('50')).toBeInTheDocument(); // Value for Total Outreach
    });
});

describe('CampaignsDashboard cancel vs delete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCancelCallable.mockResolvedValue({ data: { success: true } });
        // happy-dom does not implement confirm; provide one.
        window.confirm = vi.fn(() => true);
    });

    async function renderWithSessions(sessions) {
        const callbacks = {};
        mockOnSnapshot.mockImplementation((q, cb) => {
            callbacks[listenerKind(q)] = cb;
        });

        render(<CampaignsDashboard companyId="co1" />);
        await React.act(async () => {
            callbacks.drafts({ docs: [] });
            callbacks.history({
                docs: sessions.map((s) => ({ id: s.id, data: () => s })),
            });
        });
        fireEvent.click(screen.getByText(/Past Sequences/i));
    }

    it.each(['queued', 'active'])(
        'cancels a %s session through cancelBulkSession instead of deleting the doc',
        async (status) => {
            await renderWithSessions([
                { id: 's1', name: 'Live One', status, createdAt: { toDate: () => new Date() } },
            ]);

            fireEvent.click(screen.getByText('cancel s1'));

            // The blocking `window.confirm` is gone: the guard is now the shared
            // accessible dialog, and nothing fires until it is confirmed.
            const dialog = await screen.findByRole('dialog', { name: 'Cancel "Live One"?' });
            expect(window.confirm).not.toHaveBeenCalled();
            expect(mockCancelCallable).not.toHaveBeenCalled();

            fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel campaign' }));

            await waitFor(() => {
                expect(mockCancelCallable).toHaveBeenCalledWith({ companyId: 'co1', sessionId: 's1' });
            });
            expect(mockDeleteDoc).not.toHaveBeenCalled();
        },
    );

    it('refuses to delete a live session outright', async () => {
        await renderWithSessions([
            { id: 's1', name: 'Live One', status: 'active', createdAt: { toDate: () => new Date() } },
        ]);

        fireEvent.click(screen.getByText('delete s1'));

        // The live-session backstop runs before the dialog opens, so a live
        // campaign never reaches a destructive confirmation at all.
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        await waitFor(() => {
            expect(mockDeleteDoc).not.toHaveBeenCalled();
        });
        expect(mockCancelCallable).not.toHaveBeenCalled();
    });

    it('still allows deleting a terminal (cancelled) session record', async () => {
        await renderWithSessions([
            { id: 's2', name: 'Old One', status: 'cancelled', createdAt: { toDate: () => new Date() } },
        ]);

        fireEvent.click(screen.getByText('delete s2'));

        const dialog = await screen.findByRole('dialog', { name: 'Delete "Old One"?' });
        expect(window.confirm).not.toHaveBeenCalled();
        expect(mockDeleteDoc).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete record' }));

        await waitFor(() => {
            expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
        });
        expect(mockCancelCallable).not.toHaveBeenCalled();
    });
});

// Artificial lists for the windowing tests, newest first.
const completedSessions = (n, { processedCount = 1 } = {}) => Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    name: `Session ${i}`,
    status: 'completed',
    createdAt: { toDate: () => new Date(2026, 0, 1, 0, n - i) },
    progress: { processedCount, totalCount: processedCount },
}));
const draftItems = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, name: `Draft ${i}`, status: 'draft' }));

// --- Design-system shell migration coverage -------------------------------
// These tests freeze the migrated presentation shell (header, stat cards,
// accessible tablist, loading/empty states, card grid) and re-verify the
// behavioral contracts the migration must preserve.
describe('CampaignsDashboard shell', () => {
    let callbacks;
    let failures;

    beforeEach(() => {
        vi.clearAllMocks();
        resetServerTotals();
        mockUnsubscribes.length = 0;
        mockCardProps.length = 0;
        // Capture each listener's callbacks by what it listens to; a re-subscription replaces them.
        callbacks = {};
        failures = {};
        mockOnSnapshot.mockImplementation((q, cb, fail) => {
            callbacks[listenerKind(q)] = cb;
            failures[listenerKind(q)] = fail;
        });
        // Default to the enabled feature; the paywall test overrides this.
        useData.mockReturnValue({
            currentCompanyProfile: { features: { campaignsEnabled: true } },
        });
        window.confirm = vi.fn(() => true);
    });

    const snapshot = (items) => ({ docs: items.map((item) => ({ id: item.id, data: () => item })) });

    async function renderReady({ drafts = [], sessions = [], live, companyId = 'co-1' } = {}) {
        render(<CampaignsDashboard companyId={companyId} />);
        await React.act(async () => {
            callbacks.drafts?.(snapshot(drafts));
            callbacks.history?.(snapshot(sessions));
            if (live) callbacks.live?.(snapshot(live));
        });
    }

    it('renders the paywall and registers no listeners when the feature is disabled', () => {
        useData.mockReturnValue({
            currentCompanyProfile: { features: { campaignsEnabled: false } },
        });

        render(<CampaignsDashboard companyId="co-1" />);

        expect(
            screen.getByRole('heading', { name: 'Campaigns Module Unavailable' }),
        ).toBeInTheDocument();
        // No dashboard shell, and no Firestore listeners attached.
        expect(screen.queryByRole('heading', { name: 'Campaigns' })).not.toBeInTheDocument();
        expect(mockOnSnapshot).not.toHaveBeenCalled();
        expect(mockGetCountFromServer).not.toHaveBeenCalled();
        expect(mockGetAggregateFromServer).not.toHaveBeenCalled();
    });

    it('attaches the drafts, sessions and live-sessions listeners on the exact collections and cleans them up', () => {
        const { unmount } = render(<CampaignsDashboard companyId="co-1" />);

        expect(mockOnSnapshot).toHaveBeenCalledTimes(3);
        expect(queriesOf('drafts')).toHaveLength(1);
        expect(queriesOf('history')).toHaveLength(1);
        expect(queriesOf('live')).toHaveLength(1);
        expect(mockCollection).toHaveBeenCalledWith(expect.anything(), 'companies', 'co-1', 'campaign_drafts');
        expect(mockCollection).toHaveBeenCalledWith(expect.anything(), 'companies', 'co-1', 'bulk_sessions');
        expect(mockUnsubscribes).toHaveLength(3);

        unmount();

        mockUnsubscribes.forEach((unsub) => expect(unsub).toHaveBeenCalledTimes(1));
    });

    it('the drafts and sessions lists ask for the newest 50', () => {
        render(<CampaignsDashboard companyId="co-1" />);

        expect(limitOf(queriesOf('drafts')[0])).toBe(50);
        expect(limitOf(queriesOf('history')[0])).toBe(50);
    });

    it('a live session older than the newest 50 is still listed and cancellable', async () => {
        serverTotals.count = 120;
        await renderReady({
            sessions: completedSessions(50),
            live: [{ id: 'old-live', name: 'Old Live', status: 'paused', createdAt: { toDate: () => new Date(2025, 0, 1) } }],
        });
        fireEvent.click(screen.getByRole('tab', { name: /Past Sequences/i }));

        const cards = screen.getAllByTestId('campaign-card');
        expect(cards).toHaveLength(51);
        expect(cards.at(-1)).toHaveTextContent('Old Live - paused');
        fireEvent.click(screen.getByText('cancel old-live'));
        expect(await screen.findByRole('dialog', { name: 'Cancel "Old Live"?' })).toBeInTheDocument();
    });

    it('shows the server sum as Total Outreach once the history holds more than one window', async () => {
        serverTotals.count = 120;
        serverTotals.outreach = 4321;
        await renderReady({ sessions: completedSessions(50) });

        const outreach = document.getElementById('campaigns-stat-outreach');
        await waitFor(() => expect(outreach).toHaveTextContent('4321'));
        expect(mockGetAggregateFromServer).toHaveBeenCalledWith(
            { __query: [{ __collection: [expect.anything(), 'companies', 'co-1', 'bulk_sessions'] }] },
            { outreach: { __sum: ['progress.processedCount'] } },
        );
    });

    it('shows — as Total Outreach when the server sum fails, never the sum of the loaded rows', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        serverTotals.count = 120;
        serverTotals.outreachError = new Error('unavailable');
        await renderReady({ sessions: completedSessions(50, { processedCount: 10 }) });

        const outreach = document.getElementById('campaigns-stat-outreach');
        await waitFor(() => expect(outreach).toHaveTextContent('—'));
        expect(outreach).not.toHaveTextContent('500');
        consoleError.mockRestore();
    });

    it('says how many campaigns exist and loads older ones with a window of 100', async () => {
        serverTotals.count = 120;
        await renderReady({ sessions: completedSessions(50) });
        fireEvent.click(screen.getByRole('tab', { name: /Past Sequences/i }));

        expect(
            await screen.findByText('Showing 50 of 120 campaigns, newest first. Live campaigns are always listed.'),
        ).toBeInTheDocument();
        expect(mockGetCountFromServer).toHaveBeenCalledWith({
            __query: [
                { __collection: [expect.anything(), 'companies', 'co-1', 'bulk_sessions'] },
                { __orderBy: ['createdAt', 'desc'] },
            ],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Load older campaigns' }));

        expect(queriesOf('history')).toHaveLength(2);
        expect(limitOf(queriesOf('history').at(-1))).toBe(100);
    });

    it('says how many drafts exist, loads 50 more and then says all are shown', async () => {
        serverTotals.count = 60;
        await renderReady({ drafts: draftItems(50) });

        expect(await screen.findByText('Showing the newest 50 of 60 drafts.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load more drafts' }));
        expect(limitOf(queriesOf('drafts').at(-1))).toBe(100);

        await React.act(async () => { callbacks.drafts(snapshot(draftItems(60))); });

        expect(screen.getAllByTestId('campaign-card')).toHaveLength(60);
        expect(screen.getByText('All 60 drafts are shown.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Load more drafts' })).not.toBeInTheDocument();
    });

    it('shows a danger notice with Try again when the drafts cannot be loaded, not "Synchronizing…" forever', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<CampaignsDashboard companyId="co-1" />);
        await React.act(async () => { failures.drafts?.(new Error('permission-denied')); });

        expect(screen.queryByText(/Synchronizing/i)).not.toBeInTheDocument();
        expect(screen.getByText('Campaign drafts could not be loaded.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(queriesOf('drafts')).toHaveLength(2);
        await React.act(async () => { callbacks.drafts(snapshot(draftItems(1))); });
        expect(screen.getByText('Draft 0 - draft')).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('shows the notice on Past Sequences when the live campaigns cannot be loaded, and retries both reads', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        await renderReady({ sessions: completedSessions(2) });
        await React.act(async () => { failures.live?.(new Error('unavailable')); });
        fireEvent.click(screen.getByRole('tab', { name: /Past Sequences/i }));

        expect(screen.getByText('Campaigns could not be loaded.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(queriesOf('history')).toHaveLength(2);
        expect(queriesOf('live')).toHaveLength(2);
        consoleError.mockRestore();
    });

    it('computes live-campaign and total-outreach stats from the sessions', async () => {
        await renderReady({
            sessions: [
                { id: 's1', status: 'active', progress: { processedCount: 10 } },
                { id: 's2', status: 'queued', progress: { processedCount: 5 } },
                { id: 's3', status: 'scheduled', progress: { processedCount: 0 } },
                { id: 's4', status: 'completed', progress: { processedCount: 20 } },
            ],
        });

        // liveCount = active + queued + scheduled = 3; totalOutreach = 10+5+0+20 = 35.
        const live = document.getElementById('campaigns-stat-live');
        const outreach = document.getElementById('campaigns-stat-outreach');
        expect(live).toHaveTextContent('Live Campaigns');
        expect(live).toHaveTextContent('3');
        expect(outreach).toHaveTextContent('Total Outreach');
        expect(outreach).toHaveTextContent('35');
    });

    it('exposes an accessible header, tablist and primary action', async () => {
        await renderReady();

        expect(screen.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeInTheDocument();
        const tablist = screen.getByRole('tablist', { name: 'Campaign views' });
        expect(tablist).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /Create Campaign/i })).toBeInTheDocument();
    });

    it('switches tabs and reflects the selection programmatically', async () => {
        await renderReady({
            drafts: [{ id: 'd1', name: 'Draft A', status: 'draft' }],
            sessions: [{ id: 's1', name: 'Session A', status: 'completed' }],
        });

        const draftsTab = screen.getByRole('tab', { name: /Drafts/i });
        const historyTab = screen.getByRole('tab', { name: /Past Sequences/i });

        expect(draftsTab).toHaveAttribute('aria-selected', 'true');
        expect(historyTab).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByText('Draft A - draft')).toBeInTheDocument();
        expect(screen.queryByText('Session A - completed')).not.toBeInTheDocument();

        fireEvent.click(historyTab);

        expect(historyTab).toHaveAttribute('aria-selected', 'true');
        expect(draftsTab).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByText('Session A - completed')).toBeInTheDocument();
        expect(screen.queryByText('Draft A - draft')).not.toBeInTheDocument();
    });

    it('supports arrow-key navigation across the tabs', async () => {
        await renderReady();

        const draftsTab = screen.getByRole('tab', { name: /Drafts/i });
        const historyTab = screen.getByRole('tab', { name: /Past Sequences/i });

        draftsTab.focus();
        fireEvent.keyDown(draftsTab, { key: 'ArrowRight' });
        expect(historyTab).toHaveAttribute('aria-selected', 'true');
        expect(historyTab).toHaveFocus();

        fireEvent.keyDown(historyTab, { key: 'ArrowLeft' });
        expect(draftsTab).toHaveAttribute('aria-selected', 'true');
        expect(draftsTab).toHaveFocus();

        fireEvent.keyDown(draftsTab, { key: 'End' });
        expect(historyTab).toHaveFocus();
        fireEvent.keyDown(historyTab, { key: 'Home' });
        expect(draftsTab).toHaveFocus();
    });

    it('writes the exact new-campaign draft document and opens the editor', async () => {
        render(<CampaignsDashboard companyId="co-123" />);

        await React.act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Create Campaign/i }));
        });

        await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));
        const [ref, payload] = mockSetDoc.mock.calls[0];
        expect(ref.path).toMatch(/^companies\/co-123\/campaign_drafts\/camp_\d+$/);
        expect(payload).toEqual({
            name: 'Untitled Campaign',
            status: 'draft',
            createdAt: '__serverTimestamp__',
            updatedAt: '__serverTimestamp__',
            filters: {},
            messageConfig: { method: 'sms', message: '' },
        });
        expect(screen.getByText('Editor')).toBeInTheDocument();
    });

    it('announces a loading status before the first snapshot resolves', () => {
        render(<CampaignsDashboard companyId="co-1" />);

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent(/Synchronizing/i);
    });

    it('renders empty-state headings and a create action per tab', async () => {
        await renderReady({ drafts: [], sessions: [] });

        expect(screen.getByRole('heading', { name: 'No Drafts Found' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Define Initial Campaign' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: /Past Sequences/i }));
        expect(screen.getByRole('heading', { name: 'No Campaigns Found' })).toBeInTheDocument();
    });

    it('passes the frozen props to CampaignCard for drafts and sessions', async () => {
        await renderReady({
            drafts: [{ id: 'd1', name: 'Draft A', status: 'draft' }],
            sessions: [{ id: 's1', name: 'Session A', status: 'completed' }],
        });

        const draftProps = mockCardProps.find((p) => p.campaign.id === 'd1');
        expect(draftProps.onCancel).toBeUndefined(); // drafts cannot be cancelled
        expect(typeof draftProps.onClick).toBe('function');
        expect(typeof draftProps.onDelete).toBe('function');
        expect(typeof draftProps.onViewReport).toBe('function');

        fireEvent.click(screen.getByRole('tab', { name: /Past Sequences/i }));

        const sessionProps = mockCardProps.find((p) => p.campaign.id === 's1');
        expect(typeof sessionProps.onCancel).toBe('function'); // sessions offer Cancel
        expect(typeof sessionProps.onDelete).toBe('function');
        expect(typeof sessionProps.onViewReport).toBe('function');
    });

    it('has no accessibility violations in the loaded dashboard', async () => {
        await renderReady({ drafts: [{ id: 'd1', name: 'Draft A', status: 'draft' }] });

        // The "region" landmark rule is scoped out: this dashboard renders inside
        // the company shell's <main> landmark in the app (and in the e2e axe pass),
        // which is absent in this isolated unit render.
        const results = await axe(document.body, {
            rules: { region: { enabled: false } },
        });
        expect(results.violations).toEqual([]);
    });
});

// The details of a sent campaign follow its live session document.
describe('CampaignsDashboard campaign details', () => {
    let callbacks;

    beforeEach(() => {
        vi.clearAllMocks();
        callbacks = {};
        mockOnSnapshot.mockImplementation((q, cb) => {
            callbacks[listenerKind(q)] = cb;
        });
        useData.mockReturnValue({ currentCompanyProfile: { features: { campaignsEnabled: true } } });
    });

    const session = (processedCount, status = 'active') => ({
        id: 's1',
        name: 'Spring drive',
        status,
        createdAt: { toDate: () => new Date() },
        progress: { totalCount: 100, processedCount },
    });
    const emit = (sessions) => React.act(async () => {
        callbacks.history({ docs: sessions.map((s) => ({ id: s.id, data: () => s })) });
    });
    const openDetails = async () => {
        render(<CampaignsDashboard companyId="co1" />);
        await React.act(async () => { callbacks.drafts({ docs: [] }); });
        await emit([session(10)]);
        fireEvent.click(screen.getByText(/Past Sequences/i));
        fireEvent.click(screen.getByText('open s1'));
    };

    it('updates the open details as the session sends', async () => {
        await openDetails();
        expect(screen.getByTestId('campaign-details')).toHaveTextContent('Spring drive: active, 10 sent');

        await emit([session(60)]);
        expect(screen.getByTestId('campaign-details')).toHaveTextContent('Spring drive: active, 60 sent');

        await emit([session(100, 'completed')]);
        expect(screen.getByTestId('campaign-details')).toHaveTextContent('Spring drive: completed, 100 sent');
    });

    it('goes back to the list when the open session is deleted', async () => {
        await openDetails();

        await emit([]);

        expect(screen.queryByTestId('campaign-details')).not.toBeInTheDocument();
        expect(screen.getByRole('tablist')).toBeInTheDocument();
    });
});
