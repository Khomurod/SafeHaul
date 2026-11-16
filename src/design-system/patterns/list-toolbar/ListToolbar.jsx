import React, { useId, useRef } from 'react';
import { Filter, Icon, Search } from '../../icons';
import { Button, Input, Switch } from '@design-system/components';
import { phoneColumnsFor, reservedText, useTrayWraps } from '../../components/tabs/segmentedGroup';
import { contractViolation } from '../../contract';
import { useToolsWrap } from './useToolsWrap';
import './ListToolbar.css';

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** Where the row sits: the top strip of the list's card, or above the card on the page. */
const PLACEMENTS = new Set(['card', 'page']);

/**
 * How the segments are drawn. `underline` is the card strip's own look;
 * `segmented` (the page row's default) and `pill` are the shared
 * `segmentedGroup.css` drawing `TabList` and `TabNav` also use.
 */
const SEGMENT_VARIANTS = new Set(['underline', 'segmented', 'pill']);

/**
 * Reports each part used against its contract, and says which parts can be
 * drawn. In a production build a report returns, so a part without its list or
 * its callback is left out rather than crashing the page or drawing a control
 * that does nothing, and an unknown placement or look takes its default.
 */
function checkProps({ placement, segments, toggle, search, filters }) {
  const usable = {
    placement: PLACEMENTS.has(placement) ? placement : 'card',
    segmentItems: null,
    segmentVariant: 'underline',
    toggle: false,
    search: false,
    filters: false,
  };
  if (!PLACEMENTS.has(placement)) {
    contractViolation(`Unsupported ListToolbar placement "${placement}"; use ${[...PLACEMENTS].join(' or ')}.`);
  }
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
    const variant = segments.variant ?? (usable.placement === 'page' ? 'segmented' : 'underline');
    if (SEGMENT_VARIANTS.has(variant)) {
      usable.segmentVariant = variant;
    } else {
      contractViolation(`Unsupported ListToolbar segments variant "${variant}"; use ${[...SEGMENT_VARIANTS].join(', ')}.`);
      usable.segmentVariant = usable.placement === 'page' ? 'segmented' : 'underline';
    }
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
 * The one row of controls above a list: a page-level scope control (`lead`,
 * such as a `TabNav`), which part of the list (`segments`), an on/off
 * narrowing such as "Only mine" (`toggle`), a `search`, the `filters` that
 * open a second row of fields, and `actions` on the list's records (such as
 * assigning the selected ones). Every part is optional, and the page owns
 * every value: this draws the controls and reports what was pressed.
 *
 * `reserveActions` is for actions shown only while rows are selected: the page
 * row keeps their place in its layout while they are absent, so ticking a row
 * adds no line above the list and nothing moves under the finger. Filters then
 * shares its row with them wherever the search needs a row of its own.
 *
 * `placement="card"` (the default) is the top strip inside the list's card;
 * `placement="page"` is a row of its own above the table card, with no surface,
 * its segments a segmented tray and its tools ending on the table's edge. When
 * the tools do not fit beside the segments they take a row of their own,
 * starting at the left (`data-wrapped`, measured, not guessed from the window).
 *
 * The segments narrow one list; they do not switch between panels, so each is a
 * button with `aria-pressed` in a named group, not a tab in a `tablist`.
 *
 * Not `role="toolbar"`: that role moves focus with the arrow keys, which would
 * take Left and Right away from the caret in the search. Each control is its
 * own Tab stop, in the order it is drawn.
 */
