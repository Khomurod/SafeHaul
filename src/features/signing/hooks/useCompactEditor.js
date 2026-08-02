import { useEffect, useState } from 'react';

/**
 * True while the viewport is too narrow for the editor's three-column desktop
 * layout, so it presents as a full-screen canvas with a bottom toolbar and
 * bottom sheets instead.
 *
 * 1024 px is Tailwind's `lg`, the same breakpoint the editor's own classes
 * switch on. Keeping the JS and the CSS in agreement matters because the JS
 * decides which components mount at all — a mismatch would render two copies of
 * the rail, or none.
 *
 * Guarded for environments without `matchMedia` (jsdom in some configurations),
 * where it reports the desktop layout.
 */
export const COMPACT_EDITOR_QUERY = '(max-width: 1023px)';

export function useCompactEditor() {
    const [isCompact, setIsCompact] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia(COMPACT_EDITOR_QUERY).matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mql = window.matchMedia(COMPACT_EDITOR_QUERY);
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

export default useCompactEditor;
