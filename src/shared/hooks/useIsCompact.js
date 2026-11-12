import { useMediaQuery } from './useMediaQuery';

/**
 * Up to 1279px: a phone, a tablet or a narrow laptop window, where a page with
 * a rail of sections (Company Settings) has no room for the rail beside its
 * content — beside the 288px rail, Team's and API keys' tables need about
 * 616px, which the content column reaches at 1280. There the list of sections
 * is a page of its own and each section links back to it.
 */
export const COMPACT_QUERY = '(max-width: 1279px)';

/** Whether the viewport is compact (`COMPACT_QUERY`), following live changes. */
export function useIsCompact() {
    return useMediaQuery(COMPACT_QUERY);
}

export default useIsCompact;
