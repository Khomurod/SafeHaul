/**
 * Custom-questions step: the `customAnswers` write contract, the answer-key
 * resolution order, the per-type required rule, and the labelling defect the
 * design-system migration fixed (every control was previously unlabelled).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const showError = vi.fn();
vi.mock('@shared/components/feedback/ToastProvider', () => ({
  useToast: () => ({ showError, showSuccess: vi.fn() }),
}));

import { DynamicQuestionsStep } from './DynamicQuestionsStep';

const renderStep = (questions, props = {}) => {
  const updateFormData = props.updateFormData || vi.fn();
  const onNavigate = props.onNavigate || vi.fn();
  const utils = render(
    <form id="driver-form">
      <DynamicQuestionsStep
        questions={questions}
        formData={props.formData || {}}
        updateFormData={updateFormData}
        onNavigate={onNavigate}
        handleFileUpload={props.handleFileUpload}
      />
    </form>,
  );
  return { ...utils, updateFormData, onNavigate };
};

describe('DynamicQuestionsStep labelling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('labels a short-answer control with its question', () => {
    renderStep([{ id: 'q1', label: 'Why do you want to drive for us?', type: 'shortAnswer' }]);
    expect(screen.getByLabelText('Why do you want to drive for us?')).toBeInstanceOf(HTMLInputElement);
  });

  it('labels a paragraph control with its question', () => {
    renderStep([{ id: 'q2', label: 'Describe your experience', type: 'paragraph' }]);
    expect(screen.getByLabelText('Describe your experience')).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('labels a dropdown control with its question', () => {
    renderStep([{ id: 'q3', label: 'Preferred region', type: 'dropdown', options: ['West', 'East'] }]);
    expect(screen.getByLabelText('Preferred region')).toBeInstanceOf(HTMLSelectElement);
  });

  it('labels a time control with its question', () => {
    renderStep([{ id: 'q4', label: 'Preferred start time', type: 'time' }]);
    expect(screen.getByLabelText('Preferred start time')).toHaveAttribute('type', 'time');
  });

  it('labels a number control with its question', () => {
    renderStep([{ id: 'q5', label: 'Years on the road', type: 'number' }]);
    expect(screen.getByLabelText('Years on the road')).toHaveAttribute('type', 'number');
  });

  it('groups a multiple-choice question under one legend with named options', () => {
    renderStep([{ id: 'q6', label: 'Route preference', type: 'multipleChoice', options: ['OTR', 'Local'] }]);
    expect(screen.getByRole('group', { name: 'Route preference' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'OTR' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Local' })).toBeInTheDocument();
  });

  it('groups a checkboxes question under one legend with named options', () => {
    renderStep([{ id: 'q7', label: 'Equipment experience', type: 'checkboxes', options: ['Reefer', 'Flatbed'] }]);
    expect(screen.getByRole('group', { name: 'Equipment experience' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Reefer' })).toBeInTheDocument();
  });

  it('labels a date question through the shared triplet field', () => {
    renderStep([{ id: 'q8', label: 'Available from', type: 'date' }]);
    expect(screen.getByRole('group', { name: /Available from/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Available from month')).toBeInTheDocument();
  });

  it('labels the file-upload control and its trigger', () => {
    renderStep([{ id: 'q9', label: 'Upload your resume', type: 'fileUpload' }]);
    expect(screen.getByLabelText(/Upload your resume/)).toHaveAttribute('type', 'file');
  });

  it('names every linear-scale option and captions the endpoints', () => {
    renderStep([{ id: 'q10', label: 'Rate your experience', type: 'linearScale', min: 1, max: 3, minLabel: 'Low', maxLabel: 'High' }]);
    expect(screen.getByRole('group', { name: 'Rate your experience' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1 — Low' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3 — High' })).toBeInTheDocument();
  });

  it('marks required questions on the control itself', () => {
    renderStep([{ id: 'q11', label: 'Required question', type: 'shortAnswer', required: true }]);
    const control = screen.getByLabelText(/Required question/);
    expect(control).toBeRequired();
    expect(control).toHaveAttribute('aria-required', 'true');
  });

  it('shows the DOT marker for dotRequired questions', () => {
    renderStep([{ id: 'q12', label: 'DOT question', type: 'shortAnswer', dotRequired: true }]);
    expect(screen.getByText('DOT')).toBeInTheDocument();
  });

  it('keeps Back a non-submitting button so it never triggers form validation', () => {
    renderStep([{ id: 'q13', label: 'Q', type: 'shortAnswer' }]);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('type', 'button');
  });
});

describe('DynamicQuestionsStep answer contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes text answers into the customAnswers object under the question id', () => {
    const { updateFormData } = renderStep([{ id: 'q1', label: 'Why us?', type: 'shortAnswer' }]);

    fireEvent.change(screen.getByLabelText('Why us?'), { target: { value: 'Great pay' } });
    expect(updateFormData).toHaveBeenCalledWith('customAnswers', { q1: 'Great pay' });
  });

  it('merges into existing answers instead of replacing them', () => {
    const { updateFormData } = renderStep(
      [{ id: 'q2', label: 'Second', type: 'shortAnswer' }],
      { formData: { customAnswers: { q1: 'kept' } } },
    );

    fireEvent.change(screen.getByLabelText('Second'), { target: { value: 'new' } });
    expect(updateFormData).toHaveBeenCalledWith('customAnswers', { q1: 'kept', q2: 'new' });
  });

  it('toggles checkbox answers as an array', () => {
    const { updateFormData } = renderStep(
      [{ id: 'q3', label: 'Equipment', type: 'checkboxes', options: ['Reefer', 'Flatbed'] }],
      { formData: { customAnswers: { q3: ['Reefer'] } } },
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Flatbed' }));
    expect(updateFormData).toHaveBeenCalledWith('customAnswers', { q3: ['Reefer', 'Flatbed'] });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Reefer' }));
    expect(updateFormData).toHaveBeenCalledWith('customAnswers', { q3: [] });
  });

  it('coerces linear-scale answers to numbers', () => {
    const { updateFormData } = renderStep([{ id: 'q4', label: 'Rate', type: 'linearScale', min: 1, max: 3 }]);

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    expect(updateFormData).toHaveBeenCalledWith('customAnswers', { q4: 2 });
  });

  it('resolves the answer key from id, then key, then a positional fallback', () => {
    renderStep(
      [
        { id: 'by-id', label: 'A', type: 'shortAnswer' },
        { key: 'by-key', label: 'B', type: 'shortAnswer' },
        { label: 'C', type: 'shortAnswer' },
      ],
      { formData: { customAnswers: { 'by-id': 'one', 'by-key': 'two', 'custom-question-2': 'three' } } },
    );

    expect(screen.getByLabelText('A')).toHaveValue('one');
    expect(screen.getByLabelText('B')).toHaveValue('two');
    expect(screen.getByLabelText('C')).toHaveValue('three');
  });

  it('falls back to a flat formData value when customAnswers has no entry', () => {
    renderStep([{ id: 'legacy', label: 'Legacy', type: 'shortAnswer' }], { formData: { legacy: 'flat value' } });
    expect(screen.getByLabelText('Legacy')).toHaveValue('flat value');
  });

  /*
   * Until 2026-10-02 this recorded `file.name` the moment a file was chosen and
   * threw away the storage path the upload returned, so the company saw a filename
   * nothing referenced — and a failed upload still read as answered.
   */
  it('records the uploaded file as the answer once the upload has landed', async () => {
    let land;
    const handleFileUpload = vi.fn(() => new Promise((resolve) => { land = resolve; }));
    const { updateFormData } = renderStep(
      [{ id: 'q5', label: 'Resume', type: 'fileUpload' }],
      { handleFileUpload },
    );

    const f = new File(['x'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Resume/), { target: { files: [f] } });

    expect(handleFileUpload).toHaveBeenCalledWith('q5', f);
    expect(screen.getByText('Uploading...')).toBeInTheDocument();
    expect(updateFormData).not.toHaveBeenCalled();

    const uploaded = { name: 'resume.pdf', storagePath: 'companies/c1/applications/guest_uploads/u1_resume.pdf' };
    await act(async () => { land(uploaded); });

    expect(screen.queryByText('Uploading...')).toBeNull();
    expect(updateFormData).toHaveBeenCalledWith('customAnswers', expect.any(Function));
    // Merged into the answers as they are when it lands, so one given meanwhile survives.
    const merge = updateFormData.mock.calls[0][1];
    expect(merge({ q1: 'answered meanwhile' })).toEqual({ q1: 'answered meanwhile', q5: uploaded });
    expect(merge(undefined)).toEqual({ q5: uploaded });
  });

  it('records nothing when the upload fails', async () => {
    let fail;
    const handleFileUpload = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
    const { updateFormData } = renderStep(
      [{ id: 'q5', label: 'Resume', type: 'fileUpload' }],
      { handleFileUpload },
    );

    fireEvent.change(screen.getByLabelText(/Resume/), {
      target: { files: [new File(['x'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    await act(async () => { fail(new Error('Upload failed.')); });

    // The handler finished — it no longer says an upload is under way — and wrote nothing.
    expect(screen.queryByText('Uploading...')).toBeNull();
    expect(updateFormData).not.toHaveBeenCalled();
  });

  it('shows an uploaded file by its name', () => {
    renderStep(
      [{ id: 'q5', label: 'Resume', type: 'fileUpload' }],
      { formData: { customAnswers: { q5: { name: 'resume.pdf', storagePath: 'companies/c1/x/guest_uploads/u1.pdf' } } } },
    );
    expect(screen.getByText('✓ Selected: resume.pdf')).toBeInTheDocument();
  });
});

describe('DynamicQuestionsStep required gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks Continue with the frozen message naming the unanswered question', () => {
    const { onNavigate } = renderStep([{ id: 'q1', label: 'Why us?', type: 'shortAnswer', required: true }]);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('Please answer required question: Why us?');
  });

  it('treats an empty checkbox array as unanswered', () => {
    const { onNavigate } = renderStep(
      [{ id: 'q2', label: 'Equipment', type: 'checkboxes', options: ['Reefer'], required: true }],
      { formData: { customAnswers: { q2: [] } } },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('treats a blank file answer as unanswered', () => {
    const { onNavigate } = renderStep(
      [{ id: 'q3', label: 'Resume', type: 'fileUpload', required: true }],
      { formData: { customAnswers: { q3: '   ' } } },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('advances once every required question is answered', () => {
    const { onNavigate } = renderStep(
      [
        { id: 'q1', label: 'Why us?', type: 'shortAnswer', required: true },
        { id: 'q2', label: 'Optional', type: 'shortAnswer' },
      ],
      { formData: { customAnswers: { q1: 'answered' } } },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNavigate).toHaveBeenCalledWith('next');
    expect(showError).not.toHaveBeenCalled();
  });

  it('shows the empty-state copy when a company configured no questions', () => {
    renderStep([]);
    expect(screen.getByText('No additional questions for this company.')).toBeInTheDocument();
  });
});
