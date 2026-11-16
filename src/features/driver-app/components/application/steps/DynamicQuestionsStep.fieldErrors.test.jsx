/**
 * The company's own questions say what is wrong at the question, as page one
 * does, never in a toast that is gone in seconds: each required question left
 * unanswered says so under itself once Continue is pressed, announced and
 * describing its control; Continue stays refused and the focus goes to the first
 * question at fault; each message leaves as its question is answered.
 * All fixtures are artificial.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const showError = vi.hoisted(() => vi.fn());
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showError, showSuccess: vi.fn() }),
}));

import { DynamicQuestionsStep } from './DynamicQuestionsStep';

const ANSWER_IT = 'Please answer this question.';
const CHOOSE_ONE = 'Please choose at least one.';
const UPLOAD_IT = 'Please upload a file.';
const HALF_CHOSEN = 'Choose the hour, minutes and AM or PM.';

/** The step holding its answers in state, as the wizard does (writes may be functions). */
function Questions({ questions, initial, onNavigate, handleFileUpload }) {
    const [formData, setFormData] = useState(initial);
    const updateFormData = (name, value) => setFormData((previous) => ({
        ...previous,
        [name]: typeof value === 'function' ? value(previous[name]) : value,
    }));
    return (
        <form id="driver-form">
            <DynamicQuestionsStep
                questions={questions}
                formData={formData}
                updateFormData={updateFormData}
                onNavigate={onNavigate}
                handleFileUpload={handleFileUpload}
            />
        </form>
    );
}

function renderQuestions(questions, { answers = {}, handleFileUpload } = {}) {
    const onNavigate = vi.fn();
    render(
        <Questions
            questions={questions}
            initial={{ customAnswers: answers }}
            onNavigate={onNavigate}
            handleFileUpload={handleFileUpload}
        />,
    );
    return onNavigate;
}

const pressContinue = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

