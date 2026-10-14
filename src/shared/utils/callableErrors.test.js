import { describe, expect, it } from 'vitest';
import { serverMessageOf } from './callableErrors';

describe('serverMessageOf', () => {
    it("returns the sentence a server refusal carries", () => {
        expect(serverMessageOf({ code: 'functions/resource-exhausted', message: 'Too many submissions. Please wait.' }))
            .toBe('Too many submissions. Please wait.');
    });

    it.each([
        ['deadline-exceeded', 'deadline-exceeded'],
        ['internal', 'internal'],
        ['internal', 'INTERNAL'],
        ['deadline-exceeded', 'DEADLINE_EXCEEDED'],
    ])('is null for the bare code "%s" spelt "%s", which the server never wrote', (code, message) => {
        expect(serverMessageOf({ code: `functions/${code}`, message })).toBeNull();
    });

    it('is null for no error, or no message', () => {
        expect(serverMessageOf(null)).toBeNull();
        expect(serverMessageOf(undefined)).toBeNull();
        expect(serverMessageOf({ code: 'functions/internal', message: '  ' })).toBeNull();
    });
});
