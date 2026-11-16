import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './segmentedGroup.css';

/**
 * The drawing `TabList`, `TabNav` and `ListToolbar` share for a segmented or
 * pill strip (`segmentedGroup.css`). Importing this module brings the
 * stylesheet with it.
 */

/**
 * How a segmented strip lays its items out where it takes the whole row (a
 * phone, or a tray too wide for its row): two items in halves, three in thirds,
 * four in a 2 × 2 grid, six in rows of three; any other number as rows of whole
 * labels (`'wrap'`), since a long label in a third would run past the tray.
 */
export function phoneColumnsFor(count) {
  if (count === 2 || count === 4) return '2';
  if (count === 3 || count === 6) return '3';
  return 'wrap';
}

const px = (value) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * The width a tray needs to hold its items on one row, read from what the
 * items contain rather than from the boxes they are drawn in: the same answer
 * whether the tray is one row or a grid of stretched cells, so measuring never
 * feeds back on itself.
 */
export function naturalTrayWidth(tray) {
  const style = window.getComputedStyle(tray);
  const items = [...tray.querySelectorAll('.ds-segmented-group__item')];
  if (items.length === 0) return 0;
  const range = document.createRange();
  const content = items.reduce((total, item) => {
    const itemStyle = window.getComputedStyle(item);
    range.selectNodeContents(item);
    return total + range.getBoundingClientRect().width
      + px(itemStyle.paddingLeft) + px(itemStyle.paddingRight)
      + px(itemStyle.borderLeftWidth) + px(itemStyle.borderRightWidth);
  }, 0);
  return content
    + px(style.columnGap) * (items.length - 1)
    + px(style.paddingLeft) + px(style.paddingRight)
    + px(style.borderLeftWidth) + px(style.borderRightWidth);
}

/**
 * Whether a segmented tray no longer fits on one row of the element that holds
 * it — measured from the row, not the window: E-Docs' four tabs beside an open
 * menu on a tablet. A tray that does not fit takes its full-row layout
 * (`data-wrapped`, drawn as on a phone: four tabs as an equal 2 × 2 grid)
 * instead of wrapping three and one. Re-measured after every render (a count
 * arrives) and whenever the row or the tray changes size (a resize, a font that
 * finishes loading). Returns a ref for the tray and the answer.
 */
export function useTrayWraps(enabled) {
  const trayRef = useRef(null);
  const [wrapped, setWrapped] = useState(false);

  const check = useCallback(() => {
    const tray = trayRef.current;
    const row = tray?.parentElement;
    if (!enabled || !tray || !row) {
      setWrapped(false);
      return;
    }
    const rowStyle = window.getComputedStyle(row);
    const available = row.clientWidth - px(rowStyle.paddingLeft) - px(rowStyle.paddingRight);
    // Half a pixel of slack, for sub-pixel widths that round differently.
    setWrapped(available > 0 && naturalTrayWidth(tray) > available + 0.5);
  }, [enabled]);

  useLayoutEffect(() => {
    check();
  });

  useEffect(() => {
    const tray = trayRef.current;
    if (!enabled || !tray || typeof ResizeObserver !== 'function') return undefined;
    // The answer is state, drawn after this callback, so the observer never
    // sees its own change mid-delivery.
    const observer = new ResizeObserver(() => check());
    observer.observe(tray);
    if (tray.parentElement) observer.observe(tray.parentElement);
    return () => observer.disconnect();
  }, [enabled, check]);

  return [trayRef, wrapped];
}

/**
 * A label's text for the width it keeps in reserve (`data-text`): the chosen
 * item is semibold, and an item keeps that width whether chosen or not, so
 * choosing one never moves the others. Only a plain string can be reserved.
 */
export const reservedText = (label) => (typeof label === 'string' && label !== '' ? label : undefined);
