/**
 * A driver referral link: the choice between the quick interest form and the
 * full application, the form's checks, what it sends, and where the choice sits
 * among the page's other first screens.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resolveApplyStatusScreen } from './PublicApplyScreens';
import { adoptReferralCode, referralCodeFrom, referralConsentText } from './referralIntake';

const { callable, send } = vi.hoisted(() => {
  const sendFn = vi.fn();
  return { send: sendFn, callable: vi.fn(() => sendFn) };
});

vi.mock('firebase/functions', () => ({ httpsCallable: callable }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@features/sandbox/SandboxActionPanel', () => ({
  SandboxActionPanel: () => <div data-testid="sandbox-panel" />,
}));
vi.mock('./IntakeChooser', () => ({
  IntakeChooser: () => <div data-testid="intake-chooser" />,
}));

const screenFor = (overrides = {}) => resolveApplyStatusScreen({
  loading: false,
  error: '',
  isParsingCdl: false,
  sandbox: false,
  sandboxSubmission: null,
  submissionStatus: null,
  inviteProblem: null,
  inviteProblemDismissed: false,
  onContinueWithoutInvite: vi.fn(),
  identityCheck: null,
  onConfirmIdentity: vi.fn(),
  intakeMode: null,
  companyId: 'company-1',
  companyName: 'Blue Line Freight',
  referralCode: 'ABCD2345',
  handleChooseAutoFill: vi.fn(),
  handleChooseManual: vi.fn(),
  cdlAutoFillInputRef: { current: null },
  handleCdlAutoFillFileChange: vi.fn(),
  ...overrides,
});

async function openQuickForm(user) {
  render(screenFor());
  await user.click(screen.getByRole('button', { name: /Quick interest/ }));
}

async function fillQuickForm(user) {
  await user.type(screen.getByLabelText(/First name/), 'Sam');
  await user.type(screen.getByLabelText(/Last name/), 'Rivera');
  await user.type(screen.getByLabelText(/Phone/), '(312) 555-0142');
  await user.type(screen.getByLabelText(/Email/), 'sam.rivera@example.com');
  await user.click(screen.getByRole('checkbox'));
}

beforeEach(() => {
  send.mockReset();
  callable.mockClear();
});

describe('the code in the link', () => {
  it('takes a well-formed code, in any case, and nothing else', () => {
    expect(referralCodeFrom(new URLSearchParams('ref=abcd2345'))).toBe('ABCD2345');
    expect(referralCodeFrom(new URLSearchParams('ref=ABCD234'))).toBeNull();
    expect(referralCodeFrom(new URLSearchParams('ref=ABCD234O'))).toBeNull();
    expect(referralCodeFrom(new URLSearchParams('r=ABCD2345'))).toBeNull();
  });

  it('goes into the answers over whatever a restored draft carried', () => {
    const setFormData = vi.fn();
    adoptReferralCode(new URLSearchParams('ref=ZXCV6789'), setFormData);
    expect(setFormData.mock.calls[0][0]({ firstName: 'Sam', referralCode: 'ABCD2345' }))
      .toEqual({ firstName: 'Sam', referralCode: 'ZXCV6789' });

    const untouched = vi.fn();
    adoptReferralCode(new URLSearchParams(''), untouched);
    expect(untouched).not.toHaveBeenCalled();
  });

  it('shows the consent the server records, word for word', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../../../../functions/referrals/submitReferralInterest.js'), 'utf8');
    const [first, second] = referralConsentText('${companyName}').split('. M');
    expect(server).toContain(`\`${first}. \``);
    expect(server).toContain(`'M${second}'`);
  });
});

describe('where the referral choice sits', () => {
  it('takes the intake chooser\'s place when the link carries a code', () => {
    render(screenFor());
    expect(screen.getByRole('heading', { name: 'Blue Line Freight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick interest/ })).toBeInTheDocument();
    expect(screen.queryByTestId('intake-chooser')).toBeNull();
  });

  it('is the plain chooser without a code', () => {
    render(screenFor({ referralCode: undefined }));
    expect(screen.getByTestId('intake-chooser')).toBeInTheDocument();
  });

  it('is skipped by everything that skips the chooser', () => {
    expect(screenFor({ intakeMode: 'manual' })).toBeNull();
    render(screenFor({ identityCheck: { busy: false, error: null } }));
    expect(screen.queryByRole('button', { name: /Quick interest/ })).toBeNull();
  });

  it('leads to the ordinary chooser for the full application', async () => {
    const user = userEvent.setup();
    render(screenFor());
    await user.click(screen.getByRole('button', { name: /Full application/ }));
    expect(screen.getByTestId('intake-chooser')).toBeInTheDocument();
  });
});

describe('the quick interest form', () => {
  it('names every missing answer and sends nothing', async () => {
    const user = userEvent.setup();
    await openQuickForm(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('First name is required.')).toBeInTheDocument();
    expect(screen.getByText('Last name is required.')).toBeInTheDocument();
    expect(screen.getByText('Phone is required.')).toBeInTheDocument();
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText(/Please agree to be contacted/)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a short phone and a malformed email', async () => {
    const user = userEvent.setup();
    await openQuickForm(user);
    await user.type(screen.getByLabelText(/Phone/), '555-0142');
    await user.type(screen.getByLabelText(/Email/), 'sam@example');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('Enter a 10-digit US phone number.')).toBeInTheDocument();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the answers with the link\'s code and thanks the driver', async () => {
    send.mockResolvedValue({ data: { ok: true } });
    const user = userEvent.setup();
    await openQuickForm(user);
    expect(screen.getByRole('checkbox', { name: /I agree that Blue Line Freight may contact me/ })).toBeInTheDocument();
    await fillQuickForm(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(callable).toHaveBeenCalledWith({}, 'submitReferralInterest');
    expect(send).toHaveBeenCalledWith({
      companyId: 'company-1',
      referralCode: 'ABCD2345',
      firstName: 'Sam',
      lastName: 'Rivera',
      phone: '(312) 555-0142',
      email: 'sam.rivera@example.com',
      contactConsent: true,
    });
    const thanks = await screen.findByRole('heading', { name: 'Thank you' });
    expect(thanks).toHaveFocus();
    expect(screen.getByText('A recruiter from Blue Line Freight will contact you soon.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fill out the full application' }));
    expect(screen.getByTestId('intake-chooser')).toBeInTheDocument();
  });

  it('keeps the answers and shows the server\'s reason when it refuses', async () => {
    send.mockRejectedValue(Object.assign(new Error('Too many tries. Please wait a minute and try again.'), {
      code: 'functions/resource-exhausted',
    }));
    const user = userEvent.setup();
    await openQuickForm(user);
    await fillQuickForm(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Too many tries. Please wait a minute and try again.')).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toHaveValue('Sam');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('says to try again, not the raw error, when the call fails for another reason', async () => {
    send.mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' }));
    const user = userEvent.setup();
    await openQuickForm(user);
    await fillQuickForm(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/We could not send your details/)).toBeInTheDocument());
    expect(screen.queryByText('internal')).toBeNull();
  });

  it('goes back to the choice', async () => {
    const user = userEvent.setup();
    await openQuickForm(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /Full application/ })).toBeInTheDocument();
  });
});
