import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

function getInitial() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * Returns true when the viewport is below Tailwind's md breakpoint (768px).
 * Tracks live changes (rotation, window resize) via matchMedia.
 */
export function useIsMobile() {
    const [isMobile, setIsMobile] = useState(getInitial);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }
        const mql = window.matchMedia(MOBILE_QUERY);
        const handler = (event) => setIsMobile(event.matches);

        // Safari < 14 only supports addListener; modern browsers use addEventListener.
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', handler);
            return () => mql.removeEventListener('change', handler);
        }
        mql.addListener(handler);
        return () => mql.removeListener(handler);
    }, []);

    return isMobile;
}

export default useIsMobile;
