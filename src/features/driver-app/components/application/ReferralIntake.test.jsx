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
import {
  adoptLinkCodes, findQuickInterestGaps, holdsLinkCodes, linkCodesFrom, prefillFromQuickInterest,
  recruiterCodeFrom, referralCodeFrom, referralConsentText,
} from './referralIntake';

const { callable, send, prefill } = vi.hoisted(() => {
  const sendFn = vi.fn();
  return { send: sendFn, callable: vi.fn(() => sendFn), prefill: vi.fn() };
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
  onQuickInterestPrefill: prefill,
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
  prefill.mockReset();
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
    adoptLinkCodes(new URLSearchParams('ref=ZXCV6789'), setFormData);
    expect(setFormData.mock.calls[0][0]({ firstName: 'Sam', referralCode: 'ABCD2345', recruiterCode: 'link-1' }))
      .toEqual({ firstName: 'Sam', referralCode: 'ZXCV6789', recruiterCode: 'link-1' });

    const untouched = vi.fn();
    adoptLinkCodes(new URLSearchParams(''), untouched);
    expect(untouched).not.toHaveBeenCalled();
  });

  it('shows the consent the server records, word for word', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../../../../functions/referrals/submitReferralInterest.js'), 'utf8');
    const [first, second] = referralConsentText('${companyName}').split('. M');
    expect(server).toContain(`\`${first}. \``);
    expect(server).toContain(`'M${second}'`);
  });
});

/**
 * A recruiter's own link, `?r=<code>` (or `?recruiter=<uid>` from older links):
 * the code travels in the answers as `recruiterCode`, as a referral code does, so
 * it stays with a draft the driver continues in another session or on another
 * device. The server decides whom it names (`functions/shared/recruiterAssignment.js`).
 */
describe('the recruiter code in the link', () => {
  it('takes `r`, else `recruiter`, in the shape the server accepts, and nothing else', () => {
    expect(recruiterCodeFrom(new URLSearchParams('r=Ab3_x-9'))).toBe('Ab3_x-9');
    expect(recruiterCodeFrom(new URLSearchParams('recruiter=uid-42'))).toBe('uid-42');
    expect(recruiterCodeFrom(new URLSearchParams('r=link-1&recruiter=uid-42'))).toBe('link-1');
    expect(recruiterCodeFrom(new URLSearchParams('r=%20link-1%20'))).toBe('link-1');
    expect(recruiterCodeFrom(new URLSearchParams('r=two%20words'))).toBeNull();
    expect(recruiterCodeFrom(new URLSearchParams(`r=${'x'.repeat(129)}`))).toBeNull();
    expect(recruiterCodeFrom(new URLSearchParams('ref=ABCD2345'))).toBeNull();
    expect(recruiterCodeFrom(new URLSearchParams(''))).toBeNull();
  });

  it('names both codes a link carries, and only those', () => {
    expect(linkCodesFrom(new URLSearchParams('ref=abcd2345&r=link-1')))
      .toEqual({ referralCode: 'ABCD2345', recruiterCode: 'link-1' });
    expect(linkCodesFrom(new URLSearchParams('recruiter=uid-42'))).toEqual({ recruiterCode: 'uid-42' });
    expect(linkCodesFrom(new URLSearchParams('invite=t&k=key'))).toEqual({});
  });

  it('goes into the answers over whatever a restored draft carried, and leaves the other code alone', () => {
    const setFormData = vi.fn();
    adoptLinkCodes(new URLSearchParams('r=link-2'), setFormData);
    expect(setFormData.mock.calls[0][0]({ firstName: 'Sam', referralCode: 'ABCD2345', recruiterCode: 'link-1' }))
      .toEqual({ firstName: 'Sam', referralCode: 'ABCD2345', recruiterCode: 'link-2' });
  });

  it('says whether answers already hold every code a link carries', () => {
    expect(holdsLinkCodes({ recruiterCode: 'link-1', referralCode: 'ABCD2345' }, { recruiterCode: 'link-1' })).toBe(true);
    expect(holdsLinkCodes({ recruiterCode: 'link-1' }, { recruiterCode: 'link-2' })).toBe(false);
    expect(holdsLinkCodes({}, {})).toBe(true);
    expect(holdsLinkCodes(undefined, { referralCode: 'ABCD2345' })).toBe(false);
  });
});

describe('what the quick form fills in on page one', () => {
  const sent = {
    firstName: ' Sam ', lastName: 'Rivera', phone: '(312) 555-0142', email: 'sam.rivera@example.com',
  };

  it('fills the four answers, trimmed, and keeps everything else the application holds', () => {
    expect(prefillFromQuickInterest({ referralCode: 'ABCD2345' }, sent)).toEqual({
      referralCode: 'ABCD2345',
      firstName: 'Sam',
      lastName: 'Rivera',
      phone: '(312) 555-0142',
      email: 'sam.rivera@example.com',
    });
  });

  it('takes nothing but those four, so the consent to be contacted never becomes an answer', () => {
    const next = prefillFromQuickInterest({}, { ...sent, contactConsent: true, 'sms-consent': 'yes', middleName: 'J' });
    expect(Object.keys(next).sort()).toEqual(['email', 'firstName', 'lastName', 'phone']);
  });

  it('never replaces an answer already there, so a stored draft wins', () => {
    const stored = { firstName: 'Samuel', lastName: '  ', email: 'samuel@example.com' };
    expect(prefillFromQuickInterest(stored, sent)).toEqual({
      firstName: 'Samuel',
      lastName: 'Rivera',
      email: 'samuel@example.com',
      phone: '(312) 555-0142',
    });
  });

  it('returns the same answers when there is nothing to fill', () => {
    const full = { firstName: 'A', lastName: 'B', phone: '1', email: 'c' };
    expect(prefillFromQuickInterest(full, sent)).toBe(full);
    const empty = { firstName: 'A' };
    expect(prefillFromQuickInterest(empty, {})).toBe(empty);
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

  it('refuses the addresses the server refuses, before sending', () => {
    const answers = {
      firstName: 'Sam', lastName: 'Rivera', phone: '(312) 555-0142', contactConsent: true,
    };
    for (const email of ['a@aol..com', 'a@x,y.com', 'sam@example']) {
      expect(findQuickInterestGaps({ ...answers, email }).email).toBe('Please enter a valid email address.');
    }
    expect(findQuickInterestGaps({ ...answers, email: 'sam.rivera@example.com' })).toEqual({});
    expect(findQuickInterestGaps({ ...answers, email: '  ' }).email).toBe('Email is required.');
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
    await waitFor(() => expect(thanks).toHaveFocus());
    expect(screen.getByText('A recruiter from Blue Line Freight will contact you soon.')).toBeInTheDocument();

    expect(prefill).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Fill out the full application' }));
    expect(screen.getByTestId('intake-chooser')).toBeInTheDocument();
    // The four answers as sent, for page one; the consent is not among them.
    expect(prefill).toHaveBeenCalledTimes(1);
    expect(prefill).toHaveBeenCalledWith({
      firstName: 'Sam',
      lastName: 'Rivera',
      phone: '(312) 555-0142',
      email: 'sam.rivera@example.com',
    });
  });

  it('fills nothing in when the form was left without sending', async () => {
    const user = userEvent.setup();
    await openQuickForm(user);
    await fillQuickForm(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: /Full application/ }));

    expect(screen.getByTestId('intake-chooser')).toBeInTheDocument();
    expect(prefill).not.toHaveBeenCalled();
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
