import { useEffect, useState } from 'react';

/**
 * True while the viewport is narrow enough that the dossier uses its
 * sheet-like, single-column layout instead of the desktop three-pane one.
 *
 * 640 px matches Tailwind's `sm` breakpoint, which is the breakpoint the
 * dossier's own classes switch on — keeping the JS and the CSS in agreement
 * matters because `aria-orientation` on the tablist must describe the layout the
 * user is actually looking at.
 *
 * Guarded for environments without `matchMedia` (jsdom in some configurations),
 * where it reports the desktop layout.
 */
export const COMPACT_QUERY = '(max-width: 639px)';

export function useCompactViewport() {
    const [isCompact, setIsCompact] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia(COMPACT_QUERY).matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mql = window.matchMedia(COMPACT_QUERY);
        const onChange = (event) => setIsCompact(event.matches);
        // `addEventListener` is the modern API; `addListener` is kept for older
        // WebKit which still ships in some mobile browsers.
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        }
        mql.addListener(onChange);
        return () => mql.removeListener(onChange);
    }, []);

    return isCompact;
}

export default useCompactViewport;
