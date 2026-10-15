import { useCallback, useEffect, useRef } from 'react';
import { clearDraft, writeDraft } from '@features/signing/utils/signingDraft';

/** How long typing must pause before the draft is written. */
export const DRAFT_PAUSE_MS = 500;

/**
 * When the signing room writes its local draft: once typing pauses, with the
 * latest values, instead of on every keystroke. A pending write still lands
 * when the page is hidden or the room closes, so a refresh or a closed tab
 * loses nothing typed. `clear` drops the draft and any pending write, so a
 * submitted document leaves no draft behind.
 */
export function useSigningDraftWriter(companyId, requestId) {
    const pending = useRef(null);
    const timer = useRef(null);

    const flush = useCallback(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        if (pending.current && companyId && requestId) {
            writeDraft(companyId, requestId, pending.current);
        }
        pending.current = null;
    }, [companyId, requestId]);

    const save = useCallback((values) => {
        pending.current = values;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, DRAFT_PAUSE_MS);
    }, [flush]);

    const clear = useCallback(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        pending.current = null;
        clearDraft(companyId, requestId);
    }, [companyId, requestId]);

    useEffect(() => {
        const flushWhenHidden = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', flushWhenHidden);
        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', flushWhenHidden);
            flush();
        };
    }, [flush]);

    return { save, clear };
}

export default useSigningDraftWriter;
