/**
 * Contract for the public application container — the referral quick form starts
 * the full application. What the driver sent fills page one's empty name, phone
 * and email, in the browser, and nothing else carries over: not the consent to be
 * contacted, and never over an answer a stored draft already holds.
 * One of the container's contract suites; the shared harness lives in
 * PublicApplyHandler.contract.support.jsx.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Every registration delegates to the shared support module, so the harness
// lives once; `vi.mock` is hoisted per file, which is why each suite repeats
// this block (see the support header, and the `CA-3` deadlock rule it cites).
vi.mock('@/context/DataContext', async () => (await import('./PublicApplyHandler.contract.support')).dataContextMock());
vi.mock('@shared/components/feedback/ToastProvider', async () => (await import('./PublicApplyHandler.contract.support')).toastProviderMock());
vi.mock('@shared/components/feedback', async () => (await import('./PublicApplyHandler.contract.support')).feedbackMock());
vi.mock('@lib/firebase', async () => (await import('./PublicApplyHandler.contract.support')).libFirebaseMock());
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/firestore', async () => (await import('./PublicApplyHandler.contract.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./PublicApplyHandler.contract.support')).firebaseFunctionsMock());
vi.mock('@lib/runtime/e2eMode', async () => (await import('./PublicApplyHandler.contract.support')).e2eModeMock());
vi.mock('@lib/submissionQueue', async () => (await import('./PublicApplyHandler.contract.support')).submissionQueueMock());
vi.mock('@lib/applicationId', async () => (await import('./PublicApplyHandler.contract.support')).applicationIdMock());
vi.mock('../../services/publicProfileService', async () => (await import('./PublicApplyHandler.contract.support')).publicProfileServiceMock());
vi.mock('./postApplyDocsStorage', async (importOriginal) => (await import('./PublicApplyHandler.contract.support')).postApplyDocsStorageMock(await importOriginal()));
vi.mock('react-router-dom', async (importOriginal) => (await import('./PublicApplyHandler.contract.support')).reactRouterDomMock(await importOriginal()));
vi.mock('@shared/components/layout/Stepper', async () => (await import('./PublicApplyHandler.contract.support')).stepperMock());

import { PublicApplyHandler } from './PublicApplyHandler';
import {
  callableSpy,
  initQueueSpy,
  isQueueSupportedSpy,
  profileOverride,
  stubDraftCallables,
  makeRenderers,
} from './PublicApplyHandler.contract.support';

const { renderHandler, chooseManualIntake } = makeRenderers({ PublicApplyHandler, MemoryRouter, Route, Routes });

/** The quick form, sent, then the full application by hand. */
async function sendQuickFormThenApply() {
  fireEvent.click(await screen.findByRole('button', { name: /Quick interest/ }));
  fireEvent.change(screen.getByLabelText(/First name/), { target: { value: ' Sam ' } });
  fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'Rivera' } });
  fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: '(312) 555-0142' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'sam.rivera@example.com' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Fill out the full application' }));
  await chooseManualIntake();
}

/** Page one as the wizard holds it: written to the local copy by "Finish later". */
async function pageOneAnswers() {
  fireEvent.click(screen.getByText('probe-save-draft'));
  let stored;
  await waitFor(() => {
    stored = JSON.parse(localStorage.getItem('draft_acme'));
    expect(stored?.data).toBeTruthy();
  });
  return stored.data;
}

describe('the referral quick form starts the full application', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileOverride.current = null;
    localStorage.clear();
    sessionStorage.clear();
    isQueueSupportedSpy.mockReturnValue(true);
    initQueueSpy.mockResolvedValue(undefined);
    callableSpy.mockResolvedValue({ data: { ok: true } });
    stubDraftCallables();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('fills the name, phone and email the driver sent, and nothing else', async () => {
    renderHandler('?ref=ABCD2345');
    await sendQuickFormThenApply();

    expect(callableSpy).toHaveBeenCalledWith(expect.objectContaining({ contactConsent: true, referralCode: 'ABCD2345' }));
    const answers = await pageOneAnswers();
    expect(answers).toMatchObject({
      firstName: 'Sam',
      lastName: 'Rivera',
      phone: '(312) 555-0142',
      email: 'sam.rivera@example.com',
      // The code still travels in the answers, as it always has.
      referralCode: 'ABCD2345',
    });
    // The consent to be contacted is not any answer inside the application.
    expect(answers).not.toHaveProperty('contactConsent');
    expect(answers).not.toHaveProperty('sms-consent');
    expect(Object.keys(answers).sort()).toEqual(['email', 'firstName', 'lastName', 'phone', 'referralCode']);
  });

  it('keeps what a stored draft already holds and fills only what it lacks', async () => {
    // A draft from before steps were recorded: it does not skip the first screens.
    localStorage.setItem('draft_acme', JSON.stringify({
      firstName: 'Samuel', lastName: 'Rivera-Diaz', email: 'samuel@example.com',
    }));
    renderHandler('?ref=ABCD2345');
    await sendQuickFormThenApply();

    const answers = await pageOneAnswers();
    expect(answers).toMatchObject({
      firstName: 'Samuel',
      lastName: 'Rivera-Diaz',
      email: 'samuel@example.com',
      phone: '(312) 555-0142',
    });
  });

  it('fills nothing when the driver goes straight to the full application', async () => {
    renderHandler('?ref=ABCD2345');
    fireEvent.click(await screen.findByRole('button', { name: /Full application/ }));
    await chooseManualIntake();

    const answers = await pageOneAnswers();
    expect(answers).not.toHaveProperty('firstName');
    expect(answers).not.toHaveProperty('email');
    expect(answers.referralCode).toBe('ABCD2345');
  });
});
