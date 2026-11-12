import { contractViolation } from '../../contract';
import { isEmptyCellContent } from './mobileRoles';

/**
 * A ROW DETAIL: a sentence that belongs to one record but to none of its
 * columns — what is wrong with a member, say — drawn under the record across
 * the table rather than squeezed into a cell (`getRowDetail`). Its tones are
 * the row tones, on the same tints (`--ds-table-row-*-bg`); `RowDetailContent`
 * (`rowDetail.jsx`) draws it.
 */
export const ROW_DETAIL_TONES = Object.freeze(['neutral', 'warning', 'danger']);

/**
 * What `getRowDetail` says for a row, or `null` for none. A detail with
 * nothing to say is none; an unknown tone is reported and drawn `neutral`.
 */
export function rowDetailOf(getRowDetail, row) {
  if (typeof getRowDetail !== 'function') return null;
  const detail = getRowDetail(row);
  if (!detail || typeof detail !== 'object' || isEmptyCellContent(detail.content)) return null;
  let tone = detail.tone ?? 'neutral';
  if (!ROW_DETAIL_TONES.includes(tone)) {
    contractViolation(`Unsupported DataTable row detail tone "${tone}"; use ${ROW_DETAIL_TONES.join(', ')}.`);
    tone = 'neutral';
  }
  return { tone, content: detail.content };
}
