/**
 * Export-parity guard for the generated VOE document.
 *
 * WHY THIS FILE EXISTS
 *
 * The VOE document is a legal artefact that leaves the application through two
 * paths, and **neither of them carries the SafeHaul stylesheet**:
 *
 *   1. `handleDownloadPDF` rasterises the node with html2canvas. Colours come
 *      from computed style at capture time.
 *   2. `handlePrint` writes the node's `innerHTML` into a bare `window.open`
 *      document whose only stylesheet is Tailwind from a CDN. That window has
 *      no `:root` custom properties at all, so a `--ds-*` colour would resolve
 *      to nothing and the printed form would lose its rules, borders and
 *      emphasis.
 *
 * So the document is treated as immutable document content, not themeable app
 * chrome. This file is the executable form of that decision: if someone later
 * "finishes the migration" by tokenising the document, these tests fail and
 * explain why. Tokenising it is only allowed once export parity is proven —
 * which means a real captured PDF and a real printed page, not a passing unit
 * test.
 *
 * The complement is asserted too: the surrounding chrome *must* be tokenised,
 * so this guard cannot be satisfied by simply not migrating anything.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/context/DataContext', () => ({
  useData: () => ({ currentCompanyProfile: { name: 'Northwind Carriers' } }),
}));
vi.mock('html2canvas', () => ({ default: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class { save() {} addImage() {} } }));

import { VOEPreviewModal } from './VOEPreviewModal';

const EMPLOYER = {
  companyName: 'Acme Freight',
  city: 'Austin',
  state: 'TX',
  startDate: '2020-01',
  endDate: '2022-06',
};

const APPLICANT = {
  id: 'app-abc123',
  firstName: 'Maria',
  lastName: 'Garcia',
  ssn: '123-45-6789',
  signature: 'data:image/png;base64,AAAA',
};

/**
 * A token-bearing class is any Tailwind utility bound to a `--ds-*` custom
 * property (`bg-ds-surface`, `text-ds-xs`, `gap-ds-4`, …) or a design-system
 * component class (`ds-button`, `ds-card`, …).
 */
const DS_CLASS = /(^|\s)(ds-[\w-]+|[a-z-]+-ds-[\w-]+)(\s|$)/;

const renderModal = (props = {}) => render(
  <VOEPreviewModal
    employer={EMPLOYER}
    applicant={APPLICANT}
    onClose={vi.fn()}
    onSend={vi.fn()}
    {...props}
  />,
);

const documentNode = () => screen.getByTestId('voe-document');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('VOE document export parity', () => {
  it('carries no design-system token class anywhere inside the exported document', () => {
    renderModal();
    const doc = documentNode();

    const offenders = [];
    const check = (el) => {
      const className = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
      if (DS_CLASS.test(className)) {
        offenders.push(`<${el.tagName.toLowerCase()} class="${className}">`);
      }
    };
    check(doc);
    doc.querySelectorAll('*').forEach(check);

    expect(
      offenders,
      'The exported VOE document must not depend on --ds-* custom properties: '
      + 'the print window and the html2canvas capture do not carry them. '
      + 'See the file header before changing this.',
    ).toEqual([]);
  });

  it('carries no inline style referencing a custom property', () => {
    renderModal();
    const doc = documentNode();

    const offenders = [];
    const check = (el) => {
      const style = el.getAttribute('style');
      if (style && style.includes('var(--')) offenders.push(style);
    };
    check(doc);
    doc.querySelectorAll('*').forEach(check);

    expect(offenders).toEqual([]);
  });

  it('pins the document root class list, which is the html2canvas capture surface', () => {
    renderModal();
    // Any change here changes the rasterised page geometry and background.
    expect(documentNode().getAttribute('class')).toBe(
      'bg-white border border-gray-300 shadow-xl p-12 max-w-3xl mx-auto min-h-[1000px] font-serif text-slate-900 leading-relaxed',
    );
  });

  it('keeps the document opaque, so a captured PNG is never transparent', () => {
    renderModal();
    expect(documentNode().getAttribute('class')).toMatch(/(^|\s)bg-white(\s|$)/);
  });

  it('keeps the signature image inside the exported node', () => {
    renderModal();
    // html2canvas captures `documentRef`; a signature rendered outside it would
    // silently vanish from every PDF.
    expect(documentNode().querySelector('img[alt="Signature"]')).not.toBeNull();
  });

  it('keeps the audit id inside the exported node', () => {
    renderModal();
    expect(documentNode().textContent).toMatch(/Secure Audit ID:\s*[A-Z0-9-]+/);
  });
});

describe('VOE chrome is migrated', () => {
  // The mirror of the guard above: the document stays untokenised precisely so
  // the chrome can be migrated. If the chrome were left alone too, the first
  // test in this file would pass for the wrong reason.
  it('uses design-system classes outside the document', () => {
    const { container } = renderModal();
    const doc = documentNode();

    const chromeWithTokens = [...container.querySelectorAll('*')].filter((el) => {
      if (doc === el || doc.contains(el)) return false;
      const className = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
      return DS_CLASS.test(className);
    });

    expect(chromeWithTokens.length).toBeGreaterThan(0);
  });

  it('renders the chrome actions as approved Button primitives', () => {
    renderModal();
    ['Print', 'Download PDF', 'Edit Request', 'Transmit Request Now'].forEach((name) => {
      const button = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect(button.className, `${name} should be an approved Button`).toMatch(/(^|\s)ds-button(\s|$)/);
    });
  });

  it('keeps the dialog shell itself out of the exported document', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    // The capture surface must be the document alone — never the dialog chrome.
    expect(dialog.contains(documentNode())).toBe(true);
    expect(documentNode().querySelector('[role="dialog"]')).toBeNull();
    expect(documentNode().querySelector('button')).toBeNull();
  });
});
