/**
 * Review step contract: SSN masking, the yes/no → wording mappings, the previous
 * address branch and its legacy fallback, the Edit navigation targets (0-based
 * wizard indices, not displayed step numbers), and the accessible-name /
 * heading-level defects the design-system migration fixed.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Step8_Review from './Step8_Review';

const FORM = {
  firstName: 'Ada', middleName: 'B', lastName: 'Driver', suffix: 'Jr.',
  dob: '1990-01-01', ssn: '123-45-6789', phone: '5555551234', email: 'ada@example.com',
  street: '1 Main St', city: 'Austin', state: 'Texas', zip: '78701',
  'residence-3-years': 'yes',
  'legal-work': 'yes', 'english-fluency': 'yes', 'experience-years': '3-5',
  'drug-test-positive': 'no', 'dot-return-to-duty': 'yes',
  cdlNumber: 'TX1234567', cdlState: 'Texas', cdlClass: 'A', cdlExpiration: '2030-12-31',
  endorsements: 'H,N', 'has-twic': 'no',
  'revoked-licenses': 'no', 'driving-convictions': 'no', 'drug-alcohol-convictions': 'no',
  expStraightTruckExp: '3-5', expSemiTrailerExp: '3-5',
  ec1Name: 'Bob', ec1Relationship: 'Brother', ec1Phone: '5555559999',
  'has-felony': 'no',
};

const renderReview = (overrides = {}) => {
  const onNavigate = vi.fn();
  render(<Step8_Review formData={{ ...FORM, ...overrides }} onNavigate={onNavigate} />);
  return { onNavigate };
};

describe('Step8_Review data presentation', () => {
  it('masks the SSN to the last four digits', () => {
    renderReview();
    expect(screen.getByText('***-**-6789')).toBeInTheDocument();
    expect(screen.queryByText('123-45-6789')).toBeNull();
  });

  it('says "Not Provided" when no SSN was collected', () => {
    renderReview({ ssn: '' });
    expect(screen.getByText('Not Provided')).toBeInTheDocument();
  });

  it('formats ISO dates for display through the shared helpers', () => {
    renderReview();
    // `formatIsoDateUs` does not zero-pad; that output is the frozen behaviour.
    expect(screen.getByText('1/1/1990')).toBeInTheDocument();
    expect(screen.getByText('12/31/2030')).toBeInTheDocument();
  });

  it('maps the qualification answers to their frozen wording', () => {
    renderReview();
    expect(screen.getByText('Fluent')).toBeInTheDocument();
    expect(screen.getByText('No Issues')).toBeInTheDocument();
  });

  it('lists previous addresses with their period when the driver moved recently', () => {
    renderReview({
      'residence-3-years': 'no',
      previousAddresses: [{ street: '9 Old Rd', city: 'Dallas', state: 'Texas', zip: '75001', startDate: '2019-03', endDate: '2021-06' }],
    });
    expect(screen.getByText('Previous Address 1')).toBeInTheDocument();
    expect(screen.getByText(/9 Old Rd, Dallas, Texas 75001 \(03\/2019 – 06\/2021\)/)).toBeInTheDocument();
  });

  it('falls back to the legacy flat previous-address fields', () => {
    renderReview({
      'residence-3-years': 'no',
      previousAddresses: [],
      prevStreet: '5 Legacy Ln', prevCity: 'Houston', prevState: 'Texas', prevZip: '77001',
    });
    expect(screen.getByText('5 Legacy Ln, Houston, Texas 77001')).toBeInTheDocument();
  });

  it('shows the empty-state copy for accidents and violations', () => {
    renderReview();
    expect(screen.getByText('No accidents listed in the past 3 years.')).toBeInTheDocument();
    expect(screen.getAllByText('None recorded').length).toBeGreaterThan(0);
  });

  it('lists uploaded documents as badges', () => {
    renderReview({ 'cdl-front': { name: 'front.pdf' }, 'medical-card-upload': { name: 'med.pdf' } });
    expect(screen.getByText('📄 front.pdf (Uploaded)')).toBeInTheDocument();
    expect(screen.getByText('📄 med.pdf (Uploaded)')).toBeInTheDocument();
  });

  it('signals a disclosed felony with text and a badge, not colour alone', () => {
    renderReview({ 'has-felony': 'yes', felonyExplanation: 'Details here' });
    expect(screen.getByText('YES - Details here')).toBeInTheDocument();
    expect(screen.getByText('Disclosed')).toBeInTheDocument();
  });

  it('states plainly when there is no felony history', () => {
    renderReview();
    expect(screen.getByText('No Felony Convictions')).toBeInTheDocument();
    expect(screen.queryByText('Disclosed')).toBeNull();
  });
});

describe('Step8_Review navigation', () => {
  it.each([
    ['Personal Information', 0],
    ['Address History', 0],
    ['Qualifications', 1],
    ['License & Credentials', 2],
    ['Driving History', 3],
    ['Accident History', 4],
    ['Work History', 5],
    ['Operations & Compliance', 6],
  ])('Edit %s jumps to wizard index %i', (section, index) => {
    const { onNavigate } = renderReview();
    screen.getByRole('button', { name: `Edit ${section}` }).click();
    expect(onNavigate).toHaveBeenCalledWith(index);
  });

  it('gives every Edit control a unique accessible name', () => {
    renderReview();
    const editButtons = screen.getAllByRole('button', { name: /^Edit / });
    const names = editButtons.map((b) => b.getAttribute('aria-label'));
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
  });

  it('keeps the frozen Back and Confirm & Proceed actions', () => {
    const { onNavigate } = renderReview();
    screen.getByRole('button', { name: 'Confirm & Proceed' }).click();
    expect(onNavigate).toHaveBeenCalledWith('next');

    screen.getByRole('button', { name: 'Back' }).click();
    expect(onNavigate).toHaveBeenCalledWith('back');
  });
});

describe('Step8_Review heading structure', () => {
  it('does not emit an h1 (the wizard title owns it) and uses h2 sections', () => {
    renderReview();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    const h2s = screen.getAllByRole('heading', { level: 2 });
    // "Review & Confirm" plus the eight review sections.
    expect(h2s).toHaveLength(9);
    expect(h2s[0]).toHaveTextContent('Review & Confirm');
  });
});
