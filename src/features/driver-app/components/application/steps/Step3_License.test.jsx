import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Step3_License from './Step3_License';

vi.mock('@/context/DataContext', () => ({
  useData: () => ({
    currentCompanyProfile: {
      applicationConfig: {
        cdlUpload: { hidden: false, required: true },
        medCardUpload: { hidden: false, required: true },
      },
    },
  }),
}));

vi.mock('@shared/hooks/useUtils', () => ({
  useUtils: () => ({ states: ['TX', 'CA'] }),
}));

const baseFormData = {
  cdlState: 'TX',
  cdlClass: 'Class A',
  cdlNumber: 'D1234567',
  cdlExpiration: '2030-01-01',
  'has-other-licenses': 'no',
  'has-twic': 'no',
};

const renderStep = (overrides = {}) => {
  const props = {
    formData: { ...baseFormData, ...overrides.formData },
    updateFormData: overrides.updateFormData || vi.fn(),
    handleFileUpload: overrides.handleFileUpload || vi.fn(),
    onNavigate: overrides.onNavigate || vi.fn(),
    isUploading: false,
    ...overrides,
  };

  render(
    <form id="driver-form">
      <Step3_License {...props} />
    </form>
  );

  const formEl = document.getElementById('driver-form');
  if (formEl) {
    formEl.checkValidity = vi.fn(() => true);
    formEl.reportValidity = vi.fn();
  }

  return props;
};

describe('Step3_License required upload gating', () => {
  it('blocks continue when required uploads are missing', () => {
    const onNavigate = vi.fn();
    renderStep({ onNavigate });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(/please upload required documents:/i)).toBeInTheDocument();
  });

  it('allows continue when required uploads are present', () => {
    const onNavigate = vi.fn();
    renderStep({
      onNavigate,
      formData: {
        'cdl-front': { name: 'front.pdf', url: 'https://example.com/front.pdf' },
        'cdl-back': { name: 'back.pdf', url: 'https://example.com/back.pdf' },
        'medical-card-upload': { name: 'med.pdf', url: 'https://example.com/med.pdf' },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onNavigate).toHaveBeenCalledWith('next');
  });
});
