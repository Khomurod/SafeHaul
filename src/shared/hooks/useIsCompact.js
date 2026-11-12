import { useMediaQuery } from './useMediaQuery';

/**
 * Up to 1180px: a phone or a tablet, where a page with a rail of sections
 * (Company Settings) has no room for the rail beside its content. There the
 * list of sections is a page of its own and each section links back to it.
 */
export const COMPACT_QUERY = '(max-width: 1180px)';

/** Whether the viewport is compact (`COMPACT_QUERY`), following live changes. */
export function useIsCompact() {
    return useMediaQuery(COMPACT_QUERY);
}

export default useIsCompact;
