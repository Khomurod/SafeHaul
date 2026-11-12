import React from 'react';
import { AlertCircle, AlertTriangle, Icon } from '../../icons';

/**
 * A `warning` or `danger` row detail leads with the glyph `Notice` uses for its
 * tone, so the tone is never colour alone; a `neutral` one is a quiet note.
 */
const DETAIL_GLYPHS = {
  neutral: null,
  warning: AlertTriangle,
  danger: AlertCircle,
};

/**
 * A row detail's words after its tone's glyph (`rowDetailOf.js`). `id` is what
 * the row's header cell points at (`aria-describedby`), so the detail
 * describes the row without becoming part of its name.
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
