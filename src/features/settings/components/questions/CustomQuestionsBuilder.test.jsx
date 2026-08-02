import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomQuestionsBuilder } from './CustomQuestionsBuilder';
import { INITIAL_QUESTION_STATE } from './QuestionConfig';

// Controlled harness mirroring how CompanyProfileTab owns the questions array.
function Harness({ initial = [], onChangeSpy, onSave, loading }) {
    const [questions, setQuestions] = useState(initial);
    return (
        <CustomQuestionsBuilder
            questions={questions}
            onChange={(next) => { onChangeSpy?.(next); setQuestions(next); }}
            onSave={onSave ?? vi.fn()}
            loading={loading}
        />
    );
}

beforeEach(() => {
    let counter = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++counter}` });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('CustomQuestionsBuilder', () => {
    it('creates a new question with a UUID and the exact initial defaults', () => {
        const onChangeSpy = vi.fn();
        render(<Harness onChangeSpy={onChangeSpy} />);
        fireEvent.click(screen.getByRole('button', { name: /Add your first question/i }));

        expect(onChangeSpy).toHaveBeenCalledTimes(1);
        const [created] = onChangeSpy.mock.calls[0][0];
        expect(created).toEqual({ ...INITIAL_QUESTION_STATE, id: 'uuid-1' });
        // Explicit spot checks of the frozen defaults.
        expect(created.type).toBe('shortAnswer');
        expect(created.required).toBe(false);
        expect(created.options).toEqual(['Option 1']);
        expect(created.dotRequired).toBe(false);
        expect(created.canCompanyHide).toBe(true);
        expect(created.canCompanyModify).toBe(true);
    });

    it('appends additional questions and reports the count', () => {
        const onChangeSpy = vi.fn();
        render(<Harness initial={[{ ...INITIAL_QUESTION_STATE, id: 'a', label: 'First' }]} onChangeSpy={onChangeSpy} />);
        expect(screen.getByText('1 questions added')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Add Question$/i }));
        const appended = onChangeSpy.mock.calls[0][0];
        expect(appended).toHaveLength(2);
        expect(appended[0].id).toBe('a');
        expect(appended[1].id).toBe('uuid-1');
    });

    it('toggles Preview and Edit mode', () => {
        render(<Harness initial={[{ ...INITIAL_QUESTION_STATE, id: 'a', label: 'Night driving?' }]} />);
        // Edit mode: the editor group is present.
        expect(screen.getByRole('group', { name: 'Question 1' })).toBeInTheDocument();

        const toggle = screen.getByRole('button', { name: 'Preview' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(toggle);

        expect(screen.getByRole('button', { name: 'Edit Mode' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('group', { name: 'Question 1' })).not.toBeInTheDocument();
        expect(screen.getByText('Night driving?')).toBeInTheDocument();
    });

    it('blocks deletion of a DOT-required question with the exact message, shown inline rather than a blocking alert', () => {
        const alertMock = vi.fn();
        vi.stubGlobal('alert', alertMock);
        const onChangeSpy = vi.fn();
        render(
            <Harness
                initial={[{ ...INITIAL_QUESTION_STATE, id: 'dot', label: 'SSN', dotRequired: true }]}
                onChangeSpy={onChangeSpy}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Delete question 1' }));

        expect(alertMock).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Cannot delete DOT-required field. This question is mandated by FMCSA regulations.',
        );
        expect(onChangeSpy).not.toHaveBeenCalled();
    });

    it('clears the blocked-delete message once a deletable question is removed', () => {
        render(
            <Harness
                initial={[
                    { ...INITIAL_QUESTION_STATE, id: 'dot', label: 'SSN', dotRequired: true },
                    { ...INITIAL_QUESTION_STATE, id: 'b', label: 'Removable' },
                ]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Delete question 1' }));
        expect(screen.getByRole('alert')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Delete question 2' }));
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('deletes a non-DOT question', () => {
        const onChangeSpy = vi.fn();
        render(
            <Harness
                initial={[
                    { ...INITIAL_QUESTION_STATE, id: 'a', label: 'Keep' },
                    { ...INITIAL_QUESTION_STATE, id: 'b', label: 'Remove' },
                ]}
                onChangeSpy={onChangeSpy}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Delete question 2' }));
        expect(onChangeSpy).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'a' }),
        ]);
    });

    it('reorders questions with keyboard move controls, preserving the array format', () => {
        const onChangeSpy = vi.fn();
        render(
            <Harness
                initial={[
                    { ...INITIAL_QUESTION_STATE, id: 'a', label: 'A' },
                    { ...INITIAL_QUESTION_STATE, id: 'b', label: 'B' },
                    { ...INITIAL_QUESTION_STATE, id: 'c', label: 'C' },
                ]}
                onChangeSpy={onChangeSpy}
            />,
        );
        // Move question 2 (B) up → order b, a, c.
        fireEvent.click(screen.getByRole('button', { name: 'Move question 2 up' }));
        expect(onChangeSpy.mock.calls.at(-1)[0].map((q) => q.id)).toEqual(['b', 'a', 'c']);
    });

    it('moves a question down', () => {
        const onChangeSpy = vi.fn();
        render(
            <Harness
                initial={[
                    { ...INITIAL_QUESTION_STATE, id: 'a', label: 'A' },
                    { ...INITIAL_QUESTION_STATE, id: 'b', label: 'B' },
                ]}
                onChangeSpy={onChangeSpy}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Move question 1 down' }));
        expect(onChangeSpy.mock.calls.at(-1)[0].map((q) => q.id)).toEqual(['b', 'a']);
    });

    it('calls onSave and disables the save button while loading', () => {
        const onSave = vi.fn();
        const { rerender } = render(<Harness initial={[]} onSave={onSave} loading={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(onSave).toHaveBeenCalledTimes(1);

        rerender(
            <CustomQuestionsBuilder questions={[]} onChange={vi.fn()} onSave={onSave} loading />,
        );
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    });

    it('has no accessibility violations in edit and preview modes', async () => {
        const { container } = render(
            <Harness initial={[{ ...INITIAL_QUESTION_STATE, id: 'a', label: 'Flatbed experience?', type: 'dropdown', options: ['Yes', 'No'] }]} />,
        );
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect((await axe(container)).violations).toEqual([]);
    });
});
