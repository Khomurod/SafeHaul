import React, { Fragment, memo, useId, useMemo } from 'react';
import { AlertTriangle, Icon } from '../../icons';
import { defineTableColumns } from './tableColumnContract';
import { useCardsLayout } from './useCardsLayout';
import { useScrollEdges } from './useScrollEdges';
import { ariaSortOf, checkSort } from './sorting';
import { SortButton } from './SortControls';
import { CardStrip, SelectionCheckbox } from './SelectionControls';
import { TablePagination } from './TablePagination';
import { LoadingRows, SelectionGutter, StateContent } from './TableStates';
import { RowDetailContent } from './rowDetail';
import { rowDetailOf } from './rowDetailOf';
import { cardLabelOf, cardRoleOf, isEmptyCellContent, usesMobileRoles } from './mobileRoles';
import { contractViolation } from '../../contract';
import './DataTable.css';
import './selection.css';
import './pinnedColumn.css';
import './mobileCards.css';
import './roleCards.css';
import './rowDetail.css';
import './scrollEdges.css';

/**
 * The narrowest a table may get before its region scrolls sideways. `none` sets
 * no floor, for a small table whose columns squeeze to fit their container.
 */
const MIN_WIDTHS = new Set(['none', 'standard', 'wide']);

/**
 * The tallest the rows may get before they scroll under the sticky header:
 * `sm` 256px, `md` 400px. Without it the table grows with its rows, or fills a
 * parent of bounded height.
 */
const MAX_HEIGHTS = new Set(['sm', 'md']);

/**
 * The cells' side padding from 768px: `standard` 16px, or `tight` 12px between
 * columns (16px still at the table's two edges), for a work list whose many
 * columns must hold their content on one line at 1440px, as C2 draws
 * Unfinished applications and Referral Links.
 */
const CELL_PADDINGS = new Set(['standard', 'tight']);

/**
 * The page sizes the "Rows per page" list may offer, or `null` for no list. A
 * setting the table cannot act on is reported and the list left out, so a
 * production build keeps Previous and Next rather than a list that does nothing.
 */
function usablePageSizes(pagination) {
  const sizes = pagination?.pageSizes;
  if (sizes === undefined || sizes === null) return null;
  const counts = Array.isArray(sizes) && sizes.length > 0
    && sizes.every((size) => Number.isInteger(size) && size > 0);
  if (!counts) {
    contractViolation('DataTable pagination.pageSizes must be a non-empty list of whole numbers above 0.');
    return null;
  }
  if (typeof pagination.onPageSizeChange !== 'function') {
    contractViolation('DataTable pagination.pageSizes needs pagination.onPageSizeChange.');
    return null;
  }
  if (!sizes.includes(pagination.pageSize)) {
    contractViolation(`DataTable pagination.pageSize "${pagination.pageSize}" is not one of pagination.pageSizes.`);
    return null;
  }
  return sizes;
}

/**
 * The label a cell shows beside its value as a card on a phone: the column's
 * `mobileLabel`, else its visible header, else its accessible one. `''` is none.
 */
function mobileLabelOf(column) {
  if (column.mobileLabel !== undefined) return column.mobileLabel || undefined;
  return (typeof column.header === 'string' && column.header) || column.headerLabel || undefined;
}

/**
 * Where a card by role puts its `status` column: `corner` (top right) or
 * `below` (a line under the title on a phone narrower than 412px). Anything
 * else, or `below` with no status column to move, is reported and left out.
 */
const CARD_STATUS_PLACES = new Set(['corner', 'below']);
function cardStatusOf(mobileStatus, columns) {
  if (!CARD_STATUS_PLACES.has(mobileStatus)) {
    contractViolation(`Unsupported DataTable mobileStatus "${mobileStatus}"; use ${[...CARD_STATUS_PLACES].join(', ')}.`);
    return 'corner';
  }
  if (mobileStatus === 'below' && !columns.some((column) => column.mobileRole === 'status')) {
    contractViolation('DataTable mobileStatus="below" moves the card\'s status column; no column has mobileRole "status".');
    return 'corner';
  }
  return mobileStatus;
}

