// Documents Overview: real metrics from real data, the attention list, the
// recent list, and the loading/error states. All documents are artificial.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsOverview } from './DocumentsOverview';

const doc = (overrides = {}) => ({
    id: 'req-1',
    title: 'Artificial Offer Letter',
    recipientName: 'Artificial Person',
    status: 'sent',
    deliveryMethod: 'email',
    createdAt: { seconds: Math.floor(Date.now() / 1000) },
    ...overrides,
});

const baseProps = () => ({
    documents: [],
    isLoading: false,
    loadError: null,
    onRetry: vi.fn(),
    templates: [],
    templatesLoading: false,
    onViewSentDocuments: vi.fn(),
    onViewNeedsAttention: vi.fn(),
    onViewTemplates: vi.fn(),
});

const renderOverview = (overrides = {}) => {
    const props = { ...baseProps(), ...overrides };
    return { props, ...render(<DocumentsOverview {...props} />) };
};

const metric = (label) => screen.getByRole('button', { name: new RegExp(`^${label}:`) });

beforeEach(() => vi.clearAllMocks());

describe('metrics', () => {
    it('counts awaiting, completed, needing attention and active templates', () => {
        renderOverview({
            documents: [
                doc({ id: 'a', status: 'sent' }),
                doc({ id: 'b', status: 'sent' }),
                doc({ id: 'c', status: 'signed' }),
                doc({ id: 'd', status: 'error_sealing' }),
            ],
            templates: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        });

        expect(metric('Awaiting signature')).toHaveAccessibleName('Awaiting signature: 2');
        // "Completed" is the one metric with nowhere to drill into, so it is a
        // plain card rather than a button.
        const completed = screen.getByTitle('Completed').closest('.ds-metric-card');
        expect(within(completed).getByTitle('1')).toBeInTheDocument();
        expect(metric('Needs attention')).toHaveAccessibleName('Needs attention: 1');
        expect(metric('Active templates')).toHaveAccessibleName('Active templates: 3');
    });

    it('shows zeroes for a company with no documents rather than inventing a metric', () => {
        renderOverview();
        expect(metric('Awaiting signature')).toHaveAccessibleName('Awaiting signature: 0');
        expect(metric('Needs attention')).toHaveAccessibleName('Needs attention: 0');
    });

    it('does not claim a template count while templates are still loading', () => {
        renderOverview({ templatesLoading: true });
        expect(metric('Active templates')).toHaveAccessibleName('Active templates: —');
    });

    it('names its shortcuts distinctly from the page header actions', () => {
        // The header offers "Manage Templates"; a second control differing only
        // in case would be indistinguishable by accessible name.
        renderOverview();
        expect(screen.getByRole('button', { name: 'Browse template library' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Manage templates$/i })).not.toBeInTheDocument();
    });

    it('routes the metric cards to the matching view', () => {
        const { props } = renderOverview();
        fireEvent.click(metric('Awaiting signature'));
        expect(props.onViewSentDocuments).toHaveBeenCalled();

        fireEvent.click(metric('Needs attention'));
        expect(props.onViewNeedsAttention).toHaveBeenCalled();

        fireEvent.click(metric('Active templates'));
        expect(props.onViewTemplates).toHaveBeenCalled();
    });
});

describe('needs attention', () => {
    it('lists only real failures and names the failure kind', () => {
        renderOverview({
            documents: [
                doc({ id: 'a', status: 'sent' }),
                doc({ id: 'b', status: 'sent', emailStatus: 'failed', title: 'Failed Delivery' }),
                doc({ id: 'c', status: 'error_sealing', title: 'Failed Seal' }),
            ],
        });

        const section = screen.getByRole('region', { name: 'Needs attention' });
        expect(within(section).getByText('Failed Delivery')).toBeInTheDocument();
        expect(within(section).getByText('Delivery failed')).toBeInTheDocument();
        expect(within(section).getByText('Failed Seal')).toBeInTheDocument();
        expect(within(section).getByText('Seal failed')).toBeInTheDocument();
    });

    it('lists a text that failed as a failed delivery', () => {
        renderOverview({ documents: [doc({ id: 's', status: 'sent', smsStatus: 'failed', title: 'Failed Text' })] });

        const section = screen.getByRole('region', { name: 'Needs attention' });
        expect(within(section).getByText('Failed Text')).toBeInTheDocument();
        expect(within(section).getByText('Delivery failed')).toBeInTheDocument();
    });

    it('says explicitly that waiting for a signature is not a failure', () => {
        renderOverview({ documents: [doc({ status: 'sent' })] });
        const section = screen.getByRole('region', { name: 'Needs attention' });
        expect(within(section).getByText(/still waiting on a signature are not counted/i)).toBeInTheDocument();
    });

    it('offers a way through to the filtered list', () => {
        const { props } = renderOverview({ documents: [doc({ emailStatus: 'failed' })] });
        fireEvent.click(screen.getByRole('button', { name: /Review all 1/ }));
        expect(props.onViewNeedsAttention).toHaveBeenCalled();
    });
});

