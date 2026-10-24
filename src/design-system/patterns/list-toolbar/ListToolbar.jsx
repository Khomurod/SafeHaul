import React, { useId, useRef } from 'react';
import { Filter, Icon, Search } from '../../icons';
import { Button, Input, Switch } from '@design-system/components';
import { contractViolation } from '../../contract';
import './ListToolbar.css';

const isText = (value) => typeof value === 'string' && value.trim() !== '';

function checkProps({ segments, toggle, search, filters }) {
  if (segments) {
    if (!isText(segments.ariaLabel)) {
      contractViolation('ListToolbar segments need an ariaLabel naming the set.');
    }
    const items = Array.isArray(segments.items) ? segments.items : [];
    if (items.length < 2) {
      contractViolation('ListToolbar segments need at least two items; one is not a choice.');
    } else if (!items.some((item) => item.id === segments.value)) {
      contractViolation(`ListToolbar segments value "${segments.value}" is not one of its items.`);
    }
    if (typeof segments.onChange !== 'function') {
      contractViolation('ListToolbar segments need onChange.');
    }
  }
  if (toggle && typeof toggle.onChange !== 'function') {
    contractViolation('ListToolbar toggle needs onChange.');
  }
  if (search && !isText(search.label)) {
    contractViolation('ListToolbar search needs a label: the search box shows none of its own.');
  }
  if (filters && (typeof filters.onOpenChange !== 'function' || typeof filters.onClear !== 'function')) {
    contractViolation('ListToolbar filters need onOpenChange and onClear.');
  }
}

/**
 * The one row of controls above a list: which part of the list (`segments`),
 * an on/off narrowing such as "Only mine" (`toggle`), a `search`, the `filters`
 * that open a second row of fields, and the page's own `actions`. Every part is
 * optional, and the page owns every value: this draws the controls and reports
 * what was pressed.
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
  checkProps({ segments, toggle, search, filters });
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
        {segments && (
          <div role="group" aria-label={segments.ariaLabel} className="ds-list-toolbar__segments">
            {segments.items.map((item) => (
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
          {toggle && (
            <Switch
              showLabel
              className="ds-list-toolbar__toggle"
              label={toggle.label}
              checked={toggle.checked}
              onChange={toggle.onChange}
            />
          )}
          {search && (
            <div role="search" className="ds-list-toolbar__search">
              <Icon icon={Search} size="sm" className="ds-list-toolbar__search-icon" />
              <Input
                type="search"
                aria-label={search.label}
                placeholder={search.placeholder ?? search.label}
                value={search.value}
                onChange={(event) => search.onChange?.(event.target.value)}
              />
            </div>
          )}
          {filters && (
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

      {filters?.open && (
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
