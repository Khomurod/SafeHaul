import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import VirtualLeadList from './VirtualLeadList';

// All fixtures use artificial names and fictional 555-01xx numbers — never real
// recipient contact data, and nothing here is written to a snapshot.
const callableNames = vi.hoisted(() => []);
const mockCallable = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase/config', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => {
        callableNames.push(name);
        return mockCallable;
    },
}));

// Virtuoso needs layout measurement that happy-dom cannot provide, so it is
// replaced with a pass-through that renders every row, mounts the Footer, and
// exposes the props (plus an endReached trigger) for assertions.
const virtuosoProps = vi.hoisted(() => []);
vi.mock('react-virtuoso', () => ({
    Virtuoso: (props) => {
        virtuosoProps.push(props);
        const { data, itemContent, components } = props;
        const Footer = components?.Footer;
        return (
            <div data-testid="virtuoso">
                {data.map((item, index) => (
                    <div key={item.id || `row-${index}`}>{itemContent(index, item)}</div>
                ))}
                {Footer ? <Footer /> : null}
                <button type="button" onClick={() => props.endReached?.()}>trigger end reached</button>
            </div>
        );
    },
}));

const page = (leads, lastDocId) => ({ data: { leads, lastDocId } });
const lead = (id, over = {}) => ({
    id,
    firstName: 'Artificial',
    lastName: id.toUpperCase(),
    phone: '555-0100',
    status: 'new',
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    callableNames.length = 0;
    virtuosoProps.length = 0;
    mockCallable.mockResolvedValue(page([], null));
});

describe('VirtualLeadList — remote fetching', () => {
    it('calls getFilteredLeadsPage with the exact payload and mapped filters', async () => {
        mockCallable.mockResolvedValue(page([lead('l1')], 'doc-1'));

        render(<VirtualLeadList companyId="co-1" filters={{ leadType: 'applications', excludeRecentDays: 'off', campaignLimit: '100' }} />);

        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(1));
        expect(callableNames).toContain('getFilteredLeadsPage');
        expect(mockCallable).toHaveBeenCalledWith({
            companyId: 'co-1',
            filters: {
                leadType: 'applications',
                excludeRecentDays: null, // 'off' maps to null
                campaignLimit: 100, // parsed to a number
            },
            pageSize: 50,
            lastDocId: null,
        });
    });

    it('keeps a real exclusion window and nulls an absent campaign limit', async () => {
        render(<VirtualLeadList companyId="co-1" filters={{ excludeRecentDays: '7' }} />);

        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(1));
        expect(mockCallable.mock.calls[0][0].filters).toEqual({
            excludeRecentDays: '7',
            campaignLimit: null,
        });
    });

    it('appends the next page with lastDocId and stops when the cursor clears', async () => {
        mockCallable.mockResolvedValueOnce(page([lead('l1')], 'doc-1'));
        render(<VirtualLeadList companyId="co-1" filters={{}} />);
        await screen.findByText('Artificial L1');

        mockCallable.mockResolvedValueOnce(page([lead('l2')], null));
        fireEvent.click(screen.getByRole('button', { name: 'trigger end reached' }));

        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(2));
        expect(mockCallable.mock.calls[1][0].lastDocId).toBe('doc-1');
        // Appended, not replaced.
        expect(await screen.findByText('Artificial L2')).toBeInTheDocument();
        expect(screen.getByText('Artificial L1')).toBeInTheDocument();

        // hasMore is now false, so further endReached calls do not fetch.
        fireEvent.click(screen.getByRole('button', { name: 'trigger end reached' }));
        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(2));
    });

    it('treats an empty page as the end even when a cursor comes back', async () => {
        mockCallable.mockResolvedValueOnce(page([lead('l1')], 'doc-1'));
        render(<VirtualLeadList companyId="co-1" filters={{}} />);
        await screen.findByText('Artificial L1');

        mockCallable.mockResolvedValueOnce(page([], 'doc-2'));
        fireEvent.click(screen.getByRole('button', { name: 'trigger end reached' }));
        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(2));

        fireEvent.click(screen.getByRole('button', { name: 'trigger end reached' }));
        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(2));
    });

    it('resets the list and cursor when the filters change', async () => {
        mockCallable.mockResolvedValueOnce(page([lead('l1')], 'doc-1'));
        const { rerender } = render(<VirtualLeadList companyId="co-1" filters={{ leadType: 'applications' }} />);
        await screen.findByText('Artificial L1');

        mockCallable.mockResolvedValueOnce(page([lead('l9')], null));
        rerender(<VirtualLeadList companyId="co-1" filters={{ leadType: 'leads' }} />);

        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(2));
        expect(mockCallable.mock.calls[1][0].lastDocId).toBeNull();
        expect(await screen.findByText('Artificial L9')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Artificial L1')).not.toBeInTheDocument());
    });

    it('guards against a concurrent fetch while one is in flight', async () => {
        let resolveFirst;
        mockCallable.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
        render(<VirtualLeadList companyId="co-1" filters={{}} />);
        await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(1));

        // A second trigger while the first request is pending must be ignored.
        expect(mockCallable).toHaveBeenCalledTimes(1);
        await React.act(async () => { resolveFirst(page([lead('l1')], null)); });
        expect(mockCallable).toHaveBeenCalledTimes(1);
    });
});

