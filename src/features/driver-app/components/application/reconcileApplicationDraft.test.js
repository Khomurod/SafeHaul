import { describe, it, expect } from 'vitest';

import { reconcileApplicationDraft, __private } from './reconcileApplicationDraft';
import STANDARD_SECTIONS from '../../../../../functions/shared/applicationSections.json';

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

describe('field classification', () => {
    it('derives the repeating set from the shared schema, not a second list', () => {
        // The schema is the one table both runtimes read. Deriving from it means a
        // repeating field added there is merged correctly without anyone
        // remembering to update this module.
        const fromSchema = STANDARD_SECTIONS
            .flatMap((section) => (section.fields || []).filter((f) => f.repeating).map((f) => f.id))
            .sort();

        expect([...__private.REPEATING_FIELDS].sort()).toEqual(fromSchema);
        expect(fromSchema.length).toBeGreaterThan(0);
    });

    it('treats customAnswers as the only keyed answer map', () => {
        // Custom questions are company-defined, so they are absent from the shared
        // schema and cannot be derived. Every other object-valued field is a value
        // object — an upload — where per-key merging would corrupt the answer.
        expect([...__private.KEYED_ANSWER_MAPS]).toEqual(['customAnswers']);
        expect(__private.REPEATING_FIELDS.has('customAnswers')).toBe(false);
    });

    it('leaves an unclassified nested field to the winner rather than guessing', () => {
        const merged = __private.mergeDraftData(
            { somethingNew: { a: 1 } },
            { somethingNew: { b: 2 } },
        );

        // Winner wins whole. Guessing a merge for a shape nobody has classified is
        // how halves of unrelated answers get stitched together.
        expect(merged.somethingNew).toEqual({ b: 2 });
    });
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

    describe('nested and repeating answers', () => {
        it('keeps a custom answer that exists only on the losing copy', () => {
            // The flat spread replaced the winner's whole `customAnswers` object,
            // so an answer nothing was in conflict about was thrown away.
            const result = reconcileApplicationDraft({
                local: unsynced({ customAnswers: { q1: 'local answer' } }),
                server: serverDraft({ customAnswers: { q2: 'server answer' } }),
            });

            expect(result.source).toBe('local');
            expect(result.formData.customAnswers).toEqual({
                q1: 'local answer',
                q2: 'server answer',
            });
        });

        it('lets the winner decide a custom answer both copies hold', () => {
            const result = reconcileApplicationDraft({
                local: unsynced({ customAnswers: { q1: 'newer', q2: 'only local' } }),
                server: serverDraft({ customAnswers: { q1: 'older', q3: 'only server' } }),
            });

            expect(result.formData.customAnswers).toEqual({
                q1: 'newer',
                q2: 'only local',
                q3: 'only server',
            });
        });

        it('merges the same way when the server is the newer copy', () => {
            const result = reconcileApplicationDraft({
                local: synced({ customAnswers: { q1: 'stale', q2: 'only local' } }, { seq: 4 }),
                server: serverDraft({ customAnswers: { q1: 'fresh' } }, { clientSeq: 7 }),
            });

            expect(result.source).toBe('server');
            expect(result.formData.customAnswers).toEqual({ q1: 'fresh', q2: 'only local' });
        });

        it('keeps a checkbox answer array intact rather than merging its indices', () => {
            const result = reconcileApplicationDraft({
                local: unsynced({ customAnswers: { q1: ['a', 'b'] } }),
                server: serverDraft({ customAnswers: { q1: ['c'] } }),
            });

            // One answer, not a union of two: the winner's selection is the answer.
            expect(result.formData.customAnswers.q1).toEqual(['a', 'b']);
        });

        it.each([
            'previousAddresses', 'additionalLicenses', 'violations', 'accidents',
            'employers', 'unemployment', 'schools', 'military',
        ])('keeps a %s row that exists only on the losing copy', (field) => {
            const shared = ['Acme', '2020', '2022'];
            const localOnly = ['Offline Co', '2023', '2024'];
            const result = reconcileApplicationDraft({
                local: unsynced({ [field]: [shared, localOnly] }),
                server: serverDraft({ [field]: [shared] }),
            });

            expect(result.formData[field]).toEqual([shared, localOnly]);
        });

        it('does not duplicate a row both copies already hold', () => {
            const row = ['Acme', '2020', '2022'];
            const result = reconcileApplicationDraft({
                local: unsynced({ employers: [row] }),
                server: serverDraft({ employers: [row] }),
            });

            expect(result.formData.employers).toEqual([row]);
        });

        it('does not append a blank template row from the losing copy', () => {
            const result = reconcileApplicationDraft({
                local: unsynced({ employers: [['Acme', '2020']] }),
                server: serverDraft({ employers: [['Acme', '2020'], ['', '']] }),
            });

            expect(result.formData.employers).toEqual([['Acme', '2020']]);
        });

        it('leaves the winning copy\'s own rows exactly as they are', () => {
            // Including a trailing blank one: the wizard may be holding it open for
            // input, and rewriting the winner's array could break how rows render.
            const result = reconcileApplicationDraft({
                local: unsynced({ employers: [['Acme', '2020'], ['', '']] }),
                server: serverDraft({ employers: [['Acme', '2020']] }),
            });

            expect(result.formData.employers).toEqual([['Acme', '2020'], ['', '']]);
        });

        it('caps a merged repeating field so the payload stays acceptable', () => {
            // An oversized payload is rejected outright by the server, and a
            // rejected payload means autosave silently stops.
            const rows = (prefix, n) => Array.from({ length: n }, (_, i) => [`${prefix}${i}`]);
            const result = reconcileApplicationDraft({
                local: unsynced({ employers: rows('local', 50) }),
                server: serverDraft({ employers: rows('server', 50) }),
            });

            expect(result.formData.employers.length).toBeLessThanOrEqual(60);
        });

        it('never merges the halves of a value object such as an upload', () => {
            // Per-key merging here would stitch one file's name onto another's URL.
            const result = reconcileApplicationDraft({
                local: unsynced({ 'cdl-front': { name: 'local.pdf', url: 'https://x/local.pdf' } }),
                server: serverDraft({ 'cdl-front': { name: 'server.pdf', url: 'https://x/server.pdf', storagePath: 'p/s.pdf' } }),
            });

            expect(result.formData['cdl-front']).toEqual({
                name: 'local.pdf', url: 'https://x/local.pdf',
            });
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
