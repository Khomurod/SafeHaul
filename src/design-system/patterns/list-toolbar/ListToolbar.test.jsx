import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormField, Select } from '@design-system/components';
import { ListToolbar } from './ListToolbar';

const SEGMENTS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

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
    ])('%s', (_name, props, message) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<ListToolbar {...props} />)).toThrow(message);
    });
  });

  it('has no accessibility violations with every part shown and the filters open', async () => {
    const { container } = render(<Page initialFilters={{ region: 'north' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters 1 applied' }));

    expect((await axe(container)).violations).toEqual([]);
  });
});
