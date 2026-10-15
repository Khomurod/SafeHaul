import { useEffect, useState } from 'react';

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * Whether a CSS media query matches, following live changes (rotation, window
 * resize). False where `matchMedia` is missing (some jsdom setups), which every
 * caller reads as the desktop layout.
 */
export function useMediaQuery(query) {
    const [isMatch, setIsMatch] = useState(() => canMatch() && window.matchMedia(query).matches);

    useEffect(() => {
        if (!canMatch()) return undefined;
        const mql = window.matchMedia(query);
        setIsMatch(mql.matches);
        const onChange = (event) => setIsMatch(event.matches);
        // `addEventListener` is the modern API; `addListener` is kept for older
        // WebKit, which still ships in some mobile browsers.
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        }
        mql.addListener(onChange);
        return () => mql.removeListener(onChange);
    }, [query]);

    return isMatch;
}

export default useMediaQuery;
