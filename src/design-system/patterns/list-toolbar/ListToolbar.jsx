import React, { useId, useRef } from 'react';
import { Filter, Icon, Search } from '../../icons';
import { Button, Input, Switch } from '@design-system/components';
import { contractViolation } from '../../contract';
import './ListToolbar.css';

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Reports each part used against its contract, and says which parts can be
 * drawn. In a production build a report returns, so a part without its list or
 * its callback is left out rather than crashing the page or drawing a control
 * that does nothing.
 */
function checkProps({ segments, toggle, search, filters }) {
  const usable = { segmentItems: null, toggle: false, search: false, filters: false };
  if (segments) {
    if (!isText(segments.ariaLabel)) {
      contractViolation('ListToolbar segments need an ariaLabel naming the set.');
    }
    const items = Array.isArray(segments.items)
      ? segments.items.filter((item) => item && typeof item === 'object')
      : [];
    if (items.length < 2) {
      contractViolation('ListToolbar segments need at least two items; one is not a choice.');
    } else if (!items.some((item) => item.id === segments.value)) {
      contractViolation(`ListToolbar segments value "${segments.value}" is not one of its items.`);
    }
    const choosable = typeof segments.onChange === 'function';
    if (!choosable) {
      contractViolation('ListToolbar segments need onChange.');
    }
    if (items.length >= 2 && choosable) usable.segmentItems = items;
  }
  if (toggle) {
    usable.toggle = typeof toggle.onChange === 'function';
    if (!usable.toggle) contractViolation('ListToolbar toggle needs onChange.');
  }
  if (search) {
    if (!isText(search.label)) {
      contractViolation('ListToolbar search needs a label: the search box shows none of its own.');
    }
    usable.search = typeof search.onChange === 'function';
    if (!usable.search) {
      contractViolation('ListToolbar search needs onChange: without it the box keeps nothing typed.');
    }
  }
  if (filters) {
    usable.filters = typeof filters.onOpenChange === 'function' && typeof filters.onClear === 'function';
    if (!usable.filters) contractViolation('ListToolbar filters need onOpenChange and onClear.');
  }
  return usable;
}

/**
 * The one row of controls above a list: which part of the list (`segments`),
 * an on/off narrowing such as "Only mine" (`toggle`), a `search`, the `filters`
 * that open a second row of fields, and `actions` on the list's records (such
 * as assigning the selected ones). Every part is optional, and the page owns
 * every value: this draws the controls and reports what was pressed.
 *
 * The segments narrow one list; they do not switch between panels, so each is a
 * button with `aria-pressed` in a named group, not a tab in a `tablist`.
 *
 * Not `role="toolbar"`: that role moves focus with the arrow keys, which would
 * take Left and Right away from the caret in the search. Each control is its
 * own Tab stop, in the order it is drawn.
 */
export function ListToolbar({ segments, toggle, search, filters, actions, className = '', ...props }) {
  const filtersId = useId();
  const filtersButton = useRef(null);
  const shown = checkProps({ segments, toggle, search, filters });
  const activeCount = filters?.activeCount ?? 0;

  // "Clear filters" goes away once nothing is applied; focus moves to the
  // Filters button instead of being lost with it.
  const clearFilters = () => {
    filters.onClear();
    filtersButton.current?.focus();
  };

  return (
    <div {...props} className={`ds-list-toolbar ${className}`.trim()}>
      <div className="ds-list-toolbar__bar">
        {shown.segmentItems && (
          <div role="group" aria-label={segments.ariaLabel} className="ds-list-toolbar__segments">
            {/* The toolbar's own buttons, not `SegmentedControl`, which draws
                boxed cards: these are underlined, scroll in one row and carry
                counts. A temporary exception, recorded in the roadmap §3 until
                `SegmentedControl` has that appearance. */}
            {shown.segmentItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ds-list-toolbar__segment"
                aria-pressed={item.id === segments.value}
                onClick={() => segments.onChange(item.id)}
              >
                {item.label}
                {/* The space is the name's: "All 6", not "All6". */}
                {item.count !== undefined && item.count !== null && (
                  <>{' '}<span className="ds-list-toolbar__segment-count">{item.count}</span></>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="ds-list-toolbar__tools">
          {shown.toggle && (
            <Switch
              showLabel
              className="ds-list-toolbar__toggle"
              label={toggle.label}
              checked={toggle.checked}
              onChange={toggle.onChange}
            />
          )}
          {shown.search && (
            <div role="search" className="ds-list-toolbar__search">
              <Icon icon={Search} size="sm" className="ds-list-toolbar__search-icon" />
              <Input
                type="search"
                aria-label={search.label}
                placeholder={search.placeholder ?? search.label}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
              />
            </div>
          )}
          {shown.filters && (
            <Button
              ref={filtersButton}
              variant="secondary"
              aria-expanded={Boolean(filters.open)}
              aria-controls={filters.open ? filtersId : undefined}
              onClick={() => filters.onOpenChange(!filters.open)}
            >
              <Icon icon={Filter} />
              Filters
              {activeCount > 0 && (
                <span className="ds-list-toolbar__filter-count">
                  {activeCount}
                  <span className="ds-visually-hidden"> applied</span>
                </span>
              )}
            </Button>
          )}
          {actions}
        </div>
      </div>

      {shown.filters && filters.open && (
        <div id={filtersId} role="group" aria-label="Filters" className="ds-list-toolbar__filters">
          <div className="ds-list-toolbar__filter-fields">{filters.children}</div>
          {activeCount > 0 && (
            <Button variant="link" className="ds-list-toolbar__clear" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