/**
 * Accessible, business-neutral table primitive.
 *
 * Features own data, column content, actions, the sort order (`sort` and
 * `onSortChange`), and pagination callbacks. This component owns the visual
 * column contract, the sort control in a sortable column's header (a "Sort by"
 * list above the cards on a phone), state treatment, selection mechanics,
 * keyboard row activation, and responsive scrolling.
 *
 * On a phone the table scrolls sideways inside its labelled region and, by
 * default, pins its first column so the row's label stays in view — the
 * checkbox column too when there is a selection, with the identifying column
 * pinned beside it. `pinFirstColumn={false}` opts out for a table whose first
 * column is not what identifies the row. See pinnedColumn.css for the rule and
 * the standard it applies.
 *
 * `mobilePresentation="cards"` is the other shape that rule allows, for rows
 * worked one record at a time: under 768px each row is a card, its row header
 * the title and every value under its column's label (`mobileCards.css`), or,
 * once its columns state a `mobileRole`, laid out by role (`mobileRoles.js`,
 * `roleCards.css`). The table then states its roles itself, since
 * `display: block` can drop them, and a card pins nothing; at 768px and up it is
 * the table it always was, its first column pinned. With a `selection`, each
 * card leads with its checkbox and a strip above the cards holds "Select all"
 * beside "Sort by", since the header row is hidden. `mobileStatus="below"`
 * moves a card's status from its corner to a line under the title on a phone
 * narrower than 412px, so every card keeps one shape there.
 *
 * `reserveSelection` keeps the checkbox column's place on a table without a
 * selection — empty, and nothing to assistive technology — so its columns
 * stand where a sibling list's do beside its checkboxes.
 *
 * `getRowDetail(row)` returns `{ tone, content }` (or `null`): a sentence about
 * the record that belongs to no column, drawn under it as a row of its own
 * across the table, or as a line of its card by role (`rowDetailOf.js`). The
 * row's header cell points at it (`aria-describedby`); it is never part of the
 * row's name.
 *
 * `maxHeight` caps a table that shares its space, such as one inside a panel or
 * a dialog: its rows scroll under the sticky header. A parent of bounded height
 * needs no cap, since the table fills it and scrolls the same way.
 */