export function ListToolbar({
  placement = 'card',
  lead,
  segments,
  toggle,
  search,
  filters,
  actions,
  reserveActions = false,
  className = '',
  ...props
}) {
  const filtersId = useId();
  const filtersButton = useRef(null);
  const shown = checkProps({ placement, segments, toggle, search, filters });
  const activeCount = filters?.activeCount ?? 0;
  const hasLead = lead !== undefined && lead !== null && lead !== false;
  const hasSegments = Boolean(shown.segmentItems);
  /*
   * The search leads the tools on the page row and in a card strip that has no
   * segments (the search is then the strip's first control). A card strip with
   * segments keeps the order it has always had: the switch, then the search.
   */
  const searchFirst = shown.placement === 'page' || !hasSegments;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  /** The page row keeps the place of actions that come with a selection. */
  const reservesActions = Boolean(reserveActions) && shown.placement === 'page';
  const hasTools = shown.toggle || shown.search || shown.filters || hasActions;
  const { barRef, toolsRef, wrapped } = useToolsWrap(
    shown.placement === 'page' && (hasLead || hasSegments),
    `${hasLead}:${hasSegments}:${hasTools}`,
  );
  // A page row's tray too wide for the row (six Applications segments beside
  // the menu on a tablet) takes its full-row layout, as on a phone: 3 x 2, not
  // a ragged four and two.
  const [segmentsRef, segmentsWrapped] = useTrayWraps(
    shown.placement === 'page' && hasSegments && shown.segmentVariant === 'segmented',
  );

  // "Clear filters" goes away once nothing is applied; focus moves to the
  // Filters button instead of being lost with it.
  const clearFilters = () => {
    filters.onClear();
    filtersButton.current?.focus();
  };

  const toggleControl = shown.toggle && (
    <Switch
      key="toggle"
      showLabel
      className="ds-list-toolbar__toggle"
      label={toggle.label}
      checked={toggle.checked}
      onChange={toggle.onChange}
    />
  );
  const searchControl = shown.search && (
    <div key="search" role="search" className="ds-list-toolbar__search">
      <Icon icon={Search} size="sm" className="ds-list-toolbar__search-icon" />
      <Input
        type="search"
        aria-label={search.label}
        placeholder={search.placeholder ?? search.label}
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
      />
    </div>
  );

  return (
    <div
      {...props}
      className={`ds-list-toolbar ${className}`.trim()}
      data-placement={shown.placement}
      data-has-segments={hasSegments || undefined}
      data-search-first={searchFirst || undefined}
      data-wrapped={wrapped || undefined}
      data-reserve-actions={reservesActions || undefined}
    >
      <div ref={barRef} className="ds-list-toolbar__bar">
        {hasLead && <div className="ds-list-toolbar__lead">{lead}</div>}

        {hasSegments && (
          <div
            ref={segmentsRef}
            role="group"
            aria-label={segments.ariaLabel}
            className={`ds-list-toolbar__segments${shown.segmentVariant === 'underline' ? '' : ' ds-segmented-group'}`}
            data-variant={shown.segmentVariant}
            data-phone-columns={phoneColumnsFor(shown.segmentItems.length)}
            data-wrapped={segmentsWrapped ? 'true' : undefined}
          >
            {/* The toolbar's own buttons, not `SegmentedControl`, which draws
                boxed cards for a form choice: these carry counts and narrow a
                list. A temporary exception, recorded in the roadmap §3. */}
            {shown.segmentItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ds-list-toolbar__segment${shown.segmentVariant === 'underline' ? '' : ' ds-segmented-group__item'}`}
                aria-pressed={item.id === segments.value}
                onClick={() => segments.onChange(item.id)}
              >
                {shown.segmentVariant === 'underline' ? item.label : (
                  <span className="ds-segmented-group__label" data-text={reservedText(item.label)}>{item.label}</span>
                )}
                {/* The space is the name's: "All 6", not "All6". */}
                {item.count !== undefined && item.count !== null && (
                  <>{' '}<span className="ds-list-toolbar__segment-count ds-segmented-group__count">{item.count}</span></>
                )}
              </button>
            ))}
          </div>
        )}

        {hasTools && (
          <div ref={toolsRef} className="ds-list-toolbar__tools">
            {searchFirst ? [searchControl, toggleControl] : [toggleControl, searchControl]}
            {shown.filters && (
              <Button
                ref={filtersButton}
                variant="secondary"
                className="ds-list-toolbar__filters-button"
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
            {hasActions && <div className="ds-list-toolbar__actions">{actions}</div>}
          </div>
        )}
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
