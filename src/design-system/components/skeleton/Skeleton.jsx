import React from 'react';
import { contractViolation } from '../../contract';
import './Skeleton.css';

/**
 * A grey placeholder standing where content will arrive, shaped like that
 * content so the layout does not jump when it does.
 *
 * Closed sets, holding only what a consumer uses: a `line` stands in for text
 * and takes the height of the text it sits in; a `block` stands in for a tall
 * control and takes its one measured height. A new width or height arrives with
 * the consumer that needs it.
 */
const SHAPES = new Set(['line', 'block']);
const WIDTHS = new Set(['half', 'three-quarters', 'full']);
const BLOCK_HEIGHTS = new Set(['lg']);

export function Skeleton({ shape = 'line', width = 'full', height, className = '' }) {
  // In a production build a check reports and returns (`contractViolation`), and
  // the placeholder draws its default: a full-width line, or a block at `lg`.
  let drawnShape = shape;
  if (!SHAPES.has(shape)) {
    contractViolation(`Unsupported Skeleton shape: ${shape}. Expected 'line' or 'block'.`);
    drawnShape = 'line';
  }
  let drawnWidth = width;
  if (!WIDTHS.has(width)) {
    contractViolation(`Unsupported Skeleton width: ${width}. Expected 'half', 'three-quarters' or 'full'.`);
    drawnWidth = 'full';
  }
  let drawnHeight;
  if (drawnShape === 'block') {
    drawnHeight = height;
    if (!BLOCK_HEIGHTS.has(height)) {
      contractViolation(`A Skeleton block needs a supported height ('lg'), not ${height}.`);
      drawnHeight = 'lg';
    }
  } else if (height !== undefined) {
    contractViolation(`A Skeleton line takes the height of its text; it takes no height (${height}).`);
  }

  return (
    <span
      /*
       * Always hidden, with no prop to un-hide it. A placeholder has nothing to
       * say; the caller announces what is loading once, in its own polite
       * status, so a screen-reader user hears one sentence, not a row of blanks.
       */
      aria-hidden="true"
      className={`ds-skeleton ${className}`.trim()}
      data-shape={drawnShape}
      data-width={drawnWidth}
      data-height={drawnHeight}
    />
  );
}