/** The message is announced and describes `described` (a control or a group). */
function expectMessageOn(described, text) {
    const message = screen.getByText(text);
    expect(message).toHaveAttribute('role', 'alert');
    expect(message.id).toBeTruthy();
    expect(described.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
    return message;
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('a required question left unanswered says so under itself', () => {
    it.each([
        ['short answer', 'shortAnswer'],
        ['paragraph', 'paragraph'],
        ['number', 'number'],
        ['dropdown', 'dropdown'],
    ])('a %s: at its control, with the focus there and no toast', (_name, type) => {
        const onNavigate = renderQuestions([
            { id: 'q1', label: 'Your answer', type, required: true, options: ['West', 'East'] },
        ]);
        expect(screen.queryByText(ANSWER_IT)).toBeNull();

        pressContinue();

        const control = screen.getByLabelText(/Your answer/);
        expectMessageOn(control, ANSWER_IT);
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(document.activeElement).toBe(control);
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it.each([
        ['multiple choice', { type: 'multipleChoice', options: ['OTR', 'Local'] }, 'OTR', ANSWER_IT],
        ['linear scale', { type: 'linearScale', min: 1, max: 3, minLabel: 'Low', maxLabel: 'High' }, '1 — Low', ANSWER_IT],
        ['checkboxes', { type: 'checkboxes', options: ['Reefer', 'Flatbed'] }, 'Reefer', CHOOSE_ONE],
    ])('a %s question: under its group, with the focus on its first choice', (_name, shape, firstChoice, text) => {
        const onNavigate = renderQuestions([{ id: 'q1', label: 'Pick one', required: true, ...shape }]);

        pressContinue();

        expectMessageOn(screen.getByRole('group', { name: /Pick one/ }), text);
        expect(document.activeElement).toBe(screen.getByLabelText(firstChoice));
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('a date: under its lists, describing each, with the focus on the month', () => {
        const onNavigate = renderQuestions([{ id: 'q1', label: 'Available from', type: 'date', required: true }]);

        pressContinue();

        const message = expectMessageOn(screen.getByRole('group', { name: /Available from/ }), ANSWER_IT);
        for (const part of ['month', 'day', 'year']) {
            const list = screen.getByLabelText(`Available from ${part}`);
            expect(list.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
            expect(list).toHaveAttribute('aria-invalid', 'true');
        }
        expect(document.activeElement).toBe(screen.getByLabelText('Available from month'));
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('a time: under its lists, describing each, with the focus on the hour', () => {
        const onNavigate = renderQuestions([{ id: 'q1', label: 'Start time', type: 'time', required: true }]);

        pressContinue();

        const message = expectMessageOn(screen.getByRole('group', { name: /Start time/ }), ANSWER_IT);
        for (const part of ['hour', 'minutes', 'AM or PM']) {
            const list = screen.getByLabelText(`Start time ${part}`);
            expect(list.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
            expect(list).toHaveAttribute('aria-invalid', 'true');
        }
        expect(document.activeElement).toBe(screen.getByLabelText('Start time hour'));
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('a file: under its picker, describing it, with the focus on the picker', () => {
        const onNavigate = renderQuestions(
            [{ id: 'q1', label: 'Upload your resume', type: 'fileUpload', required: true }],
            { handleFileUpload: vi.fn(async () => null) },
        );

        pressContinue();

        const picker = screen.getByLabelText(/Upload your resume/);
        expectMessageOn(picker, UPLOAD_IT);
        expect(document.activeElement).toBe(picker);
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('treats an answer of only spaces as no answer', () => {
        const onNavigate = renderQuestions(
            [{ id: 'q1', label: 'Years driving', type: 'shortAnswer', required: true }],
            { answers: { q1: '   ' } },
        );

        pressContinue();

        expectMessageOn(screen.getByLabelText(/Years driving/), ANSWER_IT);
        expect(document.activeElement).toBe(screen.getByLabelText(/Years driving/));
        expect(onNavigate).not.toHaveBeenCalled();
    });
});

describe('several questions at once', () => {
    const QUESTIONS = [
        { id: 'q1', label: 'Optional note', type: 'shortAnswer' },
        { id: 'q2', label: 'Answered already', type: 'shortAnswer', required: true },
        { id: 'q3', label: 'Route preference', type: 'multipleChoice', options: ['OTR', 'Local'], required: true },
        { id: 'q4', label: 'Why us?', type: 'paragraph', required: true },
    ];

    it('marks every required question left unanswered, and focuses the first of them', () => {
        const onNavigate = renderQuestions(QUESTIONS, { answers: { q2: 'yes' } });

        pressContinue();

        const route = screen.getByRole('group', { name: /Route preference/ });
        expect(within(route).getByText(ANSWER_IT)).toHaveAttribute('role', 'alert');
        expect(screen.getByLabelText(/Why us\?/)).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getAllByText(ANSWER_IT)).toHaveLength(2);
        // Neither the optional question nor the answered one says anything.
        expect(screen.getByLabelText('Optional note')).not.toHaveAttribute('aria-invalid');
        expect(screen.getByLabelText(/Answered already/)).not.toHaveAttribute('aria-invalid');
        expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'OTR' }));
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('takes each message away as its question is answered, and then moves on', () => {
        const onNavigate = renderQuestions(QUESTIONS, { answers: { q2: 'yes' } });
        pressContinue();
        expect(screen.getAllByText(ANSWER_IT)).toHaveLength(2);

        fireEvent.click(screen.getByRole('radio', { name: 'Local' }));
        expect(screen.getAllByText(ANSWER_IT)).toHaveLength(1);

        fireEvent.change(screen.getByLabelText(/Why us\?/), { target: { value: 'Home every weekend' } });
        expect(screen.queryByText(ANSWER_IT)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();

        pressContinue();
        expect(onNavigate).toHaveBeenCalledWith('next');
        expect(showError).not.toHaveBeenCalled();
    });

    it('says it again when an answer is taken away after the first Continue', () => {
        renderQuestions(QUESTIONS, { answers: { q2: 'yes', q3: 'OTR', q4: 'x' } });
        pressContinue();

        fireEvent.change(screen.getByLabelText(/Answered already/), { target: { value: '' } });

        expectMessageOn(screen.getByLabelText(/Answered already/), ANSWER_IT);
    });

    it('says nothing before the first Continue', () => {
        renderQuestions(QUESTIONS);
        expect(screen.queryByRole('alert')).toBeNull();
        for (const control of [screen.getByLabelText(/Why us\?/), screen.getByLabelText(/Answered already/)]) {
            expect(control).not.toHaveAttribute('aria-invalid');
        }
    });
});

describe('a time half chosen', () => {
    it('says which lists are still empty under the question, with the focus on the first', () => {
        const onNavigate = renderQuestions([{ id: 'q1', label: 'Start time', type: 'time' }]);
        fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '6' } });

        pressContinue();

        const message = expectMessageOn(screen.getByLabelText('Start time minutes'), HALF_CHOSEN);
        expect(screen.getByLabelText('Start time minutes')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Start time AM or PM')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Start time hour')).not.toHaveAttribute('aria-invalid');
        expect(screen.getByRole('group', { name: /Start time/ }).getAttribute('aria-describedby')).toContain(message.id);
        expect(document.activeElement).toBe(screen.getByLabelText('Start time minutes'));
        expect(onNavigate).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Start time minutes'), { target: { value: '30' } });
        fireEvent.change(screen.getByLabelText('Start time AM or PM'), { target: { value: 'AM' } });
        expect(screen.queryByText(HALF_CHOSEN)).toBeNull();

        pressContinue();
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('says the more exact thing for a required time half chosen, focusing the list still empty', () => {
        renderQuestions([{ id: 'q1', label: 'Start time', type: 'time', required: true }]);
        fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '6' } });

        pressContinue();

        expect(screen.getByText(HALF_CHOSEN)).toHaveAttribute('role', 'alert');
        expect(screen.queryByText(ANSWER_IT)).toBeNull();
        expect(document.activeElement).toBe(screen.getByLabelText('Start time minutes'));
    });

    it('says nothing about a time half chosen before Continue', () => {
        renderQuestions([{ id: 'q1', label: 'Start time', type: 'time' }]);
        fireEvent.change(screen.getByLabelText('Start time hour'), { target: { value: '6' } });
        expect(screen.queryByText(HALF_CHOSEN)).toBeNull();
    });
});

describe('a file question', () => {
    it('takes the message away once the upload has landed', async () => {
        const uploaded = { name: 'resume.pdf', storagePath: 'companies/c1/applications/guest_uploads/u1_resume.pdf' };
        renderQuestions(
            [{ id: 'q1', label: 'Upload your resume', type: 'fileUpload', required: true }],
            { handleFileUpload: vi.fn(async () => uploaded) },
        );
        pressContinue();
        expect(screen.getByText(UPLOAD_IT)).toBeInTheDocument();

        await act(async () => {
            fireEvent.change(screen.getByLabelText(/Upload your resume/), {
                target: { files: [new File(['x'], 'resume.pdf', { type: 'application/pdf' })] },
            });
        });

        expect(screen.queryByText(UPLOAD_IT)).toBeNull();
        expect(screen.getByText('✓ Selected: resume.pdf')).toBeInTheDocument();
    });
});
