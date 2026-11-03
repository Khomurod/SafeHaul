// Sent Documents filters. `EnvelopeHistory` is stubbed so the panel's own
// contract — which documents it hands down, and the states it reports — can be
// asserted without the table, the listener or the row actions. All fixtures are
// artificial.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const historyProps = vi.hoisted(() => ({ current: null }));
vi.mock('@features/signing/components/EnvelopeHistory', () => ({
    default: (props) => {
        historyProps.current = props;
        return <div data-testid="envelope-history" />;
    },
}));

import { SentDocumentsPanel } from './SentDocumentsPanel';
import { DEFAULT_FILTERS } from '@features/company-admin/utils/documentsWorkspace';

const doc = (overrides = {}) => ({
    id: 'req-1',
    title: 'Artificial Offer Letter',
    recipientName: 'Artificial Person',
    status: 'sent',
    deliveryMethod: 'email',
    createdAt: { seconds: Math.floor(Date.now() / 1000) },
    ...overrides,
});

function Harness({ documents = [doc()], initialFilters = DEFAULT_FILTERS, ...rest }) {
    const [filters, setFilters] = React.useState({ ...initialFilters });
    return (
        <SentDocumentsPanel
            companyId="company-1"
            documents={documents}
            isLoading={false}
            loadError={null}
            onRetry={vi.fn()}
            onCorrect={vi.fn()}
            filters={filters}
            setFilters={setFilters}
            {...rest}
        />
    );
}

const renderPanel = (props = {}) => render(<Harness {...props} />);

beforeEach(() => {
    vi.clearAllMocks();
    historyProps.current = null;
});

const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));

describe('filter controls', () => {
    it('offers search, needs-attention and Filters in one row, the fields behind Filters', () => {
        renderPanel();
        expect(screen.getByRole('searchbox', { name: 'Search documents or recipients' })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Needs attention only' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
        // No second heading and no "Showing X of Y": the workspace heading counts.
        expect(screen.queryByRole('heading')).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        openFilters();
        expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
        expect(screen.getByLabelText('Status')).toBeInTheDocument();
        expect(screen.getByLabelText('Delivery method')).toBeInTheDocument();
        expect(screen.getByLabelText('Sent date')).toBeInTheDocument();
    });

    it('hides the date filter when no document carries a usable timestamp', () => {
        renderPanel({ documents: [doc({ createdAt: null })] });
        openFilters();
        expect(screen.getByLabelText('Status')).toBeInTheDocument();
        expect(screen.queryByLabelText('Sent date')).not.toBeInTheDocument();
    });

    it('narrows the documents handed to the table by search', () => {
        renderPanel({
            documents: [doc({ id: 'a', title: 'Offer Letter' }), doc({ id: 'b', title: 'W-9' })],
        });
        expect(historyProps.current.documents).toHaveLength(2);

        fireEvent.change(screen.getByLabelText('Search documents or recipients'), { target: { value: 'w-9' } });
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['b']);
    });

    it('narrows by status and by delivery method', () => {
        renderPanel({
            documents: [
                doc({ id: 'a', status: 'sent', deliveryMethod: 'email' }),
                doc({ id: 'b', status: 'signed', deliveryMethod: 'copy' }),
            ],
        });
        openFilters();

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } });
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['b']);

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
        fireEvent.change(screen.getByLabelText('Delivery method'), { target: { value: 'copy' } });
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['b']);
    });

    it('narrows to the real failures with the needs-attention filter', () => {
        renderPanel({
            documents: [doc({ id: 'ok' }), doc({ id: 'failed', emailStatus: 'failed' })],
        });
        fireEvent.click(screen.getByRole('switch', { name: 'Needs attention only' }));
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['failed']);
        expect(screen.getByRole('switch', { name: 'Needs attention only' })).toHaveAttribute('aria-checked', 'true');
    });

    it('honours a filter set before the panel mounted', () => {
        renderPanel({
            documents: [doc({ id: 'ok' }), doc({ id: 'failed', emailStatus: 'failed' })],
            initialFilters: { ...DEFAULT_FILTERS, needsAttention: true },
        });
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['failed']);
        expect(screen.getByRole('switch', { name: 'Needs attention only' })).toHaveAttribute('aria-checked', 'true');
    });

    it('counts the fields that apply on Filters and clears only those', () => {
        renderPanel({
            documents: [
                doc({ id: 'a', status: 'sent', deliveryMethod: 'email' }),
                doc({ id: 'b', title: 'W-9', status: 'signed', deliveryMethod: 'sms' }),
            ],
        });
        openFilters();
        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } });
        fireEvent.change(screen.getByLabelText('Delivery method'), { target: { value: 'sms' } });
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents or recipients' }), { target: { value: 'w-9' } });
        expect(screen.getByRole('button', { name: 'Filters 2 applied' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(screen.getByLabelText('Status')).toHaveValue('all');
        expect(screen.getByLabelText('Delivery method')).toHaveValue('all');
        // The search is its own control, in view, and keeps what was typed.
        expect(screen.getByRole('searchbox', { name: 'Search documents or recipients' })).toHaveValue('w-9');
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['b']);
        expect(screen.getByRole('button', { name: /^Filters/ })).toHaveFocus();
    });

    it('opens Filters from the start when one already applies', () => {
        renderPanel({ initialFilters: { ...DEFAULT_FILTERS, status: 'signed' } });
        expect(screen.getByLabelText('Status')).toHaveValue('signed');
        expect(screen.getByRole('button', { name: 'Filters 1 applied' })).toHaveAttribute('aria-expanded', 'true');
    });
});

