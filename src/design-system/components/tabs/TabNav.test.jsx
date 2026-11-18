import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabNav } from './TabNav';
import { naturalTrayWidth } from './segmentedGroup';

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

/*
 * The Leads scope tabs sit in the list toolbar's content-sized lead slot, so the
 * <nav> the tray is measured against is exactly as wide as the tray. Under a
 * browser zoom such as 80% or 110% the browser can report that row's width
 * (`clientWidth`, a whole number) more than half a pixel under the real one.
 * Measured that way the tray read as too wide, took its full-row layout, which
 * widened the row, read as fitting, shrank back, and React ended the flipping
 * with "Maximum update depth exceeded": the whole Leads page was replaced by
 * "Leads is temporarily unavailable". The stub below draws that row: exactly as
 * wide as the tray's one-row width, or three times its widest label once the
 * tray takes its grid; `clientWidth` reports the width rounded down, as the
 * zoomed browser did.
 */
describe('a segmented tray in a row as wide as itself', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stays one row under a zoom that rounds the row down, rather than flipping until React gives up', () => {
    const LABEL = 95.55;
    const trayOf = (nav) => nav.querySelector('.ds-segmented-group');
    const rowWidth = (nav) => (trayOf(nav)?.getAttribute('data-wrapped') === 'true'
      ? 3 * 2 * LABEL
      : naturalTrayWidth(trayOf(nav)));
    const realStyle = window.getComputedStyle.bind(window);
    vi.spyOn(Range.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: LABEL, height: 0, top: 0, left: 0, right: LABEL, bottom: 0, x: 0, y: 0 });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth() {
      return this.tagName === 'NAV' ? Math.floor(rowWidth(this)) : 0;
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = realStyle(element);
      if (element.tagName !== 'NAV') return style;
      return new Proxy(style, {
        get: (target, key) => (key === 'width' ? `${rowWidth(element)}px` : Reflect.get(target, key)),
      });
    });

    render(<TabNav ariaLabel="Lead lists" items={ITEMS} currentId="all" variant="segmented" />);

    const tray = within(screen.getByRole('navigation', { name: 'Lead lists' })).getByRole('list');
    // The stub is the case it describes: a whole-pixel width more than half a pixel short.
    expect(naturalTrayWidth(tray) - Math.floor(naturalTrayWidth(tray))).toBeGreaterThan(0.5);
    expect(tray).not.toHaveAttribute('data-wrapped');
  });

  it('still takes its full-row layout in a row truly narrower than itself', () => {
    const realStyle = window.getComputedStyle.bind(window);
    vi.spyOn(Range.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 120, height: 0, top: 0, left: 0, right: 120, bottom: 0, x: 0, y: 0 });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = realStyle(element);
      if (element.tagName !== 'NAV') return style;
      return new Proxy(style, { get: (target, key) => (key === 'width' ? '300px' : Reflect.get(target, key)) });
    });

    render(<TabNav ariaLabel="Lead lists" items={ITEMS} currentId="all" variant="segmented" />);

    // Three 120px labels need more than the row's 300px.
    expect(within(screen.getByRole('navigation', { name: 'Lead lists' })).getByRole('list'))
      .toHaveAttribute('data-wrapped', 'true');
  });
});