export const DataTable = /* @__PURE__ */ memo(function DataTable({
  ariaLabel,
  data = [],
  columns = [],
  getRowId = (row) => row.id,
  getRowLabel,
  onRowActivate,
  getRowTone,
  density = 'comfortable',
  cellPadding = 'standard',
  minWidth = 'wide',
  maxHeight,
  mobilePresentation = 'scroll',
  pinFirstColumn = true,
  mobileHint = 'Swipe horizontally to view all columns and actions.',
  embedded = false,
  isLoading = false,
  loadingLabel = 'Loading records',
  empty = { title: 'No records found.' },
  error,
  selection,
  pagination,
  sort,
  onSortChange,
  reserveSelection = false,
  getRowDetail,
  mobileStatus = 'corner',
}) {
  const normalizedColumns = useMemo(() => defineTableColumns(columns), [columns]);
  const detailIdBase = useId();
  const selectedSet = useMemo(() => {
    if (selection?.selectedIds instanceof Set) return selection.selectedIds;
    return new Set(selection?.selectedIds || []);
  }, [selection?.selectedIds]);

  const rowIds = useMemo(() => data.map(getRowId), [data, getRowId]);
  const selectedOnPage = rowIds.filter((id) => selectedSet.has(id)).length;
  const allRowsSelected = rowIds.length > 0 && selectedOnPage === rowIds.length;
  const someRowsSelected = selectedOnPage > 0 && !allRowsSelected;
  const showSelection = Boolean(selection);
  /** The checkbox column, or its place kept empty; none without either. */
  let gutter = null;
  if (showSelection) gutter = 'selection';
  else if (reserveSelection) gutter = 'reserve';
  /** Every column the table draws, the checkbox column or its place included. */
  const columnSpan = normalizedColumns.length + (gutter ? 1 : 0);
  /** The header's checkbox; on cards it sits in the strip above them. */
  const selectAll = showSelection ? {
    checked: allRowsSelected,
    indeterminate: someRowsSelected,
    label: selection.selectAllLabel || 'Select all rows on this page',
    onChange: (event) => selection.onToggleAll?.(!allRowsSelected, event),
  } : null;
  const normalizedError = typeof error === 'string' ? { message: error } : error;
  const showInlineError = normalizedError && data.length > 0 && !isLoading;
  let bodyState = null;
  if (!isLoading && data.length === 0) bodyState = normalizedError ? 'error' : 'empty';
  const cards = mobilePresentation === 'cards';
  /**
   * Where a table scrolls sideways, an empty or failed list is drawn under the
   * scroll region, as wide as the card: as a row spanning the table, a phone
   * would centre it across columns scrolled out of sight. Cards keep it as a
   * row, since a card is the screen's width and its header row is hidden.
   */
  const statePanel = cards ? null : bodyState;
  /** Cards on screen now; at 768px and up the same table can scroll sideways. */
  const cardsOnScreen = useCardsLayout(cards);
  const [scrollFrameRef, scrollRegionRef] = useScrollEdges();
  const roles = usesMobileRoles(cards, normalizedColumns);
  if (!cards && normalizedColumns.some((column) => column.mobileRole !== undefined)) {
    contractViolation('A DataTable column mobileRole places a value on a phone card; it needs mobilePresentation="cards".');
  }
  checkSort(normalizedColumns, sort, onSortChange);
  const cardStatus = cardStatusOf(mobileStatus, normalizedColumns);
  let tableMinWidth = minWidth;
  if (!MIN_WIDTHS.has(minWidth)) {
    contractViolation(`Unsupported DataTable minWidth "${minWidth}"; use ${[...MIN_WIDTHS].join(', ')}.`);
    tableMinWidth = 'wide';
  }
  if (!CELL_PADDINGS.has(cellPadding)) {
    contractViolation(`Unsupported DataTable cellPadding "${cellPadding}"; use ${[...CELL_PADDINGS].join(' or ')}.`);
  }
  let tableMaxHeight = maxHeight ?? undefined;
  if (tableMaxHeight !== undefined && !MAX_HEIGHTS.has(tableMaxHeight)) {
    contractViolation(`Unsupported DataTable maxHeight "${maxHeight}"; use ${[...MAX_HEIGHTS].join(', ')}.`);
    tableMaxHeight = undefined;
  }
  const pageSizes = usablePageSizes(pagination);
  /** A role stated outright, in cards only; a table's own markup carries it otherwise. */
  const role = (name) => (cards ? name : undefined);

  const handleRowKeyDown = (event, row) => {
    if (!onRowActivate || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowActivate(row);
    }
  };

  return (
    <section
      className="ds-data-table"
      data-density={density}
      data-cell-padding={cellPadding === 'tight' ? 'tight' : undefined}
      data-mobile-presentation={mobilePresentation}
      data-mobile-roles={roles || undefined}
      data-mobile-lead={(roles && normalizedColumns.some((column) => column.mobileRole === 'lead')) || undefined}
      /* A card pins nothing: the pin is for a table that scrolls sideways. */
      data-pin-first-column={(pinFirstColumn && !cardsOnScreen) || undefined}
      data-has-selection={showSelection || undefined}
      data-reserve-selection={gutter === 'reserve' || undefined}
      data-mobile-status={(roles && cardStatus !== 'corner' && cardStatus) || undefined}
      data-row-details={typeof getRowDetail === 'function' || undefined}
      data-row-header-avatar={normalizedColumns.some((column) => column.rowHeader && column.leadingAvatar) || undefined}
      data-embedded={embedded || undefined}
      data-max-height={tableMaxHeight}
      data-state={statePanel || undefined}
      aria-busy={isLoading || undefined}
    >
      {showInlineError && (
        <div className="ds-data-table__notice" role="alert">
          <Icon icon={AlertTriangle} size="lg" />
          <span>{normalizedError.message}</span>
          {normalizedError.onRetry && (
            <button type="button" onClick={normalizedError.onRetry}>Retry</button>
          )}
        </div>
      )}

      {cardsOnScreen && (
        <CardStrip
          selectAll={showSelection && !bodyState && !isLoading ? selectAll : null}
          columns={normalizedColumns}
          sort={sort}
          onSortChange={onSortChange}
        />
      )}

      {mobilePresentation === 'scroll' && (
        <p className="ds-data-table__mobile-hint">
          {mobileHint}
        </p>
      )}

      {/* The frame shades an edge with columns past it (`scrollEdges.css`). */}
      <div className="ds-data-table__scroll-frame" ref={scrollFrameRef}>
        <div
          ref={scrollRegionRef}
          className="ds-data-table__scroll-region"
          role="region"
          aria-label={cardsOnScreen ? ariaLabel : `${ariaLabel}. Scroll horizontally to view all columns.`}
          tabIndex={0}
        >
          <table data-min-width={tableMinWidth} role={role('table')}>
            <caption className="sr-only">{ariaLabel}</caption>
            <colgroup>
              {gutter && <col data-width="selection" />}
              {normalizedColumns.map((column) => (
                <col key={column.key} data-width={column.width} data-mobile-role={roles ? cardRoleOf(column) : undefined} />
              ))}
            </colgroup>
            <thead role={role('rowgroup')}>
              <tr role={role('row')}>
                {showSelection && (
                  <th className="ds-data-table__selection-cell" scope="col" role={role('columnheader')}>
                    {/* On cards the box moves to the strip above them, under the same name. */}
                    {cardsOnScreen ? <span className="sr-only">Select</span> : <SelectionCheckbox {...selectAll} />}
                  </th>
                )}
                {gutter === 'reserve' && <SelectionGutter />}
                {normalizedColumns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    role={role('columnheader')}
                    data-align={column.align}
                    data-width={column.width}
                    data-truncate={column.truncate || undefined}
                    data-mobile-role={roles ? cardRoleOf(column) : undefined}
                    aria-sort={ariaSortOf(column, sort)}
                  >
                    {column.headerLabel && !column.header ? (
                      <span className="sr-only">{column.headerLabel}</span>
                    ) : column.sortable && !cardsOnScreen ? (
                      <SortButton column={column} sort={sort} onSortChange={onSortChange} />
                    ) : column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role={role('rowgroup')}>
              {isLoading ? (
                <LoadingRows
                  columns={normalizedColumns}
                  gutter={gutter}
                  loadingLabel={loadingLabel}
                  role={role}
                />
              ) : bodyState ? (
                cards && (
                  <tr role={role('row')}>
                    <td role={role('cell')} colSpan={columnSpan}>
                      <StateContent state={bodyState} empty={empty} error={normalizedError} loadingLabel={loadingLabel} />
                    </td>
                  </tr>
                )
              ) : (
                data.map((row, rowIndex) => {
                  const rowId = getRowId(row);
                  const isSelected = selectedSet.has(rowId);
                  const rowTone = getRowTone?.(row) || 'neutral';
                  const detail = rowDetailOf(getRowDetail, row);
                  const detailId = detail ? `${detailIdBase}-detail-${rowIndex}` : undefined;
                  // On a card by role the detail is a line of the card; elsewhere a row of its own.
                  const detailInCard = Boolean(detail && roles && cardsOnScreen);
                  const detailCell = detail && (
                    <td
                      className="ds-data-table__detail"
                      role={role('cell')}
                      colSpan={detailInCard ? undefined : columnSpan}
                      data-detail-tone={detail.tone}
                    >
                      <RowDetailContent id={detailId} detail={detail} />
                    </td>
                  );

                  return (
                    <Fragment key={rowId}>
                      <tr
                        className="ds-data-table__row"
                        role={role('row')}
                        data-interactive={Boolean(onRowActivate)}
                        data-selected={isSelected || undefined}
                        data-tone={rowTone}
                        data-has-detail={(detail && !detailInCard) || undefined}
                        aria-label={getRowLabel?.(row)}
                        aria-describedby={onRowActivate ? detailId : undefined}
                        aria-selected={showSelection ? isSelected : undefined}
                        tabIndex={onRowActivate ? 0 : undefined}
                        onClick={() => onRowActivate?.(row)}
                        onKeyDown={(event) => handleRowKeyDown(event, row)}
                      >
                        {showSelection && (
                          <td
                            className="ds-data-table__selection-cell"
                            role={role('cell')}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <SelectionCheckbox
                              checked={isSelected}
                              label={selection.getRowLabel?.(row) || `Select row ${rowId}`}
                              onChange={(event) => selection.onToggleRow?.(rowId, event)}
                            />
                          </td>
                        )}
                        {gutter === 'reserve' && <SelectionGutter />}
                        {normalizedColumns.map((column) => {
                          const Cell = column.rowHeader ? 'th' : 'td';
                          const content = column.render(row);
                          const cardRole = roles ? cardRoleOf(column) : undefined;
                          return (
                            <Cell
                              key={column.key}
                              scope={column.rowHeader ? 'row' : undefined}
                              role={role(column.rowHeader ? 'rowheader' : 'cell')}
                              aria-describedby={column.rowHeader ? detailId : undefined}
                              data-label={cards && !roles && !column.rowHeader ? mobileLabelOf(column) : undefined}
                              data-mobile-role={cardRole}
                              data-mobile-label={cardRole ? cardLabelOf(column, cardRole) : undefined}
                              data-mobile-empty={(cardRole && isEmptyCellContent(content)) || undefined}
                              data-align={column.align}
                              data-width={column.width}
                              data-truncate={column.truncate || undefined}
                              onClick={column.stopPropagation
                                ? (event) => event.stopPropagation()
                                : undefined}
                            >
                              {content}
                            </Cell>
                          );
                        })}
                        {detailInCard && detailCell}
                      </tr>
                      {detail && !detailInCard && (
                        <tr className="ds-data-table__detail-row" role={role('row')}>
                          {detailCell}
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {statePanel && (
        <div className="ds-data-table__state-panel">
          <StateContent
            state={statePanel}
            empty={empty}
            error={normalizedError}
            loadingLabel={loadingLabel}
          />
        </div>
      )}

      {pagination && !isLoading && (
        <TablePagination ariaLabel={ariaLabel} pagination={pagination} pageSizes={pageSizes} />
      )}
    </section>
  );
});

export default DataTable;
