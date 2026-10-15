import { useMediaQuery } from '@shared/hooks/useMediaQuery';

/**
 * True while the viewport is too narrow for the editor's three-column desktop
 * layout, so it presents as a full-screen canvas with a bottom toolbar and
 * bottom sheets instead.
 *
 * 1024 px is Tailwind's `lg`, the same breakpoint the editor's own classes
 * switch on. Keeping the JS and the CSS in agreement matters because the JS
 * decides which components mount at all — a mismatch would render two copies of
 * the rail, or none.
 */
export const COMPACT_EDITOR_QUERY = '(max-width: 1023px)';

export function useCompactEditor() {
    return useMediaQuery(COMPACT_EDITOR_QUERY);
}

export default useCompactEditor;
