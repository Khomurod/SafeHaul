import { useMediaQuery } from '@shared/hooks/useMediaQuery';

/**
 * True while the viewport is narrow enough that the dossier uses its
 * sheet-like, single-column layout instead of the desktop three-pane one.
 *
 * 640 px matches Tailwind's `sm` breakpoint, which is the breakpoint the
 * dossier's own classes switch on — keeping the JS and the CSS in agreement
 * matters because `aria-orientation` on the tablist must describe the layout the
 * user is actually looking at.
 */
export const COMPACT_QUERY = '(max-width: 639px)';

export function useCompactViewport() {
    return useMediaQuery(COMPACT_QUERY);
}

export default useCompactViewport;
