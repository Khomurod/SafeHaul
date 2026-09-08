/**
 * A carrier link that would not open: what the driver is told, what they can do
 * about it, and where it sits relative to everything else.
 *
 * The precedence is the point. Before 2026-09-08 an unopenable, expired,
 * rate-limited or temporarily unavailable link resolved to `null`, was
 * indistinguishable from having followed no link at all, and dropped the driver
 * into the ordinary application — possibly pre-filled from a different
 * applicant's saved draft — with nothing said. Two positions in the chain are
 * therefore load-bearing, and both are asserted here: below a submitted
 * application (a dead link must not take away a confirmation number, which is
 * the one thing an applicant cannot get back) and above the intake chooser
 * (continuing is a choice, never a fallback).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolveApplyStatusScreen } from './PublicApplyScreens';
import { buildApplyLinkOutcomeMessage } from './publicApplyHelpers';

vi.mock('@features/sandbox/SandboxActionPanel', () => ({
  SandboxActionPanel: () => <div data-testid="sandbox-panel" />,
}));
vi.mock('./IntakeChooser', () => ({
  IntakeChooser: () => <div data-testid="intake-chooser" />,
}));

const base = (overrides = {}) => ({
  loading: false,
  error: '',
  isParsingCdl: false,
  sandbox: false,
  sandboxSubmission: null,
  submissionStatus: null,
  postApplicationTemplates: [],
  submittedApplicationId: 'app-1',
  postSubmitDocs: {},
  openingTemplateId: '',
  handleOpenPostApplicationTemplate: vi.fn(),
  submittedConfirmationNumber: 'CONF-123',
  onGoHome: vi.fn(),
  onStartNewApplication: vi.fn(),
  inviteProblem: null,
  inviteProblemDismissed: false,
  onContinueWithoutInvite: vi.fn(),
  intakeMode: 'manual',
  companyName: 'Blue Line Freight',
  handleChooseAutoFill: vi.fn(),
  handleChooseManual: vi.fn(),
  cdlAutoFillInputRef: { current: null },
  handleCdlAutoFileChange: vi.fn(),
  handleCdlAutoFillFileChange: vi.fn(),
  ...overrides,
});

const DEAD = { message: 'This application link cannot be opened.', retryable: false };
const FLAKY = { message: 'We hit a network problem.', retryable: true };

describe('what a driver is told about a link that would not open', () => {
  it.each([
    ['a wrong or expired link', 'unopenable', false],
    ['a malformed one', 'invalid', false],
    ['too many attempts', 'throttled', true],
    ['a carrier not accepting', 'closed', true],
    ['a temporary outage', 'unavailable', true],
  ])('explains %s and says whether retrying is worth it', (_label, status, retryable) => {
    const built = buildApplyLinkOutcomeMessage({ status });

    expect(built.message).toBeTruthy();
    expect(built.retryable).toBe(retryable);
    // Nothing about whether an application exists, whose it is, or who prepared
    // it — the server answers every refusal identically on purpose, and saying
    // more here would give that away.
    expect(built.message).not.toMatch(/exists|already|another|prepared by/i);
  });

  it('answers a wrong link and an expired one identically', () => {
    // Both are `not-found` server-side, deliberately. Splitting them here would
    // hand a probe the fact the server withholds.
    const wrong = buildApplyLinkOutcomeMessage({ status: 'unopenable' });
    const expired = buildApplyLinkOutcomeMessage({ status: 'unopenable' });

    expect(wrong.message).toBe(expired.message);
  });

  it.each(['absent', 'opened', 'requires_identity', 'pending'])('says nothing for %s', (status) => {
    // `requires_identity` is not a failure: the driver is asked for their details
    // by the ordinary resume flow underneath.
    expect(buildApplyLinkOutcomeMessage({ status })).toBeNull();
  });
});

describe('where the link problem sits in the chain', () => {
  it('offers retry and continue, and leads with retry when retrying can work', () => {
    render(resolveApplyStatusScreen(base({ inviteProblem: FLAKY, intakeMode: null })));

    expect(screen.getByRole('heading', { level: 1, name: 'This link could not be opened' })).toBeInTheDocument();
    expect(screen.getByText(FLAKY.message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to the application' })).toBeInTheDocument();
  });

  it('offers only continue when retrying never will', () => {
    render(resolveApplyStatusScreen(base({ inviteProblem: DEAD, intakeMode: null })));

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to the application' })).toBeInTheDocument();
  });

  it('leaves a submitted application its confirmation, even for a dead link', () => {
    // The position that matters most: a driver who re-clicks their own emailed
    // link after submitting keeps the success screen and its remaining tasks.
    render(resolveApplyStatusScreen(base({
      submissionStatus: 'success', inviteProblem: DEAD,
    })));

    expect(screen.getByText('CONF-123')).toBeInTheDocument();
    expect(screen.queryByText('This link could not be opened')).not.toBeInTheDocument();
  });

  it('outranks the intake chooser, so a fresh start is never a fallback', () => {
    render(resolveApplyStatusScreen(base({ inviteProblem: DEAD, intakeMode: null })));

    expect(screen.queryByTestId('intake-chooser')).not.toBeInTheDocument();
  });

  it('steps aside once the driver has chosen to continue', () => {
    const rendered = resolveApplyStatusScreen(base({
      inviteProblem: DEAD, inviteProblemDismissed: true, intakeMode: null,
    }));
    render(rendered);

    expect(screen.getByTestId('intake-chooser')).toBeInTheDocument();
  });

  it('hands the wizard back when nothing needs saying', () => {
    expect(resolveApplyStatusScreen(base())).toBeNull();
  });
});
