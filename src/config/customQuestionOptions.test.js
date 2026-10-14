import { describe, expect, it } from 'vitest';
import { shownOptions, withoutBlankOptions } from './customQuestionOptions';

describe('shownOptions', () => {
    it('drops options with no text, in either shape, and keeps the order', () => {
        expect(shownOptions(['Yes', '', '  ', 'No', { value: 'x', label: ' ' }, { value: 'm', label: 'Maybe' }]))
            .toEqual(['Yes', 'No', { value: 'm', label: 'Maybe' }]);
    });

    it('keeps an option as it was written, spaces and all', () => {
        expect(shownOptions([' Yes '])).toEqual([' Yes ']);
    });

    it('is empty for no options', () => {
        expect(shownOptions(undefined)).toEqual([]);
        expect(shownOptions(null)).toEqual([]);
    });
});

describe('withoutBlankOptions', () => {
    it('cleans each question that has options and leaves the others alone', () => {
        const text = { id: 'q1', type: 'shortAnswer', label: 'Why us?' };
        const choice = { id: 'q2', type: 'multipleChoice', label: 'Endorsement', options: ['Hazmat', '', 'Tanker'] };

        expect(withoutBlankOptions([text, choice])).toEqual([
            text,
            { ...choice, options: ['Hazmat', 'Tanker'] },
        ]);
        expect(choice.options).toEqual(['Hazmat', '', 'Tanker']);
    });

    it('is empty for no questions', () => {
        expect(withoutBlankOptions(undefined)).toEqual([]);
    });
});
