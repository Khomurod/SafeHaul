import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    readApplicationDraft,
    saveApplicationDraft,
    markDraftSynced,
    clearApplicationDraft,
    readDiscardMark,
    writeDiscardMark,
    discardMarkReason,
    subscribeToDiscardMark,
} from './applicationDraftStorage';

const SLUG = 'acme';
const KEY = 'draft_acme';

describe('applicationDraftStorage', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    describe('sensitive fields', () => {
        it('never persists an SSN or a signature', () => {
            saveApplicationDraft(SLUG, {
                firstName: 'Ada',
                ssn: '123-45-6789',
                signature: 'data:image/png;base64,AAAA',
            });

            const raw = localStorage.getItem(KEY);
            expect(raw).not.toContain('123-45-6789');
            expect(raw).not.toContain('data:image/png');

            const draft = readApplicationDraft(SLUG);
            expect(draft.data).not.toHaveProperty('ssn');
            expect(draft.data).not.toHaveProperty('signature');
            expect(draft.data.firstName).toBe('Ada');
        });

    });

    describe('the draft\'s name', () => {
        // Identity, not progress. Something holding a draft across a delay — an
        // offline submission waiting in the queue — has to know whether what is in
        // storage now is still the application it was made from, and the write
        // counters cannot answer that: they restart from zero every time a draft is
        // cleared.
        it('names a new draft and keeps that name through later writes', () => {
            const first = saveApplicationDraft(SLUG, { firstName: 'Ada' });
            expect(first.draftId).toBeTruthy();

            const second = saveApplicationDraft(SLUG, { firstName: 'Ada', lastName: 'Driver' });
            expect(second.draftId).toBe(first.draftId);
            expect(readApplicationDraft(SLUG).meta.draftId).toBe(first.draftId);
        });

        it('names the next application differently, at the same write count', () => {
            const first = saveApplicationDraft(SLUG, { firstName: 'Ada' });
            clearApplicationDraft(SLUG);
            const afterStartOver = saveApplicationDraft(SLUG, { firstName: 'Someone else' });

            // The counter is back where it was; the name is not.
            expect(readApplicationDraft(SLUG).meta.localSeq).toBe(1);
            expect(afterStartOver.draftId).not.toBe(first.draftId);
        });

        it('mints its own name rather than inheriting the slot\'s', () => {
            // Two tabs open the same apply page before either has saved. The second
            // one's first write must not adopt the first's name, or one identity would
            // cover two different applications — and an offline submission holding that
            // name would later accept the wrong draft as the one it submitted.
            const other = saveApplicationDraft(SLUG, { firstName: 'From another tab' });

            const mine = saveApplicationDraft(SLUG, { firstName: 'Mine' }, { draftId: null });

            expect(mine.draftId).not.toBe(other.draftId);
            expect(readApplicationDraft(SLUG).meta.draftId).toBe(mine.draftId);
        });

        it('keeps the name a writer says it owns', () => {
            saveApplicationDraft(SLUG, { firstName: 'Ada' });

            const again = saveApplicationDraft(SLUG, { firstName: 'Ada Marie' }, { draftId: 'mine-1' });

            expect(again.draftId).toBe('mine-1');
        });

        it('leaves the name alone when a write makes no claim', () => {
            // Recording a confirmed sync annotates the draft rather than starting one.
            const first = saveApplicationDraft(SLUG, { firstName: 'Ada' });
            markDraftSynced(SLUG, readApplicationDraft(SLUG).meta.localSeq);

            expect(readApplicationDraft(SLUG).meta.draftId).toBe(first.draftId);
        });

        it('reports no name for a draft written before drafts had one', () => {
            localStorage.setItem(KEY, JSON.stringify({
                v: 1, lastStep: 2, meta: { localSeq: 3, syncedSeq: 3, savedAt: null }, data: {},
            }));

            // Null rather than invented: a caller cannot prove identity here, and
            // guessing one would let a stale queue entry clear an unrelated draft.
            expect(readApplicationDraft(SLUG).meta.draftId).toBeNull();
        });
    });

    describe('the discard mark', () => {
        // Start Over deletes everything it touches, and a deletion is
        // indistinguishable from "there was never anything here" — so the discard
        // leaves a positive trace for other tabs to notice instead.
        const DISCARD_KEY = 'apply_discarded_acme';

        it('records a mark and reads it back', () => {
            const mark = writeDiscardMark(SLUG);

            expect(mark).toBeTruthy();
            expect(readDiscardMark(SLUG)).toBe(mark);
            expect(localStorage.getItem(DISCARD_KEY)).toBe(mark);
        });

        it('reports no mark for an application nobody discarded', () => {
            expect(readDiscardMark(SLUG)).toBeNull();
        });

        it('writes a value no previous mark equals', () => {
            // Load-bearing: a tab decides "was this discarded since I loaded?" by
            // comparing values, so a repeated mark would read as "nothing happened".
            const marks = new Set([
                writeDiscardMark(SLUG),
                writeDiscardMark(SLUG),
                writeDiscardMark(SLUG),
            ]);

            expect(marks.size).toBe(3);
        });

        it('keeps one application\'s discard out of another\'s', () => {
            writeDiscardMark(SLUG);

            expect(readDiscardMark('other-company')).toBeNull();
        });

        it('survives storage refusing the write', () => {
            const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });

            // Null, not a throw: cross-tab notification degrades to nothing, which
            // is the same trade the draft write itself makes.
            expect(writeDiscardMark(SLUG)).toBeNull();
            setItem.mockRestore();
        });

        it('notifies on another tab\'s discard, and only that', () => {
            const onDiscarded = vi.fn();
            const unsubscribe = subscribeToDiscardMark(SLUG, onDiscarded);

            // Another key entirely.
            window.dispatchEvent(new StorageEvent('storage', { key: 'draft_acme', newValue: '{}' }));
            // Another application's discard.
            window.dispatchEvent(new StorageEvent('storage', { key: 'apply_discarded_other', newValue: 'm' }));
            // A removal rather than a discard.
            window.dispatchEvent(new StorageEvent('storage', { key: DISCARD_KEY, newValue: null }));
            expect(onDiscarded).not.toHaveBeenCalled();

            window.dispatchEvent(new StorageEvent('storage', { key: DISCARD_KEY, newValue: 'mark-1' }));
            expect(onDiscarded).toHaveBeenCalledWith('mark-1');

            unsubscribe();
            window.dispatchEvent(new StorageEvent('storage', { key: DISCARD_KEY, newValue: 'mark-2' }));
            expect(onDiscarded).toHaveBeenCalledTimes(1);
        });

        it('says which of the two things ended the draft', () => {
            // Wording, not authorization: the value is still only ever compared for
            // inequality. But telling an applicant their application was *discarded*
            // when they had just submitted it is misinformation about the one thing
            // they cannot undo.
            expect(discardMarkReason(writeDiscardMark(SLUG, { reason: 'submit' }))).toBe('submit');
            expect(discardMarkReason(writeDiscardMark(SLUG, { reason: 'discard' }))).toBe('discard');
            expect(discardMarkReason(writeDiscardMark(SLUG))).toBe('discard');

            // A mark written before the prefix existed, and anything unrecognisable:
            // read as a discard, which never claims a submission that did not happen.
            expect(discardMarkReason('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe('discard');
            expect(discardMarkReason(null)).toBe('discard');
        });

        it('still writes a unique value once the reason is prefixed', () => {
            const marks = new Set([
                writeDiscardMark(SLUG, { reason: 'submit' }),
                writeDiscardMark(SLUG, { reason: 'submit' }),
                writeDiscardMark(SLUG, { reason: 'discard' }),
            ]);

            expect(marks.size).toBe(3);
        });

        it('returns a usable unsubscribe even when there is nothing to watch', () => {
            expect(() => subscribeToDiscardMark('', vi.fn())()).not.toThrow();
            expect(() => subscribeToDiscardMark(SLUG, null)()).not.toThrow();
        });
    });

    describe('reading', () => {
        it('returns null for an absent or corrupt draft', () => {
            expect(readApplicationDraft(SLUG)).toBeNull();
            localStorage.setItem(KEY, 'not json');
            expect(readApplicationDraft(SLUG)).toBeNull();
            localStorage.setItem(KEY, '"a string"');
            expect(readApplicationDraft(SLUG)).toBeNull();
        });

        it('round-trips an enveloped draft with its sync position', () => {
            saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 3 });

            const draft = readApplicationDraft(SLUG);
            expect(draft.data).toEqual({ firstName: 'Ada' });
            expect(draft.lastStep).toBe(3);
            expect(draft.meta.localSeq).toBe(1);
            expect(draft.meta.syncedSeq).toBe(0);
        });

        it('reads a legacy flat draft, and reports it as having no metadata', () => {
            // Already in real drivers' browsers: answers and lastStep in one
            // object, with no way to say whether it holds unsynced work.
            localStorage.setItem(KEY, JSON.stringify({
                firstName: 'Ada', phone: '5551234', lastStep: 4,
            }));

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta).toBeNull();
            expect(draft.lastStep).toBe(4);
            // `lastStep` is metadata, not an answer, so it does not leak into the
            // form data the way it used to.
            expect(draft.data).toEqual({ firstName: 'Ada', phone: '5551234' });
        });
    });

    describe('writing', () => {
        it('advances localSeq on every write but leaves syncedSeq alone', () => {
            expect(saveApplicationDraft(SLUG, { a: 1 }).localSeq).toBe(1);
            expect(saveApplicationDraft(SLUG, { a: 2 }).localSeq).toBe(2);
            expect(saveApplicationDraft(SLUG, { a: 3 }).localSeq).toBe(3);

            // A local write is unsynced by definition.
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(0);
        });

        it('starts a legacy draft at sequence 1 rather than trusting it', () => {
            localStorage.setItem(KEY, JSON.stringify({ firstName: 'Ada', lastStep: 4 }));

            expect(saveApplicationDraft(SLUG, { firstName: 'Ada' }).localSeq).toBe(1);
        });

        it('keeps the previous step when a write does not supply one', () => {
            saveApplicationDraft(SLUG, { a: 1 }, { lastStep: 5 });
            saveApplicationDraft(SLUG, { a: 2 });

            expect(readApplicationDraft(SLUG).lastStep).toBe(5);
        });

        it('reports a quota failure instead of swallowing it', () => {
            const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });

            const result = saveApplicationDraft(SLUG, { a: 1 });

            expect(result.ok).toBe(false);
            expect(result.localSeq).toBeNull();
            setItem.mockRestore();
        });

        it('writes the data and its metadata in one operation', () => {
            // One `setItem`, so the two can never desync. A separate metadata key
            // could half-fail on quota and leave a draft claiming to be synced
            // when it is not — which is the bug this metadata exists to prevent.
            const setItem = vi.spyOn(window.localStorage, 'setItem');

            saveApplicationDraft(SLUG, { a: 1 }, { lastStep: 2 });

            expect(setItem).toHaveBeenCalledTimes(1);
            setItem.mockRestore();
        });
    });

    describe('navigation-only writes', () => {
        it('does not advance the sequence when no answer changed', () => {
            // Pressing Back writes the draft but sends no server save. Advancing the
            // sequence there marked a fully synced copy as holding unacknowledged
            // work, and it would then beat genuinely newer work from another device
            // for the rest of the draft's life.
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 3 });
            markDraftSynced(SLUG, localSeq);

            const back = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 2 });

            const draft = readApplicationDraft(SLUG);
            expect(back.localSeq).toBe(localSeq);
            expect(draft.meta.localSeq).toBe(draft.meta.syncedSeq);
            // The step still moved: navigation is recorded, just not as new work.
            expect(draft.lastStep).toBe(2);
        });

        it('still advances when an answer really did change', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 1 });
            markDraftSynced(SLUG, localSeq);

            saveApplicationDraft(SLUG, { firstName: 'Adaline' }, { lastStep: 1 });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBeGreaterThan(draft.meta.syncedSeq);
        });

        it('treats a nested change as a change', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { customAnswers: { q1: 'a' } });
            markDraftSynced(SLUG, localSeq);

            saveApplicationDraft(SLUG, { customAnswers: { q1: 'a', q2: 'b' } });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBeGreaterThan(draft.meta.syncedSeq);
        });

        it('does not advance across several navigations with no edits', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 4 });
            markDraftSynced(SLUG, localSeq);

            for (const step of [3, 2, 3, 4, 5]) {
                saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: step });
            }

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(draft.meta.syncedSeq);
            expect(draft.lastStep).toBe(5);
        });

        it('never treats a legacy draft as unchanged, even with identical answers', () => {
            // Legacy has no sequence. Calling it unchanged would leave 0/0, which
            // reads as synced — a claim nothing supports.
            localStorage.setItem(KEY, JSON.stringify({ firstName: 'Ada', lastStep: 2 }));

            const result = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 2 });

            expect(result.localSeq).toBe(1);
            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBeGreaterThan(draft.meta.syncedSeq);
        });

        it('keeps savedAt naming the last real edit', () => {
            saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 1 });
            const afterEdit = readApplicationDraft(SLUG).meta.savedAt;

            saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 2 });

            expect(readApplicationDraft(SLUG).meta.savedAt).toBe(afterEdit);
        });

        it('does not restamp savedAt when a save is confirmed synced', () => {
            // Recording a confirmed sync passes explicit sequence numbers, which is
            // a different question from "did the applicant type something". The
            // stamp is diagnostics only, and one that moves when no answer moved
            // misleads the person reading it.
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 1 });
            const afterEdit = readApplicationDraft(SLUG).meta.savedAt;

            expect(markDraftSynced(SLUG, localSeq)).toBe(true);

            const after = readApplicationDraft(SLUG);
            expect(after.meta.savedAt).toBe(afterEdit);
            expect(after.meta.syncedSeq).toBe(localSeq);
        });

        it('ignores an unserializable body rather than calling it unchanged', () => {
            // A false "unchanged" would drop the dirty marker; a false "changed"
            // costs one redundant save.
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' });
            markDraftSynced(SLUG, localSeq);

            const cyclic = { firstName: 'Ada' };
            cyclic.self = cyclic;
            saveApplicationDraft(SLUG, cyclic);

            // The write itself fails (JSON.stringify throws on the envelope), and
            // nothing was marked clean on the way past.
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(localSeq);
        });
    });

    describe('the synced option', () => {
        it('marks whatever sequence the write lands on as confirmed', () => {
            saveApplicationDraft(SLUG, { a: 1 });
            saveApplicationDraft(SLUG, { a: 2 }, { synced: true });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(2);
            expect(draft.meta.syncedSeq).toBe(2);
        });

        it('adopts an explicit sequence when one is supplied', () => {
            saveApplicationDraft(SLUG, { a: 1 }, { localSeq: 9, synced: true });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(9);
            expect(draft.meta.syncedSeq).toBe(9);
        });

        it('is what keeps a restored server copy from posing as unsynced work', () => {
            // A server draft written before `clientSeq` existed has no sequence to
            // adopt. Writing it as an ordinary local write would mark it dirty, and
            // a later genuine server advance would then lose to it.
            localStorage.setItem(KEY, JSON.stringify({ old: true, lastStep: 1 }));
            saveApplicationDraft(SLUG, { restored: true }, { synced: true });

            const draft = readApplicationDraft(SLUG);
            expect(draft.meta.localSeq).toBe(draft.meta.syncedSeq);
        });
    });

    describe('markDraftSynced', () => {
        it('records the confirmed sequence', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { a: 1 });

            expect(markDraftSynced(SLUG, localSeq)).toBe(true);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(localSeq);
        });

        it('refuses when the local copy has moved on since that save started', () => {
            const first = saveApplicationDraft(SLUG, { step: 'one' }).localSeq;
            saveApplicationDraft(SLUG, { step: 'two' });

            // The first save lands late. Marking it synced would declare the
            // *newer* local work acknowledged, and the next page load would then
            // hand the applicant the older server copy.
            expect(markDraftSynced(SLUG, first)).toBe(false);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(0);
            expect(readApplicationDraft(SLUG).data.step).toBe('two');
        });

        it('is idempotent for a sequence already recorded', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { a: 1 });
            markDraftSynced(SLUG, localSeq);

            expect(markDraftSynced(SLUG, localSeq)).toBe(true);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(localSeq);
        });

        it('does not invent metadata for a legacy draft', () => {
            localStorage.setItem(KEY, JSON.stringify({ firstName: 'Ada', lastStep: 4 }));

            expect(markDraftSynced(SLUG, 1)).toBe(false);
            expect(readApplicationDraft(SLUG).meta).toBeNull();
        });

        it('ignores a missing draft, a missing slug and a non-integer sequence', () => {
            expect(markDraftSynced(SLUG, 1)).toBe(false);
            expect(markDraftSynced('', 1)).toBe(false);
            saveApplicationDraft(SLUG, { a: 1 });
            expect(markDraftSynced(SLUG, 1.5)).toBe(false);
            expect(markDraftSynced(SLUG, undefined)).toBe(false);
        });

        it('preserves the answers and step it re-writes', () => {
            const { localSeq } = saveApplicationDraft(SLUG, { firstName: 'Ada' }, { lastStep: 3 });
            markDraftSynced(SLUG, localSeq);

            const draft = readApplicationDraft(SLUG);
            expect(draft.data).toEqual({ firstName: 'Ada' });
            expect(draft.lastStep).toBe(3);
        });
    });

    it('clears the draft and its metadata together', () => {
        saveApplicationDraft(SLUG, { a: 1 });
        clearApplicationDraft(SLUG);

        expect(readApplicationDraft(SLUG)).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
    });
});