/** `n` loaded documents, newest first. */
const docs = (n, overrides = {}) => Array.from({ length: n }, (_, i) => doc({ id: `req-${i}`, title: `Document ${i}`, ...overrides }));

const partialList = (overrides = {}) => ({
    complete: false, hasMore: true, loadMore: vi.fn(), isLoadingMore: false, loadMoreFailed: false, total: 1234, ...overrides,
});
const attentionList = (overrides = {}) => ({
    documents: docs(3, { emailStatus: 'failed' }),
    complete: true,
    isLoading: false,
    error: null,
    retry: vi.fn(),
    hasMore: false,
    loadMore: vi.fn(),
    isLoadingMore: false,
    loadMoreFailed: false,
    total: 3,
    ...overrides,
});

describe('a partly loaded list', () => {
    it('says the list is the newest 100 and offers Load older documents', () => {
        const loadMore = vi.fn();
        renderPanel({
            documents: docs(100),
            list: { complete: false, hasMore: true, loadMore, isLoadingMore: false, loadMoreFailed: false, total: 1234 },
        });

        expect(screen.getByText('Showing the newest 100 of 1,234 sent documents. Search and filters look at these 100.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load older documents' }));
        expect(loadMore).toHaveBeenCalledTimes(1);
    });

    it('says so without a number while the total is unknown', () => {
        renderPanel({ documents: docs(100), list: partialList({ total: null }) });
        expect(screen.getByText('Showing the newest 100 sent documents. Search and filters look at these only.')).toBeInTheDocument();
    });

    it('says nothing extra when every document is loaded', () => {
        renderPanel({ documents: docs(100), list: partialList({ complete: true, total: 100 }) });
        expect(screen.queryByText(/Showing the newest/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Load older documents' })).not.toBeInTheDocument();
    });

    it('keeps the rows and says so when older documents could not be loaded', () => {
        renderPanel({ documents: docs(100), list: partialList({ loadMoreFailed: true }) });
        expect(screen.getByRole('alert')).toHaveTextContent('Older documents could not be loaded.');
        expect(screen.getByRole('button', { name: 'Load older documents' })).toBeEnabled();
        expect(historyProps.current.documents).toHaveLength(100);
    });

    it('says all are loaded, and moves focus there, after the last page', () => {
        const list = partialList({ total: 150 });
        const view = renderPanel({ documents: docs(100), list });
        fireEvent.click(screen.getByRole('button', { name: 'Load older documents' }));
        view.rerender(<Harness documents={docs(150)} list={{ ...list, complete: true }} />);

        const done = screen.getByText('All 150 sent documents are loaded.').closest('.ds-notice');
        expect(done).toHaveFocus();
        expect(screen.queryByRole('button', { name: 'Load older documents' })).not.toBeInTheDocument();
    });

    it('lists the documents that need attention from their own read', () => {
        const attention = attentionList({ documents: [doc({ id: 'old-failure', emailStatus: 'failed' })] });
        renderPanel({ documents: docs(100), list: partialList(), attention });
        fireEvent.click(screen.getByRole('switch', { name: 'Needs attention only' }));

        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['old-failure']);
        // That list is complete: no notice about the 100 loaded documents.
        expect(screen.queryByText(/Showing the newest/)).not.toBeInTheDocument();
    });

    it('passes the attention read’s loading and failure to the table', () => {
        const retry = vi.fn();
        const initialFilters = { ...DEFAULT_FILTERS, needsAttention: true };
        const view = renderPanel({ documents: docs(100), list: partialList(), attention: attentionList({ documents: [], isLoading: true }), initialFilters });
        expect(historyProps.current.isLoading).toBe(true);

        view.rerender(<Harness documents={docs(100)} list={partialList()} attention={attentionList({ documents: [], error: 'Documents that need attention could not be loaded.', retry })} initialFilters={initialFilters} />);
        expect(historyProps.current.isLoading).toBe(false);
        expect(historyProps.current.loadError).toBe('Documents that need attention could not be loaded.');
        expect(historyProps.current.onRetry).toBe(retry);
    });

    it('offers more of the documents that need attention while that list is not complete', () => {
        const loadMore = vi.fn();
        renderPanel({
            documents: docs(100),
            list: partialList(),
            attention: attentionList({ documents: docs(100, { emailStatus: 'failed' }), complete: false, hasMore: true, total: 140, loadMore }),
            initialFilters: { ...DEFAULT_FILTERS, needsAttention: true },
        });
        expect(screen.getByText('Showing the newest 100 of 140 documents that need attention.')).toBeInTheDocument();
        expect(screen.queryByText(/sent documents/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(loadMore).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations with the notice', async () => {
        const { container } = renderPanel({ documents: docs(100), list: partialList({ loadMoreFailed: true }) });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('states passed to the table', () => {
    it('forwards loading, error and retry unchanged', () => {
        const onRetry = vi.fn();
        render(
            <SentDocumentsPanel
                companyId="company-1"
                documents={[]}
                isLoading
                loadError="Could not load document history. Please try again."
                onRetry={onRetry}
                onCorrect={vi.fn()}
                filters={DEFAULT_FILTERS}
                setFilters={vi.fn()}
            />,
        );

        expect(historyProps.current.isLoading).toBe(true);
        expect(historyProps.current.loadError).toMatch(/Could not load document history/);
        expect(historyProps.current.onRetry).toBe(onRetry);
    });

    it('keeps the company and the correction handler on the table', () => {
        const onCorrect = vi.fn();
        renderPanel({ onCorrect });
        expect(historyProps.current.companyId).toBe('company-1');
        expect(historyProps.current.onCorrect).toBe(onCorrect);
    });

    it('tells the table which empty state to show', () => {
        renderPanel({ documents: [doc()] });
        expect(historyProps.current.emptyState.title).toBe('No documents sent yet.');

        fireEvent.change(screen.getByLabelText('Search documents or recipients'), { target: { value: 'zzz' } });
        expect(historyProps.current.emptyState.title).toBe('No documents match these filters.');
    });

    it('says what Needs attention looks for when it alone finds nothing', () => {
        renderPanel({ documents: [doc()] });
        fireEvent.click(screen.getByRole('switch', { name: 'Needs attention only' }));
        expect(historyProps.current.documents).toEqual([]);
        expect(historyProps.current.emptyState).toEqual({
            title: 'Nothing needs attention.',
            description: 'This lists failed deliveries and failed seals. A document waiting for a signature is not one.',
        });

        fireEvent.change(screen.getByLabelText('Search documents or recipients'), { target: { value: 'offer' } });
        expect(historyProps.current.emptyState.title).toBe('No documents match these filters.');
    });

    it('lays the table into the toolbar\'s card', () => {
        renderPanel();
        expect(historyProps.current.embedded).toBe(true);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderPanel();
        expect((await axe(container)).violations).toEqual([]);
    });
});
