import { useCallback, useRef } from 'react';
import {
    clearResumeToken,
    readResumeToken,
    writeResumeToken,
} from '../services/applicationDraftService';

/**
 * Which application this tab holds a credential for.
 *
 * Split out of `useApplicationResume.js` on 2026-09-08, both for the source-size
 * standard and because it is one subject: three questions that were previously
 * answered by reading shared storage at the moment each answer was needed.
 *
 * ## Why the token is held in a ref and not re-read at send time
 *
 * `apply_resume_${slug}` is one slot per company slug, shared by every tab, and
 * `sendSave` used to read it *at transmit time*. So a tab belonging to a previous
 * applicant, still open when a carrier's invite link was opened in another tab,
 * presented the INVITED driver's token with its own answers. Server-side that made
 * the invited draft the `preparedSource`, and `carriedPreparedFields` copied
 * `origin: 'company'`, `lockedEmployers`, `preparedBy`, `invitedAt` and
 * `inviteClaimedAt` onto the previous applicant's own document — one person's
 * application silently acquiring another person's carrier locks and claimed-invite
 * fact, which is a compliance defect and not a cosmetic one.
 *
 * So the token is seeded **at mount** and changed only by a writer inside this tab.
 * Mount-time and not lazily: a tab that mounted with an empty slot and whose first
 * Next lands *after* an invite wrote a token would otherwise read that token, skip
 * its own resume question entirely, and present a stranger's credential. "The token
 * this tab was issued" needs the right value on both sides of that race.
 *
 * ## The slot is still the shared truth for retirement
 *
 * `releaseIfStillOurs` compares the SLOT, not this ref, because retiring a token
 * is a claim about shared storage: another tab may have been issued one of its own
 * while a round trip was open, and taking that away would cost the applicant the
 * ownership proof for work nobody discarded. That guard already existed on
 * `startOver` and was missing from the failed-restore path one function away.
 */
export function useResumeTokenOwnership(slug) {
    /**
     * Whether this browser has already been offered the resume prompt.
     *
     * A ref, not state: repeated Next clicks on page one must not re-ask, and a
     * state update would not have landed before the second click.
     */
    const askedRef = useRef(false);
    /** True once a save has landed, so this browser owns the draft for this identity. */
    const ownsDraftRef = useRef(false);
    /** The token this tab was issued. See the header for why it is not the slot. */
    const heldRef = useRef(null);
    /**
     * Which slug `heldRef` was seeded for.
     *
     * Seeded in render rather than in an effect, so the value is right before any
     * callback or effect can run — the same reason `discardedRef` is assigned in
     * render. A slug change without a remount re-seeds, so one apply page never
     * serves another's token.
     */
    const seededFor = useRef(Symbol('unseeded'));
    if (seededFor.current !== slug) {
        seededFor.current = slug;
        heldRef.current = slug ? readResumeToken(slug) : null;
        askedRef.current = false;
        ownsDraftRef.current = false;
    }

    /** The token and applicant key this tab holds, or null. */
    const heldToken = useCallback(() => heldRef.current, []);

    /**
     * Take on a token this tab was just issued — by a save, a Continue, or a
     * carrier's invite link.
     *
     * The invite path used to call `writeResumeToken` directly, bypassing this hook,
     * so it never set the ownership refs and worked only because `runResumeLookup`
     * happened to read the shared slot and find the invite's token. Going through
     * here makes the fact explicit and removes the accident.
     */
    const adoptResumeToken = useCallback(({ resumeToken, applicantKey }) => {
        if (!slug || !resumeToken) return;
        const held = { resumeToken, applicantKey: applicantKey || null };
        writeResumeToken(slug, held);
        heldRef.current = held;
        askedRef.current = true;
        ownsDraftRef.current = true;
    }, [slug]);

    /**
     * The server resolved a different document than this tab named.
     *
     * Legitimate and expected: `findByToken` takes the key as a hint and falls
     * through, which is exactly what happens to an applicant who corrected a
     * contact detail. Re-stamping keeps the one-read hint honest. It deliberately
     * does **not** touch the local draft — the common cause is that correction, and
     * dropping local work over it would destroy the very copy the applicant is
     * still typing into.
     */
    const restampApplicantKey = useCallback((applicantKey) => {
        const held = heldRef.current;
        if (!slug || !held?.resumeToken || !applicantKey) return;
        if (held.applicantKey === applicantKey) return;
        const next = { resumeToken: held.resumeToken, applicantKey };
        writeResumeToken(slug, next);
        heldRef.current = next;
    }, [slug]);

    /**
     * Retire a token, but only while the shared slot still holds it.
     *
     * The unguarded version of this cost the invite path its credential: a stale
     * token's restore fails, its `catch` cleared the slot, and by then a carrier's
     * invite had already minted and stored a fresh one. A carrier-prepared draft
     * carries no identity HMAC, so that token is the ONLY thing authorizing the
     * driver's autosave — and losing it is silent.
     */
    const releaseIfStillOurs = useCallback((resumeToken) => {
        if (!slug || !resumeToken) return false;
        if (readResumeToken(slug)?.resumeToken !== resumeToken) return false;
        clearResumeToken(slug);
        if (heldRef.current?.resumeToken === resumeToken) heldRef.current = null;
        return true;
    }, [slug]);

    /**
     * Behave like a browser that owns nothing.
     *
     * Without this the two refs still say "already asked, already owns" after the
     * application was discarded elsewhere, so the tab skips the resume question and
     * quietly creates a new draft on its next save — which is how discarded answers
     * came back.
     */
    const forgetOwnership = useCallback(() => {
        askedRef.current = false;
        ownsDraftRef.current = false;
        heldRef.current = null;
    }, []);

    return {
        askedRef,
        ownsDraftRef,
        heldToken,
        adoptResumeToken,
        restampApplicantKey,
        releaseIfStillOurs,
        forgetOwnership,
    };
}

export default useResumeTokenOwnership;
