import { describe, it, expect } from 'vitest';

import { reconcileApplicationDraft } from './reconcileApplicationDraft';

/**
 * The reconciliation decision table.
 *
 * The rule under test: **an older server draft must never overwrite newer
 * locally saved work.** The local copy is written synchronously on every forward
 * step and the server copy in the background, so a failed, slow or superseded
 * save leaves the server holding older content — and restoring it used to
 * clobber the newer local values unconditionally.
 *
 * Every case here is a pure comparison. There is deliberately no clock involved:
 * see the module header for why a device clock cannot be compared with a
 * Firestore server timestamp.
 */

/** A local draft that has been fully confirmed by the server. */
const synced = (data, { lastStep = 2, seq = 4 } = {}) => ({
    data,
    lastStep,
    meta: { localSeq: seq, syncedSeq: seq, savedAt: '2026-08-19T10:00:00.000Z' },
});

/** A local draft holding writes the server never acknowledged. */
const unsynced = (data, { lastStep = 2, localSeq = 6, syncedSeq = 4 } = {}) => ({
    data,
    lastStep,
    meta: { localSeq, syncedSeq, savedAt: '2026-08-19T10:00:00.000Z' },
});

/** A draft written before sync metadata existed. */
const legacy = (data, { lastStep = 2 } = {}) => ({ data, lastStep, meta: null });

const serverDraft = (formData, { stepIndex = 2, clientSeq = 4 } = {}) => ({
    formData,
    stepIndex,
    clientSeq,
});

