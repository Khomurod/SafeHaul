import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const SEARCH_CLASS = 'ds-list-toolbar__search';

const sum = (values) => values.reduce((total, value) => total + value, 0);
const px = (value) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * Whether the tools fit on the row beside what leads it (the `lead` slot and
 * the segments). Widths in pixels; `gap` is the row's gap between parts. A row
 * that has not been laid out (no width) or has nothing on one side always fits.
 */
export function toolsFit({ available, leading, tools, gap }) {
  if (!(available > 0) || !(leading > 0) || !(tools > 0)) return true;
  // Half a pixel of slack, for sub-pixel widths that round differently.
  return leading + gap + tools <= available + 0.5;
}

/**
 * The widths `toolsFit` compares, read from the bar as it is drawn. Each tool
 * is as wide as its content (the toolbar's CSS gives them `flex: none`) except
 * the search, which grows: it counts at its minimum width. None of these
 * change when the tools wrap, so the answer does not feed back on itself.
 */
export function measureBar(bar, tools) {
  const style = window.getComputedStyle(bar);
  const available = bar.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  const gap = px(style.columnGap);
  const leadingParts = [...bar.children].filter((part) => part !== tools);
  const toolParts = [...tools.children];
  const toolGap = px(window.getComputedStyle(tools).columnGap);
  const widthOf = (part) => {
    if (!part.classList.contains(SEARCH_CLASS)) return part.offsetWidth;
    const min = px(window.getComputedStyle(part).minWidth);
    return min > 0 ? min : part.offsetWidth;
  };
  return {
    available,
    gap,
    leading: sum(leadingParts.map((part) => part.offsetWidth)) + gap * Math.max(0, leadingParts.length - 1),
    tools: sum(toolParts.map(widthOf)) + toolGap * Math.max(0, toolParts.length - 1),
  };
}

/**
 * Whether the toolbar's tools no longer fit beside its segments and must take a
 * row of their own, measured from the toolbar itself rather than the viewport:
 * a list beside a collapsed sidebar has more room than the same list beside an
 * open one at the same window width. Re-measured after every render (a count
 * arrives, an action appears) and whenever the row or one of its parts changes
 * size (a resize, a font that finishes loading).
 *
 * `parts` is a string naming which parts exist (the lead, the segments, the
 * tools), so the observer follows a part that appears after the first draw,
 * such as the tools once a selection brings its actions.
 * Returns the bar and tools refs and the answer.
 *
 * The answer is drawn in the frame after the size changed; while the row is
 * not wrapped the toolbar's CSS holds it on one line, so in that frame the
 * search gives way rather than the tools hanging under the segments. It is
 * not forced through synchronously (`flushSync`): the new layout would change
 * the observed sizes again within the same delivery, which browsers report as
 * a ResizeObserver loop error.
 */
export function useToolsWrap(enabled, parts) {
  const barRef = useRef(null);
  const toolsRef = useRef(null);
  const [wrapped, setWrapped] = useState(false);

  const check = useCallback(() => {
    const bar = barRef.current;
    const tools = toolsRef.current;
    if (!enabled || !bar || !tools) {
      setWrapped(false);
      return;
    }
    setWrapped(!toolsFit(measureBar(bar, tools)));
  }, [enabled]);

  // After every render: what the row holds may have changed without its size.
  useLayoutEffect(() => {
    check();
  });

  useEffect(() => {
    const bar = barRef.current;
    if (!enabled || !bar || typeof ResizeObserver !== 'function') return undefined;
    // The answer is set as state, which React draws after this callback, so
    // the observer never sees its own change mid-delivery.
    const observer = new ResizeObserver(() => check());
    observer.observe(bar);
    for (const part of bar.children) observer.observe(part);
    return () => observer.disconnect();
  }, [enabled, check, parts]);

  return { barRef, toolsRef, wrapped };
}
