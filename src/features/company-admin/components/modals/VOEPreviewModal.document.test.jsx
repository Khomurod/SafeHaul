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
import {
    makeRenderModal,
    resetHarness,
    documentNode,
    dataMock,
    EMPLOYER,
    APPLICANT,
} from './VOEPreviewModal.contract.support';

const renderModal = makeRenderModal(VOEPreviewModal);

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

  it('keeps the release and authorization paragraph verbatim, including both citations', () => {
    renderModal();
    const doc = documentNode();
    expect(doc).toHaveTextContent(
      /I, the undersigned applicant, hereby provide specific written consent and authorize the release of all information requested by SafeHaul HR Verification Services on behalf of the prospective employer\./,
    );
    expect(doc).toHaveTextContent(/49 CFR §391\.23/);
    expect(doc).toHaveTextContent(/§40\.321/);
    expect(doc).toHaveTextContent(
      /I release all previous employers and their agents from any and all liability which may result from furnishing such information in good faith\./,
    );
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
      'Legal Release & Authorization',
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

  it('keeps the IP attestation and its Verified fallback', () => {
    renderModal();
    expect(documentNode()).toHaveTextContent('203.0.113.7');
    cleanup();

    renderModal({ applicant: { ...APPLICANT, ipAddress: undefined } });
    expect(documentNode()).toHaveTextContent(/IP:\s*Verified/);
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

  it('keeps the authorization date and its today fallback', () => {
    renderModal();
    expect(documentNode()).toHaveTextContent('07/01/2026');
    cleanup();

    renderModal({ applicant: { ...APPLICANT, 'signature-date': undefined } });
    expect(documentNode()).toHaveTextContent(new Date().toLocaleDateString());
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

