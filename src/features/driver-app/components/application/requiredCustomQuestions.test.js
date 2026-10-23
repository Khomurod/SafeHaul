/**
 * Which answer is a custom question's, and when a required one counts as
 * answered: the rule the questions page and the final pre-flight share.
 */
import { describe, expect, it } from 'vitest';
import {
    customAnswerOf,
    customQuestionKey,
    firstUnansweredRequiredQuestion,
    isEmptyCustomAnswer,
} from './requiredCustomQuestions';

describe('customQuestionKey / customAnswerOf', () => {
    it('keys a question by its id, then its key, then its place', () => {
        expect(customQuestionKey({ id: 'a', key: 'b' }, 3)).toBe('a');
        expect(customQuestionKey({ key: 'b' }, 3)).toBe('b');
        expect(customQuestionKey({}, 3)).toBe('custom-question-3');
    });

    it('reads customAnswers first, and an older draft\'s flat answer otherwise', () => {
        expect(customAnswerOf({ customAnswers: { a: 'new' }, a: 'old' }, { id: 'a' }, 0)).toBe('new');
        expect(customAnswerOf({ a: 'old' }, { id: 'a' }, 0)).toBe('old');
    });
});

describe('isEmptyCustomAnswer', () => {
    it.each([
        [{ type: 'shortAnswer' }, undefined, true],
        [{ type: 'shortAnswer' }, '', true],
        [{ type: 'shortAnswer' }, '  \t', true],
        [{ type: 'shortAnswer' }, 'six', false],
        [{ type: 'number' }, '1,000', false],
        [{ type: 'linearScale' }, 0, false],
        [{ type: 'checkboxes' }, [], true],
        [{ type: 'checkboxes' }, [' '], true],
        [{ type: 'checkboxes' }, ['Reefer'], false],
        [{ type: 'fileUpload' }, '   ', true],
        [{ type: 'fileUpload' }, { name: 'r.pdf', storagePath: 'x/r.pdf' }, false],
    ])('%j with %j → %s', (field, value, empty) => {
        expect(isEmptyCustomAnswer(field, value)).toBe(empty);
    });
});

describe('firstUnansweredRequiredQuestion', () => {
    const questions = [
        { id: 'q1', label: 'Optional', type: 'shortAnswer' },
        { id: 'q2', label: 'Required A', type: 'shortAnswer', required: true },
        { id: 'q3', label: 'Required B', type: 'dropdown', required: true },
    ];

    it('finds the first required question with no answer, skipping optional ones', () => {
        expect(firstUnansweredRequiredQuestion(questions, { customAnswers: { q2: 'yes' } })).toBe(questions[2]);
    });

    it('is null when every required question is answered, or there are none', () => {
        expect(firstUnansweredRequiredQuestion(questions, { customAnswers: { q2: 'a', q3: 'b' } })).toBeNull();
        expect(firstUnansweredRequiredQuestion(undefined, {})).toBeNull();
    });
});
