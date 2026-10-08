import { describe, expect, it } from 'vitest';
import { isRemovedRefusal } from './draftRemoval';
import { INVITE_OUTCOMES, classifyInviteFailure } from './publicApplyInvite';

const notFound = (details) => Object.assign(new Error('That saved application could not be found.'), {
    code: 'functions/not-found', ...(details ? { details } : {}),
});

describe('a refusal because the company deleted the application', () => {
    it('is a not-found that says so, and nothing else', () => {
        expect(isRemovedRefusal(notFound({ reason: 'removed' }))).toBe(true);
        expect(isRemovedRefusal(notFound())).toBe(false);
        expect(isRemovedRefusal(notFound({ reason: 'other' }))).toBe(false);
        expect(isRemovedRefusal(Object.assign(new Error('x'), { code: 'functions/internal', details: { reason: 'removed' } }))).toBe(false);
        expect(isRemovedRefusal(null)).toBe(false);
    });

    it('is its own outcome for a link, while every other dead link stays one', () => {
        expect(classifyInviteFailure(notFound({ reason: 'removed' }))).toBe(INVITE_OUTCOMES.REMOVED);
        expect(classifyInviteFailure(notFound())).toBe(INVITE_OUTCOMES.UNOPENABLE);
    });
});
