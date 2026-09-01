// VOE preview contract, part 2 of 3: the html2canvas → jsPDF export and the
// onClose / onSend callback contracts.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `VOEPreviewModal.contract.support.jsx`; the registrations below delegate to
// it. See that file's header for the scope of this contract freeze.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/context/DataContext', async () => (await import('./VOEPreviewModal.contract.support')).dataContextMock());
vi.mock('@shared/utils/sanitizeUserContent', async (importOriginal) => (await import('./VOEPreviewModal.contract.support')).sanitizeUserContentMock(importOriginal));
vi.mock('html2canvas', async () => (await import('./VOEPreviewModal.contract.support')).html2canvasMock());
vi.mock('jspdf', async () => (await import('./VOEPreviewModal.contract.support')).jspdfMock());

import { VOEPreviewModal } from './VOEPreviewModal';
import {
    makeRenderModal,
    resetHarness,
    documentNode,
    h2cMock,
    pdfMock,
    EMPLOYER,
    APPLICANT,
} from './VOEPreviewModal.contract.support';

const renderModal = makeRenderModal(VOEPreviewModal);

beforeEach(resetHarness);

afterEach(cleanup);

describe('VOEPreviewModal PDF export', () => {
  beforeEach(() => {
    h2cMock.fn.mockResolvedValue({
      width: 816,
      height: 1056,
      toDataURL: () => 'data:image/png;base64,PDFIMAGE',
    });
  });

  it('captures the document node with the frozen html2canvas options', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));

    await waitFor(() => expect(h2cMock.fn).toHaveBeenCalled());
    const [node, options] = h2cMock.fn.mock.calls[0];
    expect(node).toBe(documentNode());
    expect(options).toEqual({ scale: 2, useCORS: true });
  });

  it('builds the pdf at the captured canvas dimensions in px', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));

    await waitFor(() => expect(pdfMock.ctor).toHaveBeenCalled());
    expect(pdfMock.ctor).toHaveBeenCalledWith({
      orientation: 'portrait',
      unit: 'px',
      format: [816, 1056],
    });
    expect(pdfMock.addImage).toHaveBeenCalledWith('data:image/png;base64,PDFIMAGE', 'PNG', 0, 0, 816, 1056);
  });

  it('saves with the frozen filename, underscoring whitespace', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));

    await waitFor(() => expect(pdfMock.save).toHaveBeenCalledWith('VOE_Acme_Freight_Maria_Garcia.pdf'));
  });

  it('falls back to Employer in the filename when the employer has no companyName', async () => {
    renderModal({ employer: { ...EMPLOYER, companyName: undefined } });
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));

    await waitFor(() => expect(pdfMock.save).toHaveBeenCalledWith('VOE_Employer_Maria_Garcia.pdf'));
  });

  it('reports a generation failure and recovers the control', async () => {
    h2cMock.fn.mockRejectedValue(new Error('canvas exploded'));
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));

    await waitFor(() => expect(screen.getByRole('alert'))
      .toHaveTextContent('Failed to generate PDF. Please try again.'));
    expect(pdfMock.save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /Download PDF/i })).toBeEnabled());
  });
});

describe('VOEPreviewModal callbacks', () => {
  it('returns to the request modal from the header close', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns to the request modal from Edit Request', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Request' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('transmits with no arguments when a signature is present', () => {
    const { onSend } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Transmit Request Now/i }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith();
  });

  it('accepts a typed signature for transmission', () => {
    const { onSend } = renderModal({ applicant: { ...APPLICANT, signature: 'TEXT_SIGNATURE:Maria Garcia' } });
    fireEvent.click(screen.getByRole('button', { name: /Transmit Request Now/i }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('blocks transmission without a signature', () => {
    const { onSend } = renderModal({ applicant: { ...APPLICANT, signature: undefined } });
    const transmit = screen.getByRole('button', { name: /Transmit Request Now/i });

    expect(transmit).toBeDisabled();
    fireEvent.click(transmit);
    expect(onSend).not.toHaveBeenCalled();
  });
});
