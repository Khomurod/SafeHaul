import { useLayoutEffect, useState } from 'react';

/**
 * How wide the box holding a settings `DataTable` is, in whole pixels, followed
 * through resizes (a window, the sidebar, the settings rail appearing); `0`
 * until measured. Returns a callback ref for that box, measured as it mounts,
 * before it paints. The box's width comes from the page, never from the table
 * inside it, so what is decided from it does not feed back on itself.
 */
export function useSettingsTableWidth() {
    const [node, setNode] = useState(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        if (!node) return undefined;
        const update = () => {
            const measured = Math.round(node.getBoundingClientRect().width);
            if (measured > 0) setWidth(measured);
        };
        update();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, [node]);
    return [setNode, width];
}

/**
 * The `minWidth` for a settings `DataTable` whose fixed columns and the
 * narrowest its flexible column reads well at add up to `needed` pixels:
 * where its box (`width`, from `useSettingsTableWidth`) is at least that wide
 * the table squeezes to fit (`none`); where it is narrower it keeps 760px and
 * scrolls sideways with the row's name pinned (`standard`), rather than
 * crushing a column into a stack of letters.
 *
 * A stopgap for a `DataTable` option that decides this by its container
 * (requested from the design system). Deciding by the box rather than the
 * viewport keeps it true whatever the company frame and the settings rail
 * take beside it.
 */
export function settingsTableMinWidth(width, needed) {
    return width > 0 && width < needed ? 'standard' : 'none';
}
