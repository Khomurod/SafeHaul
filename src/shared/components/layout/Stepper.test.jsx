/**
 * Wizard-frame contract: step titles, the `#step-title` / `#driver-form` element
 * contracts the E2E specs depend on, progress semantics, heading structure and
 * the focus move on step change.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/signature', () => ({
  initializeSignatureCanvas: vi.fn(),
  clearCanvas: vi.fn(),
}));

// Steps are replaced by probes: this file is about the frame, not the fields.
// Each factory is inlined because `vi.mock` is hoisted above module scope.
vi.mock('../../../features/driver-app/components/application/steps/Step1_Contact', () => ({ __esModule: true, default: () => <p>contact body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step2_Qualifications', () => ({ __esModule: true, default: () => <p>qualifications body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step3_License', () => ({ __esModule: true, default: () => <p>license body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step4_Violations', () => ({ __esModule: true, default: () => <p>violations body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step5_Accidents', () => ({ __esModule: true, default: () => <p>accidents body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step6_Employment', () => ({ __esModule: true, default: () => <p>employment body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step7_General', () => ({ __esModule: true, default: () => <p>general body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step8_Review', () => ({ __esModule: true, default: () => <p>review body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/Step9_Consent', () => ({ __esModule: true, default: () => <p>consent body</p> }));
vi.mock('../../../features/driver-app/components/application/steps/DynamicQuestionsStep', () => ({
  DynamicQuestionsStep: () => <p>custom questions body</p>,
}));

import Stepper, { buildSemanticStepOrder, resolveWizardStepIndex } from './Stepper';

const baseProps = {
  formData: {},
  updateFormData: vi.fn(),
  onNavigate: vi.fn(),
  onPartialSubmit: vi.fn(),
  onFinalSubmit: vi.fn(),
  handleFileUpload: vi.fn(),
  isUploading: false,
  submissionStatus: null,
};

const renderStepper = (overrides = {}) =>
  render(<Stepper {...baseProps} step={0} {...overrides} />);

describe('Stepper semantic step order', () => {
  it('keeps the nine-step order and inserts custom questions before review', () => {
    expect(buildSemanticStepOrder(false)).toEqual([
      'contact', 'qualifications', 'license', 'violations', 'accidents',
      'employment', 'general', 'review', 'consent',
    ]);
    expect(buildSemanticStepOrder(true)[7]).toBe('custom_questions');
    expect(buildSemanticStepOrder(true)).toHaveLength(10);
  });

  it('resolves semantic ids and numeric indexes, falling back to the first step', () => {
    expect(resolveWizardStepIndex('consent', false)).toBe(8);
    expect(resolveWizardStepIndex('consent', true)).toBe(9);
    expect(resolveWizardStepIndex(3, false)).toBe(3);
    expect(resolveWizardStepIndex('nope', false)).toBe(0);
  });
});

describe('Stepper frame', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the exact frozen "Step 1 of 9: Personal Information" title on #step-title', () => {
    renderStepper();
    const title = document.getElementById('step-title');
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('Step 1 of 9: Personal Information');
  });

  it('makes the step title the page h1 so each step is not an unlabelled document', () => {
    renderStepper();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAttribute('id', 'step-title');
  });

  it.each([
    [0, 'Step 1 of 9: Personal Information'],
    [1, 'Step 2 of 9: Qualification Information'],
    [2, 'Step 3 of 9: License Information'],
    [3, 'Step 4 of 9: Motor Vehicle Record'],
    [4, 'Step 5 of 9: Accident History'],
    [5, 'Step 6 of 9: Employment History'],
    [6, 'Step 7 of 9: General Questions'],
    [7, 'Step 8 of 9: Review Information'],
    [8, 'Step 9 of 9: Agreements & Signature'],
  ])('step %i keeps its frozen title', (step, expected) => {
    renderStepper({ step });
    expect(document.getElementById('step-title').textContent).toBe(expected);
  });

  it('renumbers to ten steps and inserts Additional Questions when custom questions exist', () => {
    const customQuestions = [{ id: 'q1', label: 'Why us?', type: 'shortAnswer' }];
    renderStepper({ step: 7, customQuestions });
    expect(document.getElementById('step-title').textContent).toBe('Step 8 of 10: Additional Questions');
    expect(screen.getByText('custom questions body')).toBeInTheDocument();

    renderStepper({ step: 9, customQuestions });
    expect(document.querySelectorAll('#step-title')[1].textContent)
      .toBe('Step 10 of 10: Agreements & Signature');
  });

  it('exposes progress as a labelled progressbar instead of a styled div width', () => {
    renderStepper({ step: 3 });
    const bar = screen.getByRole('progressbar', { name: 'Step 4 of 9: Motor Vehicle Record' });
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuemax', '9');
    expect(bar).toHaveAttribute('id', 'progress-bar');
  });

  it('only reaches 100% on success, and maps status to tone', () => {
    const { container, rerender } = render(<Stepper {...baseProps} step={2} submissionStatus="success" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '9');
    expect(container.querySelector('.ds-progress')).toHaveAttribute('data-tone', 'success');

    rerender(<Stepper {...baseProps} step={2} submissionStatus="error" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    expect(container.querySelector('.ds-progress')).toHaveAttribute('data-tone', 'danger');

    rerender(<Stepper {...baseProps} step={2} submissionStatus="queued" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    expect(container.querySelector('.ds-progress')).toHaveAttribute('data-tone', 'warning');
  });

  it('keeps the #driver-form element every step validates against', () => {
    renderStepper();
    const form = document.getElementById('driver-form');
    expect(form).not.toBeNull();
    expect(form.tagName).toBe('FORM');
  });

  it('moves focus to the step heading when the step changes', () => {
    const { rerender } = render(<Stepper {...baseProps} step={0} />);
    expect(document.activeElement).toBe(document.getElementById('step-title'));

    // Move focus away, then advance: focus must come back to the new heading
    // rather than being dropped on <body> when the Continue button unmounts.
    document.body.focus();
    rerender(<Stepper {...baseProps} step={1} />);
    expect(document.activeElement).toBe(document.getElementById('step-title'));
    expect(document.activeElement.textContent).toBe('Step 2 of 9: Qualification Information');
  });

  it('keeps the frozen out-of-range fallback message', () => {
    renderStepper({ step: 42 });
    expect(screen.getByText('Error: Step 43 not found.')).toBeInTheDocument();
  });

  it('shows the sandbox Magic Fill control only in sandbox mode', () => {
    const onMagicFillStep = vi.fn();
    renderStepper({ isSandboxMode: true, onMagicFillStep });
    expect(screen.getByRole('button', { name: /Magic Fill Step/ })).toBeInTheDocument();

    renderStepper({ isSandboxMode: false, onMagicFillStep });
    expect(screen.getAllByRole('button', { name: /Magic Fill Step/ })).toHaveLength(1);
  });

  it('initialises the signature canvas only on the last step', async () => {
    const { initializeSignatureCanvas } = await import('@/lib/signature');
    vi.useFakeTimers();
    try {
      renderStepper({ step: 0 });
      vi.advanceTimersByTime(200);
      expect(initializeSignatureCanvas).not.toHaveBeenCalled();

      renderStepper({ step: 8 });
      vi.advanceTimersByTime(200);
      expect(initializeSignatureCanvas).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
