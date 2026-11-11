import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormField, Select } from '@design-system/components';
import { ListToolbar } from './ListToolbar';
import { toolsFit } from './useToolsWrap';

const SEGMENTS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

/** The toolbar's stylesheet as rules, its comments left out. */
const RULES = [...readFileSync(path.join(__dirname, 'ListToolbar.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));

/** A page that owns every value, as a feature does. */
function Page({ initialFilters = { region: '' }, onClear, ...overrides }) {
  const [segment, setSegment] = useState('all');
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const activeCount = Object.values(filters).filter(Boolean).length;
  return (
    <ListToolbar
      segments={{ ariaLabel: 'Show', items: SEGMENTS, value: segment, onChange: setSegment }}
      toggle={{ label: 'Only mine', checked: mine, onChange: setMine }}
      search={{ label: 'Search records', placeholder: 'Search name or reference', value: query, onChange: setQuery }}
      filters={{
        open,
        onOpenChange: setOpen,
        activeCount,
        onClear: () => { onClear?.(); setFilters({ region: '' }); },
        children: (
          <FormField label="Region">
            <Select value={filters.region} onChange={(event) => setFilters({ region: event.target.value })}>
              <option value="">Any region</option>
              <option value="north">North</option>
            </Select>
          </FormField>
        ),
      }}
      actions={<button type="button">New record</button>}
      {...overrides}
    />
  );
}

describe('ListToolbar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('segments', () => {
    it('are buttons in a named group, the chosen one pressed', () => {
      render(<Page />);

      const group = screen.getByRole('group', { name: 'Show' });
      expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(group).getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('report the one pressed, and the page decides', () => {
      render(<Page />);

      fireEvent.click(screen.getByRole('button', { name: 'Closed' }));

      expect(screen.getByRole('button', { name: 'Closed' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('say their count as part of their name', () => {
      render(
        <ListToolbar
          segments={{
            ariaLabel: 'Show',
            items: [{ id: 'all', label: 'All', count: 6 }, { id: 'quiet', label: 'Quiet', count: '2+' }],
            value: 'all',
            onChange: vi.fn(),
          }}
        />,
      );

      expect(screen.getByRole('button', { name: 'All 6' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Quiet 2+' })).toBeInTheDocument();
    });
  });

  it('shows the switch with its words, which move it too', () => {
    render(<Page />);

    fireEvent.click(screen.getByText('Only mine'));

    expect(screen.getByRole('switch', { name: 'Only mine' })).toHaveAttribute('aria-checked', 'true');
  });

  it('puts a named search box in a search landmark and reports what is typed', () => {
    render(<Page />);

    const box = within(screen.getByRole('search')).getByRole('searchbox', { name: 'Search records' });
    expect(box).toHaveAttribute('placeholder', 'Search name or reference');
    fireEvent.change(box, { target: { value: 'north' } });
    expect(box).toHaveValue('north');
  });

  describe('filters', () => {
    it('open from a Filters button that says whether they are open', () => {
      render(<Page />);
      const button = screen.getByRole('button', { name: 'Filters' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('group', { name: 'Filters' })).toBeNull();

      fireEvent.click(button);

      const row = screen.getByRole('group', { name: 'Filters' });
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button).toHaveAttribute('aria-controls', row.id);
      expect(within(row).getByRole('combobox', { name: 'Region' })).toBeInTheDocument();
    });

    it('say how many apply, and offer Clear filters only then', () => {
      render(<Page />);
      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

      fireEvent.change(screen.getByRole('combobox', { name: 'Region' }), { target: { value: 'north' } });

      expect(screen.getByRole('button', { name: 'Filters 1 applied' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });

    it('clear, and leave focus on the Filters button rather than nowhere', () => {
      const onClear = vi.fn();
      render(<Page initialFilters={{ region: 'north' }} onClear={onClear} />);
      fireEvent.click(screen.getByRole('button', { name: 'Filters 1 applied' }));

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

      expect(onClear).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
    });
  });

  it('keeps the page actions in the row, after its own controls', () => {
    render(<Page />);

    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons.at(-1)).toBe('New record');
  });

  it('is not a toolbar, so the arrow keys stay with the search box', () => {
    render(<Page />);

    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('draws only the parts it is given', () => {
    render(<ListToolbar search={{ label: 'Search records', value: '', onChange: vi.fn() }} />);

    expect(screen.getByRole('searchbox', { name: 'Search records' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('placement', () => {
    it('is the card strip by default, its segments underlined as they have always been', () => {
      const { container } = render(<Page />);

      const toolbar = container.querySelector('.ds-list-toolbar');
      expect(toolbar).toHaveAttribute('data-placement', 'card');
      expect(screen.getByRole('group', { name: 'Show' })).toHaveAttribute('data-variant', 'underline');
      expect(screen.getByRole('group', { name: 'Show' })).not.toHaveClass('ds-segmented-group');
    });

    it('draws the page row with its segments as the segmented tray', () => {
      const { container } = render(<Page placement="page" />);

      expect(container.querySelector('.ds-list-toolbar')).toHaveAttribute('data-placement', 'page');
      const group = screen.getByRole('group', { name: 'Show' });
      expect(group).toHaveClass('ds-segmented-group');
      expect(group).toHaveAttribute('data-variant', 'segmented');
      expect(within(group).getByRole('button', { name: 'All' })).toHaveClass('ds-segmented-group__item');
      // Still a named group of pressed buttons, not tabs.
      expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('keeps a tray in a card strip its own padding and border, spacing it by its margin', () => {
      render(
        <ListToolbar
          segments={{ ariaLabel: 'Status', items: SEGMENTS, value: 'open', onChange: vi.fn(), variant: 'segmented' }}
        />,
      );

      const group = screen.getByRole('group', { name: 'Status' });
      expect(group).toHaveAttribute('data-variant', 'segmented');
      expect(group).toHaveClass('ds-segmented-group');
      const cardRules = RULES.filter(({ selector }) => selector.includes("[data-placement='card']")
        && selector.includes('.ds-list-toolbar__segments')
        && !selector.includes('.ds-list-toolbar__segment ')
        && !selector.includes("[data-variant='underline']"));
      expect(cardRules.length).toBeGreaterThan(0);
      cardRules.forEach(({ selector, body }) => {
        // Padding or a border on the tray itself would resize it and move its items off centre.
        if (!selector.includes("[data-variant='pill']") && !selector.includes(":not([data-variant='segmented'])")) {
          expect(body).not.toMatch(/(^|[\s;])(padding|border)[\w-]*\s*:/);
        }
      });
    });

    it('takes the pill look for a second, lighter strip of segments', () => {
      render(
        <ListToolbar
          segments={{ ariaLabel: 'Status', items: SEGMENTS, value: 'open', onChange: vi.fn(), variant: 'pill' }}
        />,
      );

      expect(screen.getByRole('group', { name: 'Status' })).toHaveAttribute('data-variant', 'pill');
      expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    });

    it.each([[2, '2'], [3, '3'], [4, '2'], [6, '3']])('lays %i segments out in rows of %s on a phone', (count, columns) => {
      const items = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `Part ${i + 1}` }));
      render(<ListToolbar placement="page" segments={{ ariaLabel: 'Show', items, value: 's0', onChange: vi.fn() }} />);

      expect(screen.getByRole('group', { name: 'Show' })).toHaveAttribute('data-phone-columns', columns);
    });
  });

  describe('order of the controls', () => {
    const labels = (container) => [...container.querySelectorAll('.ds-list-toolbar__tools > *')]
      .map((part) => part.className.match(/ds-list-toolbar__(search|toggle|filters-button|actions)/)?.[1]);

    it('leads the page row with the search, then the switch, Filters and the actions', () => {
      const { container } = render(<Page placement="page" />);

      expect(labels(container)).toEqual(['search', 'toggle', 'filters-button', 'actions']);
      expect(container.querySelector('.ds-list-toolbar')).toHaveAttribute('data-search-first');
    });

    it('keeps the switch first in a card strip with segments, as it has always been', () => {
      const { container } = render(<Page />);

      expect(labels(container)).toEqual(['toggle', 'search', 'filters-button', 'actions']);
      expect(container.querySelector('.ds-list-toolbar')).not.toHaveAttribute('data-search-first');
    });

    it('leads a card strip without segments with the search', () => {
      const { container } = render(<Page segments={undefined} />);

      expect(labels(container)).toEqual(['search', 'toggle', 'filters-button', 'actions']);
      expect(container.querySelector('.ds-list-toolbar')).toHaveAttribute('data-search-first');
    });

    it('never reorders a control, so the rows on a phone are read in the order Tab takes them', () => {
      RULES.forEach(({ selector, body }) => {
        expect(`${selector} {${body}}`).not.toMatch(/(^|[\s;{])order\s*:/);
      });
    });

    it('puts a page-level scope control first, before the segments', () => {
      const { container } = render(
        <Page placement="page" lead={<nav aria-label="Record lists"><a href="#all">All</a></nav>} />,
      );

      const bar = container.querySelector('.ds-list-toolbar__bar');
      expect(bar.firstElementChild).toHaveClass('ds-list-toolbar__lead');
      expect(within(bar.firstElementChild).getByRole('navigation', { name: 'Record lists' })).toBeInTheDocument();
      expect(bar.children[1]).toHaveAttribute('role', 'group');
    });
  });

  describe('when the tools no longer fit beside the segments', () => {
    let resize;
    let widths;

    let observed;

    function stubLayout() {
      observed = new Set();
      widths = { bar: 1200, segments: 500, search: 240, toggle: 150, filters: 100, actions: 120 };
      const widthOf = (element) => {
        const name = Object.keys(widths).find((key) => element.classList?.contains(
          {
            bar: 'ds-list-toolbar__bar',
            segments: 'ds-list-toolbar__segments',
            search: 'ds-list-toolbar__search',
            toggle: 'ds-list-toolbar__toggle',
            filters: 'ds-list-toolbar__filters-button',
            actions: 'ds-list-toolbar__actions',
          }[key],
        ));
        return name ? widths[name] : 0;
      };
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function offsetWidth() { return widthOf(this); });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth() { return widthOf(this); });
      vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { resize = () => callback([]); }

        observe(element) { observed.add(element); }

        disconnect() { observed.clear(); }
      });
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('take a row of their own, and come back when there is room again', () => {
      stubLayout();
      const { container } = render(<Page placement="page" />);
      const toolbar = container.querySelector('.ds-list-toolbar');
      expect(toolbar).not.toHaveAttribute('data-wrapped');

      widths.bar = 800;
      act(() => resize());
      expect(toolbar).toHaveAttribute('data-wrapped', 'true');

      widths.bar = 1200;
      act(() => resize());
      expect(toolbar).not.toHaveAttribute('data-wrapped');
    });

    it('re-measure when the row gains a part without changing size', () => {
      stubLayout();
      widths.bar = 1080;
      const { container, rerender } = render(<Page placement="page" actions={null} />);
      expect(container.querySelector('.ds-list-toolbar')).not.toHaveAttribute('data-wrapped');

      rerender(<Page placement="page" actions={<button type="button">Assign (2)</button>} />);
      expect(container.querySelector('.ds-list-toolbar')).toHaveAttribute('data-wrapped', 'true');
    });

    it('follow a tools block that appears after the first draw', () => {
      stubLayout();
      const segments = { ariaLabel: 'Show', items: SEGMENTS, value: 'all', onChange: vi.fn() };
      const { container, rerender } = render(<ListToolbar placement="page" segments={segments} />);
      expect(container.querySelector('.ds-list-toolbar__tools')).toBeNull();

      rerender(<ListToolbar placement="page" segments={segments} actions={<button type="button">Assign (2)</button>} />);

      expect(observed.has(container.querySelector('.ds-list-toolbar__tools'))).toBe(true);
    });

    it('stay on the row until measured to wrap: the row itself never wraps them before', () => {
      const unwrapped = RULES.find(({ selector }) => selector
        === ".ds-list-toolbar[data-placement='page']:not([data-wrapped]) .ds-list-toolbar__bar");
      expect(unwrapped?.body).toMatch(/flex-wrap:\s*nowrap/);
      // The width the measurement counts the search at is the least the row lets it shrink to.
      const search = RULES.find(({ selector }) => selector === ".ds-list-toolbar[data-placement='page'] .ds-list-toolbar__search");
      expect(search.body).toMatch(/min-width:\s*236px/);
    });

    it('are never measured in a card strip, which keeps its own wrapping', () => {
      stubLayout();
      widths.bar = 600;
      const { container } = render(<Page />);

      expect(container.querySelector('.ds-list-toolbar')).not.toHaveAttribute('data-wrapped');
    });
  });

  it('decides the fit from the widths alone, and calls an unmeasured row a fit', () => {
    expect(toolsFit({ available: 1000, leading: 500, gap: 12, tools: 488 })).toBe(true);
    expect(toolsFit({ available: 1000, leading: 500, gap: 12, tools: 489 })).toBe(false);
    expect(toolsFit({ available: 0, leading: 500, gap: 12, tools: 900 })).toBe(true);
    expect(toolsFit({ available: 600, leading: 0, gap: 12, tools: 900 })).toBe(true);
  });

  describe('refuses a setting it cannot act on', () => {
    const segments = { ariaLabel: 'Show', items: SEGMENTS, value: 'all', onChange: () => {} };

    it.each([
      ['segments with no name', { segments: { ...segments, ariaLabel: '' } }, 'need an ariaLabel'],
      ['a single segment', { segments: { ...segments, items: [SEGMENTS[0]] } }, 'at least two items'],
      ['a value that is not a segment', { segments: { ...segments, value: 'gone' } }, 'value "gone" is not one of its items'],
      ['a search with no label', { search: { label: ' ', onChange: () => {} } }, 'search needs a label'],
      ['a search that keeps nothing typed', { search: { label: 'Search records', value: '' } }, 'search needs onChange'],
      ['a switch that cannot change', { toggle: { label: 'Only mine', checked: false } }, 'toggle needs onChange'],
      ['filters with no way to clear them', { filters: { open: false, onOpenChange: () => {} } }, 'need onOpenChange and onClear'],
      ['a placement it does not have', { placement: 'floating' }, 'Unsupported ListToolbar placement "floating"'],
      ['a segment look it does not have', { segments: { ...segments, variant: 'tabs' } }, 'segments variant "tabs"'],
    ])('%s', (_name, props, message) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<ListToolbar {...props} />)).toThrow(message);
    });
  });

  it('has no accessibility violations as a page row with a scope control', async () => {
    const { container } = render(
      <Page
        placement="page"
        initialFilters={{ region: 'north' }}
        lead={<nav aria-label="Record lists"><a href="#all" aria-current="page">All</a></nav>}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filters 1 applied' }));

    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no accessibility violations with every part shown and the filters open', async () => {
    const { container } = render(<Page initialFilters={{ region: 'north' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters 1 applied' }));

    expect((await axe(container)).violations).toEqual([]);
  });
});
