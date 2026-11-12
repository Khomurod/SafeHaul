import React from 'react';
import { AlertCircle, AlertTriangle, Icon } from '../../icons';
import { contractViolation } from '../../contract';
import { isEmptyCellContent } from './mobileRoles';

/**
 * A ROW DETAIL: a sentence that belongs to one record but to none of its
 * columns — what is wrong with a member, say — drawn under the record across
 * the table rather than squeezed into a cell (`getRowDetail`).
 *
 * The tones are the row tones, on the same tints (`--ds-table-row-*-bg`): a
 * `warning` or `danger` detail leads with the glyph `Notice` uses for its tone,
 * so the tone is never colour alone; a `neutral` one is a quiet note.
 */
const DETAIL_GLYPHS = {
  neutral: null,
  warning: AlertTriangle,
  danger: AlertCircle,
};

/**
 * What `getRowDetail` says for a row, or `null` for none. A detail with
 * nothing to say is none; an unknown tone is reported and drawn `neutral`.
 */
export function rowDetailOf(getRowDetail, row) {
  if (typeof getRowDetail !== 'function') return null;
  const detail = getRowDetail(row);
  if (!detail || typeof detail !== 'object' || isEmptyCellContent(detail.content)) return null;
  let tone = detail.tone ?? 'neutral';
  if (!(tone in DETAIL_GLYPHS)) {
    contractViolation(`Unsupported DataTable row detail tone "${tone}"; use ${Object.keys(DETAIL_GLYPHS).join(', ')}.`);
    tone = 'neutral';
  }
  return { tone, content: detail.content };
}

/**
 * The detail's words after its tone's glyph. `id` is what the row's header
 * cell points at (`aria-describedby`), so the detail describes the row without
 * becoming part of its name.
 */
export function RowDetailContent({ id, detail }) {
  const glyph = DETAIL_GLYPHS[detail.tone];
  return (
    <div className="ds-data-table__detail-content">
      {glyph && <Icon icon={glyph} className="ds-data-table__detail-glyph" />}
      <div id={id} className="ds-data-table__detail-text">{detail.content}</div>
    </div>
  );
}
