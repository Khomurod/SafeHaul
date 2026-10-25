// VOE preview contract, part 1 of 3: the generated document's content —
// missing data, legal text and ordering, field values and fallbacks, SSN
// masking, signature rules and the audit identifier.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `VOEPreviewModal.contract.support.jsx`; the registrations below delegate to
// it. See that file's header for the scope of this contract freeze.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';

vi.mock('@/context/DataContext', async () => (await import('./VOEPreviewModal.contract.support')).dataContextMock());
vi.mock('@shared/utils/sanitizeUserContent', async (importOriginal) => (await import('./VOEPreviewModal.contract.support')).sanitizeUserContentMock(importOriginal));
vi.mock('html2canvas', async () => (await import('./VOEPreviewModal.contract.support')).html2canvasMock());
vi.mock('jspdf', async () => (await import('./VOEPreviewModal.contract.support')).jspdfMock());

import { VOEPreviewModal } from './VOEPreviewModal';
import { RELEASE_NOTES, RELEASE_PARAGRAPHS, RELEASE_RIGHTS } from '@shared/legal/previousEmployerRelease';
import {
    makeRenderModal,
    resetHarness,
    documentNode,
    dataMock,
    EMPLOYER,
    APPLICANT,
} from './VOEPreviewModal.contract.support';

const renderModal = makeRenderModal(VOEPreviewModal);
// The "Date of Authorization" box: its label and the date under it.
const authorizationDate = () => within(documentNode()).getByText('Date of Authorization').parentElement;

beforeEach(resetHarness);

afterEach(cleanup);

describe('VOEPreviewModal missing data', () => {
  it('renders no document without an employer', () => {
    renderModal({ employer: null });
    expect(screen.queryByTestId('voe-document')).toBeNull();
  });

  it('renders no document without an applicant', () => {
    renderModal({ applicant: null });
    expect(screen.queryByTestId('voe-document')).toBeNull();
  });
});

