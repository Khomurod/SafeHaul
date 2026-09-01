/**
 * Contract freeze for the VOE preview and its export pipeline.
 *
 * Written BEFORE the design-system migration. `VOEPreviewModal` had **no test
 * coverage at all** while owning a generated legal document, an html2canvas →
 * jsPDF export, a print-window pipeline, SSN masking, signature rules and an
 * audit identifier. Everything asserted here is asserted by value, so the
 * migration is provably behaviour-preserving.
 *
 * The generated document is treated as immutable document content, not
 * themeable app chrome: `VOEPreviewModal.export.test.jsx` pins that separately.
 *
 * =====================================================================
 * Shared harness for the VOEPreviewModal contract suites.
 *
 * `vi.mock` is hoisted per file, so each suite keeps its own registrations,
 * whose factories delegate to the `*Mock()` functions below; the module
 * registry hands every caller this same instance, so the spies a suite
 * imports are the ones the modal talks to. This module must not import the
 * modal OR any module the suites mock (`DataContext`, `sanitizeUserContent`,
 * `html2canvas`, `jspdf`) — either would fire a mock factory that is itself
 * awaiting this module, which deadlocks vitest silently (learned on `CA-3`).
 * Each suite imports the modal itself and passes it to `makeRenderModal`.
 * =====================================================================
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

export const dataMock = { value: { currentCompanyProfile: { name: 'Northwind Carriers' } } };
export const h2cMock = { fn: vi.fn() };
export const pdfMock = {
  ctor: vi.fn(),
  addImage: vi.fn(),
  save: vi.fn(),
};

export const sanitizeSpy = { fn: vi.fn() };

// --- vi.mock factory bodies, verbatim from the original registrations ------

export const dataContextMock = () => ({ useData: () => dataMock.value });
export const sanitizeUserContentMock = async (importOriginal) => {
  const actual = await importOriginal();
  sanitizeSpy.fn = vi.fn(actual.sanitizeUserContent);
  return { ...actual, sanitizeUserContent: (...args) => sanitizeSpy.fn(...args) };
};
export const html2canvasMock = () => ({ default: (...args) => h2cMock.fn(...args) });
export const jspdfMock = () => ({
  jsPDF: class {
    constructor(opts) {
      pdfMock.ctor(opts);
      this.addImage = pdfMock.addImage;
      this.save = pdfMock.save;
    }
  },
});

// --- fixtures and helpers, verbatim ----------------------------------------

export const EMPLOYER = {
  companyName: 'Acme Freight',
  city: 'Austin',
  state: 'TX',
  startDate: '2020-01',
  endDate: '2022-06',
  email: 'hr@acme.test',
  phone: '512-555-0100',
};

export const APPLICANT = {
  id: 'app-abc123',
  firstName: 'Maria',
  lastName: 'Garcia',
  ssn: '123-45-6789',
  dob: '1990-04-02',
  signature: 'data:image/png;base64,AAAA',
  'signature-date': '07/01/2026',
  ipAddress: '203.0.113.7',
};

/**
 * The original `renderModal`, verbatim, except the modal arrives as an
 * argument: each suite imports it after its own hoisted mocks.
 */
export const makeRenderModal = (VOEPreviewModal) => (props = {}) => {
  const onClose = props.onClose || vi.fn();
  const onSend = props.onSend || vi.fn();
  const utils = render(
    <VOEPreviewModal
      employer={props.employer === undefined ? EMPLOYER : props.employer}
      applicant={props.applicant === undefined ? APPLICANT : props.applicant}
      onClose={onClose}
      onSend={onSend}
    />,
  );
  return { ...utils, onClose, onSend };
};


/** The generated document node — the thing that gets printed and exported. */
export const documentNode = () => screen.getByTestId('voe-document');

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
  vi.clearAllMocks();
  dataMock.value = { currentCompanyProfile: { name: 'Northwind Carriers' } };
}