describe('server totals and a separate attention list', () => {
    const failed = (n) => Array.from({ length: n }, (_, index) =>
        doc({ id: `f-${index}`, title: `Failed ${index}`, emailStatus: 'failed' }));

    it('shows the given totals and attention list instead of counting the loaded documents', () => {
        renderOverview({
            documents: [doc({ id: 'a', status: 'sent' })],
            summary: { total: 412, awaitingSignature: 53, completed: 300, needsAttention: 19 },
            attention: { documents: failed(8), isLoading: false, error: null, retry: vi.fn() },
        });

        expect(metric('Awaiting signature')).toHaveAccessibleName('Awaiting signature: 53');
        expect(within(screen.getByTitle('Completed').closest('.ds-metric-card')).getByTitle('300')).toBeInTheDocument();
        expect(metric('Needs attention')).toHaveAccessibleName('Needs attention: 19');
        const section = screen.getByRole('region', { name: 'Needs attention' });
        // Still at most five, from the attention list.
        expect(within(section).getAllByRole('listitem')).toHaveLength(5);
        expect(within(section).getByText('Failed 0')).toBeInTheDocument();
        expect(within(section).getByRole('button', { name: 'Review all 19' })).toBeInTheDocument();
        // Recent stays the newest loaded documents.
        expect(within(screen.getByRole('region', { name: 'Recent documents' })).getAllByRole('listitem')).toHaveLength(1);
    });

    it('shows dashes and says the totals could not be loaded, never a zero', () => {
        const onRetryCounts = vi.fn();
        renderOverview({
            documents: [doc({ id: 'a', status: 'sent' })],
            summary: null,
            countsError: new Error('unavailable'),
            onRetryCounts,
            attention: { documents: failed(2), isLoading: false, error: null, retry: vi.fn() },
        });

        expect(metric('Awaiting signature')).toHaveAccessibleName('Awaiting signature: —');
        expect(metric('Needs attention')).toHaveAccessibleName('Needs attention: —');
        expect(within(screen.getByTitle('Completed').closest('.ds-metric-card')).getByTitle('—')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Review all' })).toBeInTheDocument();

        const glance = screen.getByRole('region', { name: 'At a glance' });
        expect(within(glance).getByText('Totals could not be loaded.')).toBeInTheDocument();
        fireEvent.click(within(glance).getByRole('button', { name: 'Try again' }));
        expect(onRetryCounts).toHaveBeenCalledTimes(1);
    });

    it('says the attention list is loading instead of saying nothing failed', () => {
        renderOverview({
            summary: { total: 412, awaitingSignature: 53, completed: 300, needsAttention: 19 },
            attention: { documents: [], isLoading: true, error: null, retry: vi.fn() },
        });
        const section = screen.getByRole('region', { name: 'Needs attention' });
        expect(within(section).getByRole('status')).toHaveTextContent('Loading documents that need attention');
        expect(within(section).queryByText(/No delivery or sealing failures/)).not.toBeInTheDocument();
    });

    it("shows that the attention list could not be loaded instead of 'No delivery or sealing failures.'", () => {
        const retry = vi.fn();
        renderOverview({
            documents: [doc({ id: 'a', status: 'sent' })],
            attention: { documents: [], isLoading: false, error: 'Documents that need attention could not be loaded.', retry },
        });

        const section = screen.getByRole('region', { name: 'Needs attention' });
        expect(within(section).getByText('Documents that need attention could not be loaded.')).toBeInTheDocument();
        expect(within(section).queryByText(/No delivery or sealing failures/)).not.toBeInTheDocument();
        fireEvent.click(within(section).getByRole('button', { name: 'Try again' }));
        expect(retry).toHaveBeenCalledTimes(1);
    });
});

describe('recent documents', () => {
    it('keeps the live query order and caps the list at five', () => {
        renderOverview({
            documents: Array.from({ length: 8 }, (_, index) =>
                doc({ id: `r-${index}`, title: `Document ${index}` }),
            ),
        });
        const section = screen.getByRole('region', { name: 'Recent documents' });
        expect(within(section).getAllByRole('listitem')).toHaveLength(5);
        expect(within(section).getByText('Document 0')).toBeInTheDocument();
        expect(within(section).queryByText('Document 5')).not.toBeInTheDocument();
    });

    it('points a brand-new company at New Document', () => {
        renderOverview();
        expect(screen.getByText(/Use New Document to send your first one/)).toBeInTheDocument();
    });
});

describe('states', () => {
    it('reports loading', () => {
        renderOverview({ isLoading: true });
        expect(screen.getByRole('status')).toHaveTextContent('Loading document overview');
    });

    it('shows the failure and a retry instead of a plausible-looking zero', () => {
        const { props } = renderOverview({ loadError: 'Could not load document history. Please try again.' });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not load document history.');
        expect(screen.queryByRole('button', { name: /^Awaiting signature:/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(props.onRetry).toHaveBeenCalled();
    });

    it('has no accessibility violations when the totals and the attention list failed', async () => {
        const { container } = renderOverview({
            documents: [doc({ id: 'a' })],
            summary: null,
            countsError: new Error('unavailable'),
            onRetryCounts: vi.fn(),
            attention: { documents: [], isLoading: false, error: 'Documents that need attention could not be loaded.', retry: vi.fn() },
        });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderOverview({
            documents: [doc({ id: 'a' }), doc({ id: 'b', emailStatus: 'failed' })],
            templates: [{ id: 't1' }],
        });
        expect((await axe(container)).violations).toEqual([]);
    });
});
