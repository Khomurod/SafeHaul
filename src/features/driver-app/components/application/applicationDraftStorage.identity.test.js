// Half of the original `applicationDraftStorage.test.js`, split on 2026-09-01
// for the source-size standard. This file keeps the identity-and-lifecycle
// suites — sensitive fields, the draft's name, and the discard mark; the
// storage/sync mechanics live in `applicationDraftStorage.sync.test.js`.
// The outer describe title is shared so every test keeps its original name.
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

        it('refuses to acknowledge a save written from a different application', () => {
            // The counters restart from zero on every new draft, so a response arriving
            // after a Start Over can carry a sequence the *new* draft has already
            // reached. Acknowledging it would tell the tab the server holds work it has
            // never seen, and the reconnect flush would then skip the save it owes.
            const first = saveApplicationDraft(SLUG, { firstName: 'Ada' });
            clearApplicationDraft(SLUG);
            const second = saveApplicationDraft(SLUG, { firstName: 'Someone new' });
            expect(second.localSeq).toBe(first.localSeq);

            expect(markDraftSynced(SLUG, second.localSeq, { draftId: first.draftId })).toBe(false);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(0);

            // An unnamed stored copy is not a wildcard either: an older client can
            // replace the slot with a pre-name envelope at the same small sequence.
            localStorage.setItem(KEY, JSON.stringify({
                v: 1, lastStep: 0, meta: { localSeq: second.localSeq, syncedSeq: 0, savedAt: null }, data: {},
            }));
            expect(markDraftSynced(SLUG, second.localSeq, { draftId: first.draftId })).toBe(false);

            // The same sequence, named correctly, is still acknowledged.
            localStorage.setItem(KEY, JSON.stringify({
                v: 1,
                lastStep: 0,
                meta: { localSeq: second.localSeq, syncedSeq: 0, savedAt: null, draftId: second.draftId },
                data: {},
            }));
            expect(markDraftSynced(SLUG, second.localSeq, { draftId: second.draftId })).toBe(true);
            expect(readApplicationDraft(SLUG).meta.syncedSeq).toBe(second.localSeq);
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
});
