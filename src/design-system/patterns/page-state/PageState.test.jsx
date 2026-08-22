import React from 'react';
import { Inbox, Loader, RefreshCw } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { Button } from '@design-system/components';
import { EmptyState, ErrorState, LoadingState, PageState } from './PageState';

describe('PageState', () => {
  it('renders the heading and body that carry the meaning', () => {
    render(
      <PageState
        tone="neutral"
        icon={Inbox}
        title="Nothing here yet"
        description="Records you create will appear here."
      />,
    );
    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument();
    expect(screen.getByText('Records you create will appear here.')).toBeInTheDocument();
  });

  it('refuses a state whose only signal is its tone', () => {
    expect(() => render(<PageState tone="danger" />))
      .toThrow(/requires a title/i);
    expect(() => render(<PageState tone="danger" title="   " />))
      .toThrow(/The tone is not the message/i);
  });

  it('rejects an unsupported tone rather than rendering an untoned state', () => {
    expect(() => render(<PageState tone="chartreuse" title="Nope" />))
      .toThrow(/Unsupported PageState tone/i);
  });

  it('keeps the medallion out of the accessibility tree', () => {
    // The tone must never be the only signal, so the medallion is decorative and
    // the heading has to stand alone.
    const { container } = render(<PageState tone="info" icon={Inbox} title="Loading" />);
    expect(container.querySelector('.ds-status-medallion')).toHaveAttribute('aria-hidden', 'true');
  });

  it('matches the surrounding outline when asked', () => {
    render(<PageState tone="neutral" title="Nothing here" headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('rejects a heading level that is not one', () => {
    expect(() => render(<PageState tone="neutral" title="x" headingLevel={7} />))
      .toThrow(/Unsupported PageState headingLevel/i);
  });

  it('does not nest a second card surface when told it is already inside one', () => {
    const { container } = render(
      <PageState tone="neutral" title="Nothing here" surface="bare" />,
    );
    expect(container.querySelector('.ds-card')).toBeNull();
    expect(container.querySelector('.ds-page-state')).toBeInTheDocument();
  });
});

/**
 * How each state is announced is the part that is not decoration.
 *
 * A polite error is silent until the user happens to navigate to it. An
 * assertive empty state interrupts whatever they were reading to tell them
 * about nothing. Both are real defects, so both directions are pinned.
 */
describe('announcement', () => {
  it('announces an error immediately', () => {
    render(<ErrorState title="Could not load" actions={<Button>Try again</Button>} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
  });

  it('announces an empty state politely, never as an alert', () => {
    render(<EmptyState title="No records yet" />);
    expect(screen.getByRole('status')).toHaveTextContent('No records yet');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces loading politely, never as an alert', () => {
    render(<LoadingState icon={Loader} title="Loading records" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading records');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('derives assertive from a danger tone without being told', () => {
    render(<PageState tone="danger" title="Access denied" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('can be silenced for a state rendered as ordinary page content', () => {
    // A state reached by navigating to it does not need announcing on mount;
    // the heading is already the page.
    render(<PageState tone="warning" title="This link has expired" announce="off" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
  });
});

describe('the way forward', () => {
  it('renders the action a state offers', () => {
    render(
      <ErrorState
        title="Could not load"
        description="The connection was interrupted."
        actions={<Button variant="secondary"><RefreshCw aria-hidden="true" />Try again</Button>}
      />,
    );
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('refuses an action on a loading state', () => {
    // There is nothing to do but wait, so a control here is a control that does
    // nothing — and it invites a "Cancel" that cancels no request.
    expect(() => render(
      <LoadingState title="Loading" actions={<Button>Cancel</Button>} />,
    )).toThrow(/takes no actions/i);
  });
});

describe('accessibility', () => {
  it.each([
    ['empty', <EmptyState key="e" icon={Inbox} title="No records yet" description="Create the first one." actions={<Button variant="primary">New record</Button>} />],
    ['error', <ErrorState key="x" title="Could not load" description="Try again in a moment." actions={<Button variant="secondary">Try again</Button>} />],
    ['loading', <LoadingState key="l" icon={Loader} title="Loading records" />],
  ])('has no violations in the %s state', async (_name, element) => {
    // `h2` with no `h1` above it is correct in isolation but reads as a skipped
    // level to axe, so the state is rendered under one, as a real page would.
    const { container } = render(<main><h1>Records</h1>{element}</main>);
    expect((await axe(container)).violations).toEqual([]);
  });
});

/**
 * The three states must be the same shape as each other.
 *
 * The first visual review of this component found a column of three state cards
 * where the middle one had a medallion and the error did not, because only the
 * caller could supply an icon. Two of the three now default one; `EmptyState`
 * does not, because what "nothing here" looks like depends on what is missing.
 */
describe('default medallions', () => {
  it('gives an error state a medallion without being asked', () => {
    const { container } = render(<ErrorState title="Could not load" />);
    expect(container.querySelector('.ds-status-medallion')).toBeInTheDocument();
  });

  it('gives a loading state a medallion without being asked', () => {
    const { container } = render(<LoadingState title="Loading records" />);
    expect(container.querySelector('.ds-status-medallion')).toBeInTheDocument();
  });

  it('lets a caller override the default', () => {
    const { container } = render(<ErrorState icon={Inbox} title="Could not load" />);
    expect(container.querySelector('.ds-status-medallion')).toBeInTheDocument();
  });

  it('leaves an empty state without one until the caller says what is missing', () => {
    const { container } = render(<EmptyState title="No records yet" />);
    expect(container.querySelector('.ds-status-medallion')).toBeNull();
  });
});