describe('VirtualLeadList — local data mode', () => {
    it('renders local rows without calling the backend', async () => {
        render(<VirtualLeadList companyId="co-1" filters={{}} localData={[lead('i1'), lead('i2')]} />);

        expect(await screen.findByText('Artificial I1')).toBeInTheDocument();
        expect(mockCallable).not.toHaveBeenCalled();
    });

    it('falls back to import_<index> ids for rows without an id', () => {
        const onToggleExclusion = vi.fn();
        render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[{ firstName: 'No', lastName: 'Id', phone: '555-0101' }]}
                onToggleExclusion={onToggleExclusion}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /No Id/ }));
        expect(onToggleExclusion).toHaveBeenCalledWith('import_0');
    });

    it('applies the name and contact fallbacks', () => {
        render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[
                    { id: 'a', name: 'Only Name', email: 'artificial@example.test' },
                    { id: 'b' },
                ]}
            />,
        );

        expect(screen.getByText('Only Name')).toBeInTheDocument();
        expect(screen.getByText('artificial@example.test')).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
        expect(screen.getByText('No Contact Info')).toBeInTheDocument();
    });
});

describe('VirtualLeadList — selection semantics', () => {
    it('exposes each row as a keyboard-operable toggle with pressed state', () => {
        const onToggleExclusion = vi.fn();
        render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[lead('l1'), lead('l2')]}
                excludedIds={['l2']}
                onToggleExclusion={onToggleExclusion}
            />,
        );

        const included = screen.getByRole('button', { name: /Artificial L1/ });
        const excluded = screen.getByRole('button', { name: /Artificial L2/ });

        // Native buttons, so Enter/Space activation comes from the platform.
        expect(included.tagName).toBe('BUTTON');
        expect(included).toHaveAttribute('aria-pressed', 'true');
        expect(excluded).toHaveAttribute('aria-pressed', 'false');

        included.focus();
        expect(included).toHaveFocus();

        fireEvent.click(included);
        expect(onToggleExclusion).toHaveBeenCalledWith('l1');
    });

    it('states inclusion and exclusion in text, not colour alone', () => {
        render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[lead('l1'), lead('l2')]}
                excludedIds={['l2']}
                onToggleExclusion={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: /Included in this campaign/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Excluded from this campaign/ })).toBeInTheDocument();
    });

    it('keeps already-messaged rows non-toggleable and labelled', () => {
        const onToggleExclusion = vi.fn();
        render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[lead('l1', { normalizedPhone: '+15550100' })]}
                excludedPhones={new Set(['+15550100'])}
                onToggleExclusion={onToggleExclusion}
            />,
        );

        // Not exposed as a control at all.
        expect(screen.queryByRole('button', { name: /Artificial L1/ })).not.toBeInTheDocument();
        expect(screen.getByText('Already Messaged')).toBeInTheDocument();
        expect(screen.getByText('Already messaged — cannot be selected')).toBeInTheDocument();
        expect(onToggleExclusion).not.toHaveBeenCalled();
    });

    it('ignores phone exclusions when no excludedPhones set is supplied', () => {
        const onToggleExclusion = vi.fn();
        render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[lead('l1', { normalizedPhone: '+15550100' })]}
                onToggleExclusion={onToggleExclusion}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Artificial L1/ }));
        expect(onToggleExclusion).toHaveBeenCalledWith('l1');
    });

    it('renders status as a readable badge rather than 10px text', () => {
        render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[lead('l1'), lead('l2', { status: 'hired' }), lead('l3', { status: undefined })]}
            />,
        );

        expect(screen.getByText('new')).toHaveAttribute('data-tone', 'info');
        expect(screen.getByText('hired')).toHaveAttribute('data-tone', 'success');
        expect(screen.getByText('Lead')).toHaveAttribute('data-tone', 'neutral');
        // No element opts out of the supported type scale.
        expect(document.querySelector('.text-\\[10px\\]')).toBeNull();
    });
});

