import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { QuestionEditor } from './QuestionEditor';
import { INITIAL_QUESTION_STATE, QUESTION_TYPES } from './QuestionConfig';

function baseQuestion(overrides = {}) {
    return { ...INITIAL_QUESTION_STATE, id: 'q-1', label: 'Existing question', ...overrides };
}

// Controlled harness at index 2 (question 3) with move/delete spies.
function Harness({ question, onChangeSpy, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
    const [q, setQ] = useState(question);
    return (
        <QuestionEditor
            question={q}
            index={2}
            onChange={(i, updated) => { onChangeSpy?.(i, updated); setQ(updated); }}
            onDelete={onDelete ?? vi.fn()}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
        />
    );
}

describe('QuestionEditor', () => {
    it('renders associated labels for the editor fields', () => {
        render(<Harness question={baseQuestion()} />);
        expect(screen.getByRole('textbox', { name: 'Question 3 title' })).toHaveValue('Existing question');
        expect(screen.getByRole('combobox', { name: 'Question 3 answer type' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /Question 3 description/ })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Question 3' })).toBeInTheDocument();
    });

    it('edits label and help text through onChange', () => {
        const onChangeSpy = vi.fn();
        render(<Harness question={baseQuestion({ label: '' })} onChangeSpy={onChangeSpy} />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Question 3 title' }), {
            target: { value: 'Do you have flatbed experience?' },
        });
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ label: 'Do you have flatbed experience?' }));

        fireEvent.change(screen.getByRole('textbox', { name: /Question 3 description/ }), {
            target: { value: 'Optional context' },
        });
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ helpText: 'Optional context' }));
    });

    it('supports every question type in the answer-type select', () => {
        render(<Harness question={baseQuestion()} />);
        const select = screen.getByRole('combobox', { name: 'Question 3 answer type' });
        QUESTION_TYPES.forEach((t) => {
            expect(within(select).getByRole('option', { name: t.label })).toBeInTheDocument();
        });
    });

    it('initializes ["Option 1"] when changing to an option type with no options', () => {
        const onChangeSpy = vi.fn();
        render(<Harness question={baseQuestion({ type: 'shortAnswer', options: [] })} onChangeSpy={onChangeSpy} />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Question 3 answer type' }), {
            target: { value: 'multipleChoice' },
        });
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({
            type: 'multipleChoice',
            options: ['Option 1'],
        }));
    });

    it('does not overwrite existing options on type change', () => {
        const onChangeSpy = vi.fn();
        render(<Harness question={baseQuestion({ type: 'multipleChoice', options: ['Yes', 'No'] })} onChangeSpy={onChangeSpy} />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Question 3 answer type' }), {
            target: { value: 'dropdown' },
        });
        const [, updated] = onChangeSpy.mock.calls.at(-1);
        expect(updated.type).toBe('dropdown');
        expect(updated.options).toEqual(['Yes', 'No']);
    });

    it('adds and removes options with accessible controls', () => {
        const onChangeSpy = vi.fn();
        render(<Harness question={baseQuestion({ type: 'checkboxes', options: ['A'] })} onChangeSpy={onChangeSpy} />);

        fireEvent.change(screen.getByRole('textbox', { name: 'Question 3 option 1' }), { target: { value: 'Alpha' } });
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ options: ['Alpha'] }));

        fireEvent.click(screen.getByRole('button', { name: 'Add Option' }));
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ options: ['Alpha', 'Option 2'] }));

        fireEvent.click(screen.getByRole('button', { name: 'Remove option 1 from question 3' }));
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ options: ['Option 2'] }));
    });

    it('preserves the DOT compliance mappings', () => {
        const onChangeSpy = vi.fn();
        render(<Harness question={baseQuestion()} onChangeSpy={onChangeSpy} />);

        // DOT Required
        fireEvent.click(screen.getByRole('checkbox', { name: 'DOT Required' }));
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ dotRequired: true }));
        // FMCSA reference input now visible
        fireEvent.change(screen.getByRole('textbox', { name: 'Question 3 FMCSA reference' }), {
            target: { value: '49 CFR 391.21' },
        });
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ fmcsaReference: '49 CFR 391.21' }));

        // Lock inverse mapping: checking "Lock" sets canCompanyHide=false
        fireEvent.click(screen.getByRole('checkbox', { name: "Lock (companies can't hide)" }));
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ canCompanyHide: false }));

        // Protect inverse mapping: checking "Protect label" sets canCompanyModify=false
        fireEvent.click(screen.getByRole('checkbox', { name: 'Protect label (read-only)' }));
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ canCompanyModify: false }));
    });

    it('reflects locked/protected state as checked (inverse) when set', () => {
        render(<Harness question={baseQuestion({ canCompanyHide: false, canCompanyModify: false })} />);
        expect(screen.getByRole('checkbox', { name: "Lock (companies can't hide)" })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Protect label (read-only)' })).toBeChecked();
    });

    it('toggles the required switch with programmatic state', () => {
        const onChangeSpy = vi.fn();
        render(<Harness question={baseQuestion({ required: false })} onChangeSpy={onChangeSpy} />);
        const req = screen.getByRole('switch', { name: 'Required' });
        expect(req).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(req);
        expect(onChangeSpy).toHaveBeenLastCalledWith(2, expect.objectContaining({ required: true }));
    });

    it('deletes via an accessible button naming the question number', () => {
        const onDelete = vi.fn();
        render(<Harness question={baseQuestion()} onDelete={onDelete} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete question 3' }));
        expect(onDelete).toHaveBeenCalledWith(2);
    });

    it('exposes keyboard reorder controls with correct disabled boundaries', () => {
        const onMoveUp = vi.fn();
        const onMoveDown = vi.fn();
        const { rerender } = render(
            <QuestionEditor
                question={baseQuestion()} index={0}
                onChange={vi.fn()} onDelete={vi.fn()}
                onMoveUp={onMoveUp} onMoveDown={onMoveDown}
                canMoveUp={false} canMoveDown
            />,
        );
        expect(screen.getByRole('button', { name: 'Move question 1 up' })).toBeDisabled();
        const down = screen.getByRole('button', { name: 'Move question 1 down' });
        expect(down).toBeEnabled();
        fireEvent.click(down);
        expect(onMoveDown).toHaveBeenCalledWith(0);

        rerender(
            <QuestionEditor
                question={baseQuestion()} index={3}
                onChange={vi.fn()} onDelete={vi.fn()}
                onMoveUp={onMoveUp} onMoveDown={onMoveDown}
                canMoveUp canMoveDown={false}
            />,
        );
        expect(screen.getByRole('button', { name: 'Move question 4 down' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Move question 4 up' }));
        expect(onMoveUp).toHaveBeenCalledWith(3);
    });

    it('has no accessibility violations (with options and DOT reference visible)', async () => {
        const { container } = render(
            <Harness question={baseQuestion({ type: 'dropdown', options: ['A', 'B'], dotRequired: true })} />,
        );
        expect((await axe(container)).violations).toEqual([]);
    });
});
