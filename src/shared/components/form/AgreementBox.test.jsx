/**
 * `AgreementBox` legal contract: the stored `'agreed'` / `''` values, the
 * checkbox element id, the frozen legend/label/description strings, the branding
 * hook call, and the keyboard-reachable disclosure scroll region added by the
 * design-system migration.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const initializeFormBranding = vi.fn();
vi.mock('../../hooks/useUtils', () => ({
  useUtils: () => ({ initializeFormBranding, states: [] }),
}));

import AgreementBox from './AgreementBox';

const renderBox = (props = {}) => {
  const updateFormData = props.updateFormData || vi.fn();
  const utils = render(
    <AgreementBox
      contentId="Background Check Disclosure"
      companyData={{ companyName: 'Acme Freight' }}
      formData={props.formData || {}}
      updateFormData={updateFormData}
      checkboxName="agree-background-check"
      checkboxLabel="I Acknowledge and Authorize"
      checkboxDescription="I have read, understood, and agree to the Background Check Disclosure."
      required
      {...props}
    >
      <p>In connection with your application for employment, a consumer report may be requested about you.</p>
    </AgreementBox>,
  );
  return { ...utils, updateFormData };
};

describe('AgreementBox', () => {
  it('stores "agreed" when checked and "" when unchecked', () => {
    const { updateFormData } = renderBox();
    const box = document.getElementById('agree-background-check');

    fireEvent.click(box);
    expect(updateFormData).toHaveBeenLastCalledWith('agree-background-check', 'agreed');
  });

  it('clears the value back to an empty string when unchecked', () => {
    const { updateFormData } = renderBox({ formData: { 'agree-background-check': 'agreed' } });
    fireEvent.click(document.getElementById('agree-background-check'));
    expect(updateFormData).toHaveBeenLastCalledWith('agree-background-check', '');
  });

  it('reflects the stored "agreed" value as checked', () => {
    renderBox({ formData: { 'agree-background-check': 'agreed' } });
    expect(document.getElementById('agree-background-check')).toBeChecked();
  });

  it('treats any other stored value as unchecked', () => {
    renderBox({ formData: { 'agree-background-check': 'maybe' } });
    expect(document.getElementById('agree-background-check')).not.toBeChecked();
  });

  it('keeps the frozen legend, label, description and disclosure body', () => {
    renderBox();
    expect(screen.getByRole('group', { name: 'Background Check Disclosure' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /I Acknowledge and Authorize required/i })).toBeRequired();
    expect(screen.getByText('I have read, understood, and agree to the Background Check Disclosure.')).toBeInTheDocument();
    expect(screen.getByText(/a consumer report may be requested about you/)).toBeInTheDocument();
  });

  it('exposes the disclosure as a keyboard-reachable, named scroll region', () => {
    const { container } = renderBox();
    const region = container.querySelector('.agreement-box');
    expect(region).toHaveAttribute('tabindex', '0');
    // Distinct from the fieldset's own name so the two do not collide.
    expect(region).toHaveAttribute('aria-label', 'Background Check Disclosure full text');
  });

  it('still runs the company branding pass', () => {
    initializeFormBranding.mockClear();
    renderBox();
    expect(initializeFormBranding).toHaveBeenCalledWith({ companyName: 'Acme Freight' });
  });

  it('omits the acknowledgement control when showCheckbox is false', () => {
    renderBox({ showCheckbox: false });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