describe('VirtualLeadList — states', () => {
    it('announces the initial loading state', async () => {
        mockCallable.mockReturnValue(new Promise(() => {}));
        render(<VirtualLeadList companyId="co-1" filters={{}} />);

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent('Scanning Database...');
    });

    it('announces an accessible empty state', async () => {
        render(<VirtualLeadList companyId="co-1" filters={{}} />);
        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent('No leads match these filters.');
        expect(screen.getByText('Try adjusting your criteria.')).toBeInTheDocument();
    });

    it('announces a pagination footer while fetching more', async () => {
        mockCallable.mockResolvedValueOnce(page([lead('l1')], 'doc-1'));
        render(<VirtualLeadList companyId="co-1" filters={{}} />);
        await screen.findByText('Artificial L1');

        mockCallable.mockReturnValueOnce(new Promise(() => {}));
        fireEvent.click(screen.getByRole('button', { name: 'trigger end reached' }));

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Fetching more...'));
    });

    it('surfaces a failure as an alert with an approved retry action', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCallable.mockRejectedValueOnce(new Error('backend unavailable'));
        render(<VirtualLeadList companyId="co-1" filters={{}} />);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Failed to load preview');
        const retry = screen.getByRole('button', { name: 'Retry Connection' });
        expect(retry).toHaveClass('ds-button');

        // The failure reason is logged, never the recipient rows.
        expect(consoleError).toHaveBeenCalledWith('Failed to load leads:', expect.any(Error));

        mockCallable.mockResolvedValueOnce(page([lead('l1')], null));
        fireEvent.click(retry);
        expect(await screen.findByText('Artificial L1')).toBeInTheDocument();
        consoleError.mockRestore();
    });
});

describe('VirtualLeadList — virtualization contract', () => {
    it('passes the frozen Virtuoso props', async () => {
        const leads = [lead('l1'), lead('l2')];
        mockCallable.mockResolvedValueOnce(page(leads, 'doc-1'));
        render(<VirtualLeadList companyId="co-1" filters={{}} />);
        await screen.findByText('Artificial L1');

        const props = virtuosoProps.at(-1);
        expect(props.style).toEqual({ height: '100%' });
        expect(props.className).toBe('custom-scrollbar');
        expect(props.data).toHaveLength(2);
        expect(typeof props.endReached).toBe('function');
        expect(typeof props.itemContent).toBe('function');
        expect(typeof props.components.Footer).toBe('function');
    });

    it('has no accessibility violations with mixed row states', async () => {
        const { container } = render(
            <VirtualLeadList
                companyId="co-1"
                filters={{}}
                localData={[
                    lead('l1'),
                    lead('l2', { status: 'hired' }),
                    lead('l3', { normalizedPhone: '+15550100' }),
                ]}
                excludedIds={['l2']}
                excludedPhones={new Set(['+15550100'])}
                onToggleExclusion={vi.fn()}
            />,
        );
        await screen.findByText('Artificial L1');

        expect((await axe(container)).violations).toEqual([]);
    });
});
