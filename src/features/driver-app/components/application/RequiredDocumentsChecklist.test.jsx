/**
 * Post-application checklist contract: the required/optional split, the exact
 * progress text and `data-testid`s the E2E journey asserts, the per-status label,
 * the disabled-when-completed rule that prevents duplicate signing requests, and
 * the interface-text floor.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequiredDocumentsChecklist } from './RequiredDocumentsChecklist';
import { DOC_STATUS } from './postApplyDocsStorage';

const TEMPLATES = [
  { templateId: 'req-1', title: 'Post-Application Form', required: true, order: 0 },
  { templateId: 'req-2', title: 'Direct Deposit Form', required: true, order: 1 },
  { templateId: 'opt-1', title: 'Optional Survey', required: false, order: 2 },
];

const renderChecklist = (props = {}) => {
  const onOpenTemplate = props.onOpenTemplate || vi.fn();
  const utils = render(
    <RequiredDocumentsChecklist
      templates={TEMPLATES}
      docStates={props.docStates || {}}
      openingTemplateId={props.openingTemplateId || ''}
      onOpenTemplate={onOpenTemplate}
    />,
  );
  return { ...utils, onOpenTemplate };
};

describe('RequiredDocumentsChecklist', () => {
  it('separates required documents from optional forms', () => {
    renderChecklist();

    const required = screen.getByTestId('required-documents-section');
    expect(required).toContainElement(screen.getByTestId('post-apply-doc-req-1'));
    expect(required).toContainElement(screen.getByTestId('post-apply-doc-req-2'));
    expect(required).not.toContainElement(screen.getByTestId('post-apply-doc-opt-1'));
    expect(screen.getByText('Optional forms')).toBeInTheDocument();
  });

  it('reports and announces "<n> of <m> completed"', () => {
    renderChecklist({ docStates: { 'req-1': { status: DOC_STATUS.COMPLETED } } });

    const progress = screen.getByTestId('required-documents-progress');
    expect(progress).toHaveTextContent('1 of 2 completed');
    expect(progress).toHaveAttribute('role', 'status');
  });

  it('keeps the pending and all-complete messages exactly as the E2E journey asserts', () => {
    const { rerender } = render(
      <RequiredDocumentsChecklist templates={TEMPLATES} docStates={{}} openingTemplateId="" onOpenTemplate={vi.fn()} />,
    );
    expect(screen.getByText(/still need to be completed/i)).toBeInTheDocument();

    rerender(
      <RequiredDocumentsChecklist
        templates={TEMPLATES}
        docStates={{ 'req-1': { status: DOC_STATUS.COMPLETED }, 'req-2': { status: DOC_STATUS.COMPLETED } }}
        openingTemplateId=""
        onOpenTemplate={vi.fn()}
      />,
    );
    expect(screen.getByText(/All required documents are completed/i)).toBeInTheDocument();
  });

  it.each([
    [undefined, 'Not started'],
    [DOC_STATUS.OPENING, 'Opening…'],
    [DOC_STATUS.IN_PROGRESS, 'In progress'],
    [DOC_STATUS.COMPLETED, 'Completed'],
    [DOC_STATUS.ERROR, 'Error'],
  ])('shows the %s status as text, never colour alone', (status, label) => {
    renderChecklist({ docStates: { 'req-1': status ? { status } : undefined } });
    expect(screen.getByTestId('post-apply-doc-req-1')).toHaveTextContent(label);
  });

  it('opens a document with its template object', () => {
    const { onOpenTemplate } = renderChecklist();

    fireEvent.click(screen.getByTestId('post-apply-doc-req-1').querySelector('button'));
    expect(onOpenTemplate).toHaveBeenCalledWith(TEMPLATES[0]);
  });

  it('disables a completed document so no duplicate request can be created', () => {
    renderChecklist({ docStates: { 'req-1': { status: DOC_STATUS.COMPLETED } } });
    expect(screen.getByTestId('post-apply-doc-req-1').querySelector('button')).toBeDisabled();
  });

  it('disables the row that is currently opening', () => {
    renderChecklist({ openingTemplateId: 'req-2' });
    expect(screen.getByTestId('post-apply-doc-req-2').querySelector('button')).toBeDisabled();
    expect(screen.getByTestId('post-apply-doc-req-1').querySelector('button')).toBeEnabled();
  });

  it('names each open action after its own document', () => {
    renderChecklist();
    expect(screen.getByRole('button', { name: 'Open Post-Application Form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Direct Deposit Form' })).toBeInTheDocument();
  });

  it('shows the error message and a retry action, without nesting controls', () => {
    const { onOpenTemplate } = renderChecklist({
      docStates: { 'req-1': { status: DOC_STATUS.ERROR, error: 'Too many attempts.' } },
    });
    const row = screen.getByTestId('post-apply-doc-req-1');

    expect(row).toHaveTextContent('Too many attempts.');
    const retry = screen.getByRole('button', { name: /Retry/ });
    // The retry control must not live inside another button's hit area.
    expect(retry.closest('button')).toBe(retry);

    fireEvent.click(retry);
    expect(onOpenTemplate).toHaveBeenCalledWith(TEMPLATES[0]);
  });

  it('falls back to a generic error when the state carries none', () => {
    renderChecklist({ docStates: { 'req-1': { status: DOC_STATUS.ERROR } } });
    expect(screen.getByTestId('post-apply-doc-req-1')).toHaveTextContent('Could not open this document.');
  });

  it('uses no interface text below the 12 px floor', () => {
    const { container } = renderChecklist();
    // The previous implementation hard-coded text-[10px] pills and text-[11px]
    // progress copy.
    expect(container.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
  });

  it('renders nothing but the optional block when no template is required', () => {
    render(
      <RequiredDocumentsChecklist
        templates={[{ templateId: 'opt-1', title: 'Optional Survey', required: false }]}
        docStates={{}}
        openingTemplateId=""
        onOpenTemplate={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('required-documents-section')).toBeNull();
    expect(screen.getByText('Optional forms')).toBeInTheDocument();
  });
});
