import { useEffect, useRef } from 'react';

/**
 * Which ends of a sideways-scrolling region hold columns out of sight: `start`
 * once it has scrolled away from its first column, `end` while columns remain
 * past its far edge. A region that fits has neither. A pixel of slack absorbs
 * sub-pixel widths that never quite reach the end.
 */
export function readScrollEdges(region) {
  const hidden = region.scrollWidth - region.clientWidth;
  if (hidden <= 1) return { start: false, end: false };
  // Right-to-left content reports a negative offset.
  const scrolled = Math.abs(region.scrollLeft);
  return { start: scrolled > 1, end: scrolled < hidden - 1 };
}

const mark = (element, name, on) => {
  if (on) element.setAttribute(name, 'true');
  else element.removeAttribute(name);
};

/**
 * Marks the frame around a table's scroll region with `data-overflow-start`
 * and `data-overflow-end` while columns are hidden past that edge, so the
 * frame can shade it (`scrollEdges.css`). Re-read on every scroll and whenever
 * the region or its table changes size (a resize, a column that arrives, rows
 * that widen it). The marks are set on the element directly: they flip at most
 * twice a gesture, and a re-render of every row for each would cost more than
 * the shade is worth. Returns refs for the frame and the region.
 */
export function useScrollEdges() {
  const frameRef = useRef(null);
  const regionRef = useRef(null);

  useEffect(() => {
    const frame = frameRef.current;
    const region = regionRef.current;
    if (!frame || !region) return undefined;

    const update = () => {
      const { start, end } = readScrollEdges(region);
      mark(frame, 'data-overflow-start', start);
      mark(frame, 'data-overflow-end', end);
    };
    update();

    region.addEventListener('scroll', update, { passive: true });
    let observer;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(update);
      observer.observe(region);
      const table = region.querySelector('table');
      if (table) observer.observe(table);
    }
    return () => {
      region.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  return [frameRef, regionRef];
}