describe('VOEPreviewModal legal text and ordering', () => {
  it('keeps the regulatory preamble verbatim', () => {
    renderModal();
    expect(documentNode()).toHaveTextContent(
      /This request is made pursuant to the Federal Motor Carrier Safety Regulations \(FMCSR\) 49 CFR Part 391\.23\.\s+This regulation requires prospective employers to investigate a driver's background through the driver's previous employers\./,
    );
  });

  it('prints, above the signature, the release the applicant signed with the application and nothing else', () => {
    renderModal();
    const doc = documentNode();
    for (const wording of [...RELEASE_PARAGRAPHS, ...RELEASE_RIGHTS]) {
      expect(doc).toHaveTextContent(wording);
    }
    // The wording the applicant was never shown is gone.
    expect(doc).not.toHaveTextContent(/specific written consent/);
    expect(doc).not.toHaveTextContent(/§40\.321/);
  });

  it.each([
    ['predates-wording', { 'signature-date': undefined, signatureDate: '2025-12-01T00:00:00.000Z' }],
    ['undated', { 'signature-date': undefined, submittedAt: undefined, createdAt: undefined }],
    // A stored value that is neither a drawn image nor a typed name.
    ['unsigned', { signature: 'https://files.example.test/signature.png' }],
  ])('reproduces no signature for an application that is %s', (status, change) => {
    renderModal({ applicant: { ...APPLICANT, ...change } });
    const doc = documentNode();
    expect(within(doc).getByTestId('voe-release-note')).toHaveTextContent(RELEASE_NOTES[status]);
    expect(doc).not.toHaveTextContent(RELEASE_PARAGRAPHS[0]);
    expect(within(doc).queryByAltText('Signature')).toBeNull();
    expect(doc).toHaveTextContent('No signature reproduced');
    // Nothing was signed under this release, so nothing says it was.
    expect(doc).not.toHaveTextContent('Signed electronically with the application');
  });

  it('dates the authorization by the signer\'s own calendar day, not the UTC day', () => {
    renderModal({ applicant: { ...APPLICANT, 'signature-date': undefined, signatureDate: '2026-08-04T03:00:00.000Z', signatureDay: '2026-08-03' } });
    expect(authorizationDate()).toHaveTextContent('08/03/2026');
  });

  it('dates the authorization from the submission when that is all that dates the signature', () => {
    renderModal({ applicant: { ...APPLICANT, 'signature-date': undefined, signatureDate: undefined, submittedAt: '2026-08-03T15:00:00.000Z' } });
    const doc = documentNode();
    expect(doc).toHaveTextContent('Signed electronically with the application');
    expect(authorizationDate()).toHaveTextContent('08/03/2026');
  });

  it('says the signature is missing, under the unsigned note, when there is none at all', () => {
    renderModal({ applicant: { ...APPLICANT, signature: undefined } });
    const doc = documentNode();
    expect(within(doc).getByTestId('voe-release-note')).toHaveTextContent(RELEASE_NOTES.unsigned);
    expect(doc).toHaveTextContent('DRIVER SIGNATURE MISSING');
    expect(doc).not.toHaveTextContent('Signed electronically with the application');
  });

  it('dates no authorization for an unsigned application, whatever else dates it', () => {
    renderModal({ applicant: { ...APPLICANT, signature: undefined, submittedAt: '2026-08-03T15:00:00.000Z' } });
    expect(authorizationDate()).toHaveTextContent('Not signed');
  });

  it('never prints an unreadable legacy signature-date', () => {
    renderModal({ applicant: { ...APPLICANT, signatureDate: undefined, 'signature-date': 'not-a-date', submittedAt: '2026-08-03T15:00:00.000Z' } });
    expect(authorizationDate()).toHaveTextContent('08/03/2026');
    expect(documentNode()).not.toHaveTextContent('not-a-date');
  });

  it('keeps the document section order', () => {
    renderModal();
    const text = documentNode().textContent;
    const order = [
      'SAFEHAUL',
      'Compliance & Verification Services',
      'VOE-391.23',
      'Request for Verification of Employment',
      'To (Previous Employer)',
      'From (Prospective Employer)',
      'Subject Applicant Information',
      "Applicant's Release (Signed With the Application)",
      'Digital Signature of Applicant',
      'Date of Authorization',
      'Employment History Questionnaire (To be completed by Recipient)',
      'Safety Performance (Accidents)',
      'Drug & Alcohol Compliance (Part 40)',
      'Protected by SafeHaul Encryption Services',
    ];
    let cursor = -1;
    for (const fragment of order) {
      const at = text.indexOf(fragment);
      expect(at, `"${fragment}" missing from the generated document`).toBeGreaterThan(-1);
      expect(at, `"${fragment}" is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('keeps the three Part 40 questions in their exact wording and order', () => {
    renderModal();
    const text = documentNode().textContent;
    const questions = [
      'Did the driver refuse to take a required drug or alcohol test?',
      'Did the driver have any other drug/alcohol regulation violations?',
      'Did the driver test positive for a controlled substance?',
    ];
    let cursor = text.indexOf('Drug & Alcohol Compliance (Part 40)');
    for (const q of questions) {
      const at = text.indexOf(q);
      expect(at, `"${q}" missing`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('keeps the basic verification questions', () => {
    renderModal();
    const text = documentNode().textContent;
    [
      'Did this person work for you?',
      'Dates of employment correct?',
      'Type of equipment operated:',
      'Eligible for re-hire?',
      'Did the driver have any DOT-recordable accidents?',
    ].forEach((q) => expect(text).toContain(q));
  });
});

describe('VOEPreviewModal field values and fallbacks', () => {
  it('shows the employer, applicant and service dates', () => {
    renderModal();
    const doc = documentNode();
    expect(doc).toHaveTextContent('Acme Freight');
    expect(doc).toHaveTextContent('Austin, TX');
    expect(doc).toHaveTextContent('hr@acme.test');
    expect(doc).toHaveTextContent('512-555-0100');
    expect(doc).toHaveTextContent('Maria Garcia');
    expect(doc).toHaveTextContent('2020-01 to 2022-06');
  });

  it('falls back from employer companyName to name', () => {
    renderModal({ employer: { ...EMPLOYER, companyName: undefined, name: 'Legacy Hauling' } });
    expect(documentNode()).toHaveTextContent('Legacy Hauling');
  });

  it('uses the getFieldValue "Not Specified" fallback for absent values', () => {
    renderModal({ employer: { companyName: 'Acme Freight' } });
    expect(documentNode()).toHaveTextContent('Not Specified');
  });

  it('omits employer email and phone lines when absent', () => {
    renderModal({ employer: { ...EMPLOYER, email: undefined, phone: undefined } });
    const doc = documentNode();
    expect(doc).not.toHaveTextContent('hr@acme.test');
    expect(doc).not.toHaveTextContent('512-555-0100');
  });

  it('names the prospective employer from the company profile', () => {
    renderModal();
    expect(documentNode()).toHaveTextContent('Northwind Carriers');
  });

  it('falls back through companyName to the [PROSPECTIVE COMPANY] placeholder', () => {
    dataMock.value = { currentCompanyProfile: { companyName: 'Fallback Freight' } };
    renderModal();
    expect(documentNode()).toHaveTextContent('Fallback Freight');
    cleanup();

    dataMock.value = { currentCompanyProfile: null };
    renderModal();
    expect(documentNode()).toHaveTextContent('[PROSPECTIVE COMPANY]');
  });

  it('keeps the date-of-birth NOT DISCLOSED fallback', () => {
    renderModal({ applicant: { ...APPLICANT, dob: undefined } });
    expect(documentNode()).toHaveTextContent('NOT DISCLOSED');
  });

  it('shows the IP only when one was recorded, never a made-up "Verified"', () => {
    renderModal();
    expect(documentNode()).toHaveTextContent(/IP:\s*203\.0\.113\.7/);
    cleanup();

    renderModal({ applicant: { ...APPLICANT, ipAddress: undefined } });
    const attestation = within(documentNode()).getByText(/Signed electronically with the application/);
    expect(attestation.textContent).toBe('Signed electronically with the application');
    expect(documentNode()).not.toHaveTextContent(/IP:\s*Verified/);
  });
});

describe('VOEPreviewModal SSN masking', () => {
  it('shows only the last four digits', () => {
    renderModal();
    const doc = documentNode();
    expect(doc).toHaveTextContent('***-**-6789');
    expect(doc).not.toHaveTextContent('123-45-6789');
  });

  it('redacts entirely when there is no SSN on file', () => {
    renderModal({ applicant: { ...APPLICANT, ssn: undefined } });
    expect(documentNode()).toHaveTextContent('REDACTED (ON FILE)');
  });
});

describe('VOEPreviewModal signature rules', () => {
  it('renders an image signature from a non-TEXT_SIGNATURE value', () => {
    renderModal();
    expect(within(documentNode()).getByAltText('Signature'))
      .toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });

  it('renders a typed signature with the /s/ prefix and no image', () => {
    renderModal({ applicant: { ...APPLICANT, signature: 'TEXT_SIGNATURE:Maria Garcia' } });
    const doc = documentNode();
    expect(doc).toHaveTextContent('/s/ Maria Garcia');
    expect(within(doc).queryByAltText('Signature')).toBeNull();
  });

  it('shows the missing-signature notice when there is no signature', () => {
    renderModal({ applicant: { ...APPLICANT, signature: undefined } });
    const doc = documentNode();
    expect(doc).toHaveTextContent('DRIVER SIGNATURE MISSING');
    expect(doc).toHaveTextContent('Application must be signed before transmission');
  });

  it('dates the authorization from the signature, never from today', () => {
    // An older application, from the form builder's `signature-date`.
    renderModal();
    expect(authorizationDate()).toHaveTextContent('07/01/2026');
    cleanup();

    // The wizard's own stamp, an ISO time (`Step9_Consent.jsx`).
    renderModal({ applicant: { ...APPLICANT, 'signature-date': undefined, signatureDate: '2026-07-01T12:00:00.000Z' } });
    expect(authorizationDate()).toHaveTextContent('07/01/2026');
    cleanup();

    renderModal({ applicant: { ...APPLICANT, 'signature-date': undefined } });
    expect(authorizationDate()).toHaveTextContent('Not signed');
    expect(authorizationDate()).not.toHaveTextContent(new Date().toLocaleDateString('en-US'));
  });

  it('prints the same authorization date whoever prints it, wherever they are', () => {
    // 00:30 UTC on 1 July is still 30 June in every US time zone.
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      renderModal({ applicant: { ...APPLICANT, 'signature-date': undefined, signatureDate: '2026-07-01T00:30:00.000Z' } });
      expect(authorizationDate()).toHaveTextContent('07/01/2026');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('keeps the 30-day validity note', () => {
    renderModal();
    expect(documentNode()).toHaveTextContent('Valid for 30 Days');
  });
});

describe('VOEPreviewModal audit identifier', () => {
  const auditIdFrom = (doc) => doc.textContent.match(/Secure Audit ID:\s*([A-Z0-9-]+)/)[1];

  it('derives a stable id from the applicant id', () => {
    const { rerender } = renderModal();
    const first = auditIdFrom(documentNode());

    rerender(
      <VOEPreviewModal employer={EMPLOYER} applicant={APPLICANT} onClose={vi.fn()} onSend={vi.fn()} />,
    );
    expect(auditIdFrom(documentNode())).toBe(first);
  });

  it('uses the exact derivation: last six of the base, upper-cased, plus a base-36 char-code sum', () => {
    renderModal();
    const base = 'app-abc123';
    const expected = base.slice(-6).toUpperCase() + '-'
      + Math.abs(base.split('').reduce((a, c) => a + c.charCodeAt(0), 0)).toString(36).toUpperCase().slice(0, 6);
    expect(auditIdFrom(documentNode())).toBe(expected);
  });

  it('falls back to uid when there is no id', () => {
    renderModal({ applicant: { ...APPLICANT, id: undefined, uid: 'uid-xyz789' } });
    const base = 'uid-xyz789';
    const expected = base.slice(-6).toUpperCase() + '-'
      + Math.abs(base.split('').reduce((a, c) => a + c.charCodeAt(0), 0)).toString(36).toUpperCase().slice(0, 6);
    expect(auditIdFrom(documentNode())).toBe(expected);
  });
});

