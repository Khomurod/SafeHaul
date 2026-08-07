/**
 * Review & Confirm contract.
 *
 * REWRITTEN, because the screen it described was wrong. It used to render from a
 * hand-written field list, and this file froze that list's behaviour — including
 * three defects the driver could see:
 *
 *   * a row for a question the company had HIDDEN;
 *   * `undefined (undefined) - undefined` where an optional emergency contact
 *     or an unanswered experience dropdown was interpolated into a template;
 *   * no custom questions at all, so a driver could not review the answers they
 *     had just given.
 *
 * The screen now resolves the same section table the preserved record and the
 * PDF use, so what the driver confirms and what is frozen a moment later are the
 * same thing by construction. That moves some wording — "Not provided" rather
 * than "Not Provided", the definition's own labels rather than this screen's,
 * zero-padded dates matching the record — and those changes are asserted here
 * deliberately rather than preserved.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

let companyProfile = { applicationConfig: {}, customQuestions: [] };
vi.mock('@/context/DataContext', () => ({
  useData: () => ({ currentCompanyProfile: companyProfile }),
}));

import Step8_Review from './Step8_Review';

afterEach(cleanup);

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

const renderReview = (overrides = {}, { applicationConfig = {}, customQuestions = [] } = {}) => {
  companyProfile = { applicationConfig, customQuestions };
  const onNavigate = vi.fn();
  render(<Step8_Review formData={{ ...FORM, ...overrides }} onNavigate={onNavigate} />);
  return { onNavigate };
};

describe('Review & Confirm — what it shows', () => {
  it('masks the SSN to the last four digits', () => {
    renderReview();
    expect(screen.getByText('***-**-6789')).toBeInTheDocument();
    expect(screen.queryByText('123-45-6789')).toBeNull();
  });

  it('formats dates the way the preserved record and the PDF do', () => {
    renderReview();
    expect(screen.getByText('01/01/1990')).toBeInTheDocument();
    expect(screen.getByText('12/31/2030')).toBeInTheDocument();
  });

  it('uses the definition\'s wording for every question', () => {
    renderReview();
    expect(screen.getByText('Social Security Number')).toBeInTheDocument();
    expect(screen.getByText('English Fluency')).toBeInTheDocument();
    expect(screen.getByText('Licence Ever Suspended, Revoked or Denied')).toBeInTheDocument();
  });

  it('lists previous addresses as labelled rows, not a joined string', () => {
    renderReview({
      'residence-3-years': 'no',
      previousAddresses: [{ street: '9 Old Rd', city: 'Dallas', state: 'Texas', zip: '75001', startDate: '2019-03', endDate: '2021-06' }],
    });
    expect(screen.getByText('9 Old Rd')).toBeInTheDocument();
    expect(screen.getByText('03/2019')).toBeInTheDocument();
    expect(screen.getByText('06/2021')).toBeInTheDocument();
  });

  it('says a repeating section is empty rather than leaving a gap', () => {
    renderReview();
    expect(screen.getAllByText('None added.').length).toBeGreaterThan(0);
  });

  it('names an uploaded document by its filename', () => {
    renderReview({ 'cdl-front': { name: 'front.pdf' }, 'medical-card-upload': { name: 'med.pdf' } });
    expect(screen.getByText('front.pdf')).toBeInTheDocument();
    expect(screen.getByText('med.pdf')).toBeInTheDocument();
  });

  it('shows a felony explanation only once one is disclosed', () => {
    renderReview();
    expect(screen.queryByText('Felony Explanation')).toBeNull();

    cleanup();
    renderReview({ 'has-felony': 'yes', felonyExplanation: 'Details here' });
    expect(screen.getByText('Felony Explanation')).toBeInTheDocument();
    expect(screen.getByText('Details here')).toBeInTheDocument();
  });
});

describe('Review & Confirm — what it must NOT show', () => {
  it('renders no row for a question the company hid', () => {
    // The old screen showed "SSN: Not Provided" on an application that never
    // asked for one.
    renderReview({}, { applicationConfig: { ssn: { hidden: true } } });
    expect(screen.queryByText('Social Security Number')).toBeNull();
    expect(screen.queryByText('***-**-6789')).toBeNull();
  });

  it('renders no emergency-contact rows when the section is hidden', () => {
    renderReview({}, { applicationConfig: { emergencyContacts: { hidden: true } } });
    expect(screen.queryByText(/Emergency Contact #1 Name/i)).toBeNull();
  });

  it('never prints the string "undefined"', () => {
    // "undefined (undefined) - undefined" and "undefined yrs" both reached
    // applicants from interpolated template strings.
    renderReview({
      ec1Name: '', ec1Relationship: '', ec1Phone: '',
      expStraightTruckExp: '', expSemiTrailerExp: '',
    }, { applicationConfig: { emergencyContacts: { hidden: false, required: false } } });
    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it('never prints [object Object] for a repeating group', () => {
    renderReview({
      employers: [{ companyName: 'Acme Freight', position: 'Driver', startDate: '2020-01', endDate: '2024-01' }],
    });
    expect(document.body.textContent).not.toMatch(/\[object Object\]/);
    expect(screen.getByText('Acme Freight')).toBeInTheDocument();
  });

  it('says a blank answer is not provided instead of leaving it empty', () => {
    renderReview({ middleName: '' });
    expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0);
  });
});

describe('Review & Confirm — custom questions', () => {
  const QUESTIONS = [
    { id: 'q-uuid-1111-2222', label: 'Are you willing to run a dedicated lane?', type: 'multipleChoice' },
    { id: 'q-uuid-3333-4444', type: 'shortAnswer' },
  ];

  it('shows the driver the answers they just gave', () => {
    renderReview(
      { customAnswers: { 'q-uuid-1111-2222': 'Yes', 'q-uuid-3333-4444': 'Maybe' } },
      { customQuestions: QUESTIONS },
    );
    const question = screen.getByText('Are you willing to run a dedicated lane?');
    // The answer sits in the <dd> beside its <dt>; 'Yes' appears elsewhere on
    // the page for the standard yes/no questions, so scope the assertion.
    expect(question.nextElementSibling).toHaveTextContent('Yes');
  });

  it('describes a question with no recorded wording instead of printing its id', () => {
    renderReview(
      { customAnswers: { 'q-uuid-3333-4444': 'Maybe' } },
      { customQuestions: QUESTIONS },
    );
    expect(screen.getByText('Question wording not recorded')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/q-uuid-3333-4444/);
  });

  it('omits the section entirely when the company asks nothing extra', () => {
    renderReview();
    expect(screen.queryByText('Additional Questions')).toBeNull();
  });
});

describe('Review & Confirm — navigation and structure', () => {
  it.each([
    ['Personal Information', 0],
    ['Address History', 0],
    ['General Qualifications', 1],
    ['License & Credentials', 2],
    ['Driving Record', 3],
    ['Employment History', 5],
  ])('Edit %s jumps to wizard index %i', (section, index) => {
    const { onNavigate } = renderReview();
    screen.getByRole('button', { name: `Edit ${section}` }).click();
    expect(onNavigate).toHaveBeenCalledWith(index);
  });

  it('gives every Edit control a unique accessible name', () => {
    renderReview();
    const names = screen.getAllByRole('button', { name: /^Edit / }).map((b) => b.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(4);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the frozen Back and Confirm & Proceed actions', () => {
    const { onNavigate } = renderReview();
    screen.getByRole('button', { name: 'Confirm & Proceed' }).click();
    expect(onNavigate).toHaveBeenCalledWith('next');

    screen.getByRole('button', { name: 'Back' }).click();
    expect(onNavigate).toHaveBeenCalledWith('back');
  });

  it('does not emit an h1 — the wizard title owns it — and uses h2 sections', () => {
    renderReview();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s[0]).toHaveTextContent('Review & Confirm');
    expect(h2s.length).toBeGreaterThan(4);
  });
});
