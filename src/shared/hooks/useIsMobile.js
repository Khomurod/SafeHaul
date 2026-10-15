import { useMediaQuery } from './useMediaQuery';

const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Returns true when the viewport is below Tailwind's md breakpoint (768px).
 * Tracks live changes (rotation, window resize) via matchMedia.
 */
export function useIsMobile() {
    return useMediaQuery(MOBILE_QUERY);
}

export default useIsMobile;
