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

describe('filter controls', () => {
    it('offers search, status, delivery, date and needs-attention', () => {
        renderPanel();
        expect(screen.getByLabelText('Search documents or recipients')).toBeInTheDocument();
        expect(screen.getByLabelText('Status')).toBeInTheDocument();
        expect(screen.getByLabelText('Delivery method')).toBeInTheDocument();
        expect(screen.getByLabelText('Sent date')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Needs attention only' })).toBeInTheDocument();
    });

    it('hides the date filter when no document carries a usable timestamp', () => {
        renderPanel({ documents: [doc({ createdAt: null })] });
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
        fireEvent.click(screen.getByRole('checkbox', { name: 'Needs attention only' }));
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['failed']);
    });

    it('honours a filter set before the panel mounted', () => {
        renderPanel({
            documents: [doc({ id: 'ok' }), doc({ id: 'failed', emailStatus: 'failed' })],
            initialFilters: { ...DEFAULT_FILTERS, needsAttention: true },
        });
        expect(historyProps.current.documents.map((d) => d.id)).toEqual(['failed']);
    });

    it('resets every filter, and is disabled while nothing is filtered', () => {
        renderPanel({ documents: [doc({ id: 'a' }), doc({ id: 'b', title: 'W-9' })] });
        const reset = screen.getByRole('button', { name: 'Reset filters' });
        expect(reset).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Search documents or recipients'), { target: { value: 'w-9' } });
        expect(reset).toBeEnabled();

        fireEvent.click(reset);
        expect(historyProps.current.documents).toHaveLength(2);
        expect(screen.getByLabelText('Search documents or recipients')).toHaveValue('');
    });

    it('reports how many documents are showing', () => {
        renderPanel({ documents: [doc({ id: 'a' }), doc({ id: 'b', title: 'W-9' })] });
        expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 2 documents');

        fireEvent.change(screen.getByLabelText('Search documents or recipients'), { target: { value: 'w-9' } });
        expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 2 documents');
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
        expect(screen.getByRole('status')).toHaveTextContent('Loading documents…');
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

    it('has no accessibility violations', async () => {
        const { container } = renderPanel();
        expect((await axe(container)).violations).toEqual([]);
    });
});
