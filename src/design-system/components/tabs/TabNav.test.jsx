import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { TabNav } from './TabNav';

const ITEMS = [
  { id: 'all', label: 'All', href: '/records/all' },
  { id: 'mine', label: 'Mine', href: '/records/mine' },
  { id: 'open', label: 'Open', href: '/records/open' },
];

describe('TabNav', () => {
  it('is a named navigation holding one link per item', () => {
    render(<TabNav ariaLabel="Record lists" items={ITEMS} currentId="mine" />);

    const nav = screen.getByRole('navigation', { name: 'Record lists' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/records/all', '/records/mine', '/records/open']);
    expect(links.map((link) => link.textContent)).toEqual(['All', 'Mine', 'Open']);
    // Links in a list, not a tab widget: no panels or arrow keys are promised.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(within(nav).getByRole('list')).toBeInTheDocument();
  });

  it('marks the page shown, and only it, with aria-current', () => {
    render(<TabNav ariaLabel="Record lists" items={ITEMS} currentId="mine" />);

    expect(screen.getByRole('link', { name: 'Mine' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Open' })).not.toHaveAttribute('aria-current');
    // The current item wears the strip's selected underline.
    expect(screen.getByRole('link', { name: 'Mine' })).toHaveAttribute('data-selected', 'true');
  });

  it('keeps every link in the Tab order, in its own order', async () => {
    const user = userEvent.setup();
    render(<TabNav ariaLabel="Record lists" items={ITEMS} currentId="mine" />);

    await user.tab();
    expect(screen.getByRole('link', { name: 'All' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Mine' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveFocus();
  });

  it("hands a click to the item's own handler, so a router can move without a reload", async () => {
    const onClick = vi.fn((event) => event.preventDefault());
    render(<TabNav ariaLabel="Record lists" items={[ITEMS[0], { ...ITEMS[1], onClick }]} currentId="all" />);

    await userEvent.click(screen.getByRole('link', { name: 'Mine' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('refuses a navigation with no name, no items, or an item with no address', () => {
    expect(() => render(<TabNav items={ITEMS} />)).toThrow(/requires an ariaLabel/i);
    expect(() => render(<TabNav ariaLabel="Record lists" items={[]} />)).toThrow(/at least one item/i);
    expect(() => render(<TabNav ariaLabel="Record lists" items={[{ id: 'x', label: 'X' }]} />))
      .toThrow(/requires an href/i);
  });

  it('draws the segmented tray when asked, still links with aria-current', () => {
    render(<TabNav ariaLabel="Record lists" items={ITEMS} currentId="mine" variant="segmented" />);

    const list = within(screen.getByRole('navigation', { name: 'Record lists' })).getByRole('list');
    expect(list).toHaveClass('ds-tab-list', 'ds-segmented-group');
    expect(list).toHaveAttribute('data-variant', 'segmented');
    // Three scopes in thirds on a phone.
    expect(list).toHaveAttribute('data-phone-columns', '3');
    expect(screen.getByRole('link', { name: 'Mine' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Mine' })).toHaveClass('ds-segmented-group__item');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('keeps the underlined strip by default', () => {
    render(<TabNav ariaLabel="Record lists" items={ITEMS} currentId="mine" />);

    const list = screen.getByRole('list');
    expect(list).toHaveAttribute('data-variant', 'underline');
    expect(list).not.toHaveClass('ds-segmented-group');
  });

  it('refuses a look it does not have', () => {
    expect(() => render(<TabNav ariaLabel="Record lists" items={ITEMS} variant="pill" />))
      .toThrow(/Unsupported TabNav variant: pill/);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<TabNav ariaLabel="Record lists" items={ITEMS} currentId="all" />);

    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no accessibility violations as a segmented tray', async () => {
    const { container } = render(<TabNav ariaLabel="Record lists" items={ITEMS} currentId="all" variant="segmented" />);

    expect((await axe(container)).violations).toEqual([]);
  });
});