describe('reconcileApplicationDraft', () => {
    it('returns nothing when neither copy exists', () => {
        expect(reconcileApplicationDraft({ local: null, server: null })).toBeNull();
        expect(reconcileApplicationDraft({})).toBeNull();
    });

    it('keeps the local copy when there is no server draft', () => {
        const result = reconcileApplicationDraft({
            local: synced({ firstName: 'Ada', phone: '5551234' }),
            server: null,
        });

        expect(result.source).toBe('local');
        expect(result.reason).toBe('no-server-draft');
        expect(result.formData.phone).toBe('5551234');
    });

    it('takes the server copy when there is no local draft', () => {
        const result = reconcileApplicationDraft({
            local: null,
            server: serverDraft({ firstName: 'Ada', phone: '5559999' }, { stepIndex: 5 }),
        });

        expect(result.source).toBe('server');
        expect(result.reason).toBe('no-local-draft');
        expect(result.formData.phone).toBe('5559999');
        expect(result.stepIndex).toBe(5);
    });

    describe('local is newer than the server', () => {
        it('keeps unsynced local edits instead of the stale server value', () => {
            // The reported failure: driver corrects a phone number, the local copy
            // saves, the server save fails, they refresh. The old number came back.
            const result = reconcileApplicationDraft({
                local: unsynced({ firstName: 'Ada', phone: '5551234' }),
                server: serverDraft({ firstName: 'Ada', phone: '5550000' }),
            });

            expect(result.source).toBe('local');
            expect(result.reason).toBe('local-unsynced');
            expect(result.formData.phone).toBe('5551234');
        });

        it('still keeps server-only fields, so nothing is lost either way', () => {
            const result = reconcileApplicationDraft({
                local: unsynced({ phone: '5551234' }),
                server: serverDraft({ phone: '5550000', cdlNumber: 'TX9' }),
            });

            expect(result.formData.phone).toBe('5551234');
            expect(result.formData.cdlNumber).toBe('TX9');
        });

        it('honours a field the driver cleared locally', () => {
            const result = reconcileApplicationDraft({
                local: unsynced({ phone: '5551234', middleName: '' }),
                server: serverDraft({ phone: '5550000', middleName: 'Jane' }),
            });

            // The key exists locally with an empty value, which is an answer.
            expect(result.formData.middleName).toBe('');
        });
    });

    describe('the server is newer than local', () => {
        it('applies a draft another device advanced', () => {
            const result = reconcileApplicationDraft({
                local: synced({ phone: '5551234' }, { seq: 4 }),
                server: serverDraft({ phone: '5559999' }, { clientSeq: 7 }),
            });

            expect(result.source).toBe('server');
            expect(result.reason).toBe('server-advanced');
            expect(result.formData.phone).toBe('5559999');
        });

        it('compares sequences by identity, never by magnitude', () => {
            // Sequences are per-device counters, so a *lower* number from another
            // browser still means "not the copy this device synced".
            const result = reconcileApplicationDraft({
                local: synced({ phone: '5551234' }, { seq: 9 }),
                server: serverDraft({ phone: '5559999' }, { clientSeq: 3 }),
            });

            expect(result.source).toBe('server');
            expect(result.reason).toBe('server-advanced');
        });

        it('keeps local-only fields when the server wins', () => {
            const result = reconcileApplicationDraft({
                local: synced({ phone: '5551234', nickname: 'Slim' }, { seq: 4 }),
                server: serverDraft({ phone: '5559999' }, { clientSeq: 7 }),
            });

            expect(result.formData.phone).toBe('5559999');
            expect(result.formData.nickname).toBe('Slim');
        });
    });

    it('treats an in-sync pair as the server copy without changing anything', () => {
        const result = reconcileApplicationDraft({
            local: synced({ phone: '5551234' }, { seq: 4 }),
            server: serverDraft({ phone: '5551234' }, { clientSeq: 4 }),
        });

        expect(result.reason).toBe('in-sync');
        expect(result.formData.phone).toBe('5551234');
    });

    describe('a delayed save that lands after newer local work', () => {
        it('is still treated as local-newer, because syncedSeq trails localSeq', () => {
            // Two Next presses; only the first save landed. `markDraftSynced`
            // refuses to advance past what it confirmed, so localSeq stays ahead.
            const result = reconcileApplicationDraft({
                local: unsynced({ step: 'two' }, { localSeq: 6, syncedSeq: 5 }),
                server: serverDraft({ step: 'one' }, { clientSeq: 5 }),
            });

            expect(result.source).toBe('local');
            expect(result.formData.step).toBe('two');
        });

        it('prefers the server once the later save has been confirmed', () => {
            const result = reconcileApplicationDraft({
                local: synced({ step: 'two' }, { seq: 6 }),
                server: serverDraft({ step: 'two' }, { clientSeq: 6 }),
            });

            expect(result.reason).toBe('in-sync');
        });
    });

    describe('legacy drafts, written before sync metadata existed', () => {
        it('prefers whichever copy reached the further step', () => {
            const local = reconcileApplicationDraft({
                local: legacy({ phone: '5551234' }, { lastStep: 5 }),
                server: serverDraft({ phone: '5550000' }, { stepIndex: 2 }),
            });
            expect(local.source).toBe('local');
            expect(local.reason).toBe('legacy-progress');
            expect(local.formData.phone).toBe('5551234');

            const server = reconcileApplicationDraft({
                local: legacy({ phone: '5551234' }, { lastStep: 1 }),
                server: serverDraft({ phone: '5550000' }, { stepIndex: 6 }),
            });
            expect(server.source).toBe('server');
            expect(server.formData.phone).toBe('5550000');
        });

        it('falls back to progress when the server copy predates clientSeq', () => {
            const result = reconcileApplicationDraft({
                local: synced({ phone: '5551234' }, { lastStep: 5, seq: 4 }),
                server: serverDraft({ phone: '5550000' }, { stepIndex: 2, clientSeq: null }),
            });

            expect(result.reason).toBe('server-unsequenced');
            expect(result.source).toBe('local');
        });
    });

    it('never moves the applicant backwards, whichever copy wins', () => {
        const result = reconcileApplicationDraft({
            local: unsynced({}, { lastStep: 3 }),
            server: serverDraft({}, { stepIndex: 6 }),
        });

        // Local won on field values; the furthest page either copy reached still
        // stands, and the merge means that page has data behind it.
        expect(result.source).toBe('local');
        expect(result.stepIndex).toBe(6);
    });

    describe('work typed in this session', () => {
        it('outranks both stored copies', () => {
            const result = reconcileApplicationDraft({
                local: synced({ phone: '5551234' }, { seq: 4 }),
                server: serverDraft({ phone: '5559999' }, { clientSeq: 7 }),
                live: { phone: '5557777' },
            });

            // The server copy is newer than the local one, but the applicant is
            // typing right now and the fetch was a round trip.
            expect(result.source).toBe('server');
            expect(result.formData.phone).toBe('5557777');
        });

        it('compares objects by value, so a re-parsed upload is not a fresh edit', () => {
            // The live copy is a different parse of the same stored JSON, so
            // reference equality reported every upload and repeating section as
            // freshly typed — which would have let local uploads beat a server
            // copy that genuinely had newer ones.
            const upload = { name: 'cdl.pdf', url: 'https://example.com/cdl.pdf' };
            const result = reconcileApplicationDraft({
                local: synced({ 'cdl-front': { ...upload } }, { seq: 4 }),
                server: serverDraft({ 'cdl-front': { name: 'newer.pdf', url: 'https://example.com/newer.pdf' } }, { clientSeq: 7 }),
                live: { 'cdl-front': { ...upload } },
            });

            expect(result.source).toBe('server');
            expect(result.formData['cdl-front'].name).toBe('newer.pdf');
        });

        it('still treats a genuinely changed object as an edit', () => {
            const result = reconcileApplicationDraft({
                local: synced({ 'cdl-front': { name: 'old.pdf' } }, { seq: 4 }),
                server: serverDraft({ 'cdl-front': { name: 'server.pdf' } }, { clientSeq: 7 }),
                live: { 'cdl-front': { name: 'just-uploaded.pdf' } },
            });

            expect(result.formData['cdl-front'].name).toBe('just-uploaded.pdf');
        });

        it('ignores untouched empty defaults, or nothing would ever restore', () => {
            const result = reconcileApplicationDraft({
                local: null,
                server: serverDraft({ phone: '5559999', cdlNumber: 'TX9' }),
                // The wizard seeds every field; these are not answers.
                live: { phone: '', cdlNumber: undefined, middleName: null },
            });

            expect(result.formData.phone).toBe('5559999');
            expect(result.formData.cdlNumber).toBe('TX9');
        });
    });

    it('is unaffected by a wrong device clock', () => {
        // `savedAt` is recorded for diagnostics and is never a decision input, so
        // a phone set years in the past decides nothing.
        const skewed = {
            data: { phone: '5551234' },
            lastStep: 2,
            meta: { localSeq: 6, syncedSeq: 4, savedAt: '2019-01-01T00:00:00.000Z' },
        };

        const result = reconcileApplicationDraft({
            local: skewed,
            server: serverDraft({ phone: '5550000' }, { clientSeq: 4 }),
        });

        expect(result.source).toBe('local');
        expect(result.formData.phone).toBe('5551234');
    });
});
