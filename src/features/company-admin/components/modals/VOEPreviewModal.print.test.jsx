// VOE preview contract, part 3 of 3: the print-window pipeline and its
// escaping rules.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `VOEPreviewModal.contract.support.jsx`; the registrations below delegate to
// it. See that file's header for the scope of this contract freeze.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

vi.mock('@/context/DataContext', async () => (await import('./VOEPreviewModal.contract.support')).dataContextMock());
vi.mock('@shared/utils/sanitizeUserContent', async (importOriginal) => (await import('./VOEPreviewModal.contract.support')).sanitizeUserContentMock(importOriginal));
vi.mock('html2canvas', async () => (await import('./VOEPreviewModal.contract.support')).html2canvasMock());
vi.mock('jspdf', async () => (await import('./VOEPreviewModal.contract.support')).jspdfMock());

import { VOEPreviewModal } from './VOEPreviewModal';
import {
    makeRenderModal,
    resetHarness,
    documentNode,
    sanitizeSpy,
    EMPLOYER,
    APPLICANT,
} from './VOEPreviewModal.contract.support';

const renderModal = makeRenderModal(VOEPreviewModal);

beforeEach(resetHarness);

afterEach(cleanup);

/**
 * The print pipeline was **rebuilt** on 2026-07-27. The previous version of this
 * block froze the broken behaviour: five `document.write` payloads, a
 * `sanitizeUserContent` step and a 1 s timer. That pipeline emitted an unsigned,
 * unstyled text dump, because `sanitizeUserContent` is the *user-content* policy
 * — no `div`, no `class`, no `img` — and the document is trusted structure. See
 * `@shared/utils/printDocument`.
 *
 * What is frozen now: the pop-up feature string, the `Print VOE` title, the
 * 20 px body padding, and that the on-screen document node is never mutated.
 * What changed on purpose: the document is cloned as a DOM tree instead of
 * serialised and re-parsed; the application's own CSS is inlined instead of
 * fetched from the Tailwind CDN; and print waits on the new document's
 * resources instead of a flat timer.
 *
 * These run in happy-dom against a real detached `Document`, so `createElement`,
 * `importNode` and the resulting tree are real. The browser-level proof — that
 * a real Chromium print document contains the signature, the structure and the
 * styling — is `e2e/voe-print-export.spec.cjs`.
 */
describe('VOEPreviewModal print pipeline', () => {
  /** A print window backed by a real detached document. */
  const makePrintWindow = () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.write = vi.fn();
    doc.close = vi.fn();
    return {
      document: doc,
      closed: false,
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(function close() { this.closed = true; }),
    };
  };

  /** The print body's content wrapper. */
  const printedWrapper = (printWindow) => printWindow.document.body.firstElementChild;

  let styleEl;

  beforeEach(() => {
    // Give the source document a readable stylesheet so `collectPrintStyles`
    // has something to inline; the no-stylesheet path is asserted separately.
    styleEl = document.createElement('style');
    styleEl.textContent = '.voe-print-probe { color: rgb(1, 2, 3); }';
    document.head.appendChild(styleEl);
  });

  afterEach(() => {
    styleEl?.remove();
    vi.unstubAllGlobals();
  });

  it('opens the print window with the frozen feature string and title', async () => {
    const printWindow = makePrintWindow();
    const openSpy = vi.fn(() => printWindow);
    vi.stubGlobal('open', openSpy);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    expect(openSpy).toHaveBeenCalledWith(
      '',
      '',
      'left=0,top=0,width=800,height=900,toolbar=0,scrollbars=0,status=0',
    );
    expect(printWindow.document.write).toHaveBeenCalledWith(
      '<!DOCTYPE html><html><head><title>Print VOE</title></head><body></body></html>',
    );
    expect(printWindow.document.close).toHaveBeenCalled();
    expect(printWindow.focus).toHaveBeenCalled();
    expect(printWindow.close).toHaveBeenCalled();
  });

  it('keeps the 20 px body padding wrapper', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    expect(printedWrapper(printWindow).getAttribute('style')).toBe('padding: 20px;');
  });

  it('carries the whole document structure, its classes and its signature into the print window', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal();
    const source = documentNode();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    const printed = printWindow.document.querySelector('[data-testid="voe-document"]');
    expect(printed).not.toBeNull();

    // Structure: the same element count, not a flattened text dump.
    expect(printed.querySelectorAll('div').length).toBe(source.querySelectorAll('div').length);
    expect(printed.querySelectorAll('div').length).toBeGreaterThan(50);
    expect(printed.querySelector('h1').textContent).toBe('SAFEHAUL');

    // Styling: every class attribute survives, including the root's.
    expect(printed.getAttribute('class')).toBe(source.getAttribute('class'));
    expect(printed.querySelectorAll('[class]').length)
      .toBe(source.querySelectorAll('[class]').length);

    // Signature: the legally operative part of the release.
    const signature = printed.querySelector('img[alt="Signature"]');
    expect(signature).not.toBeNull();
    expect(signature.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    // Legal text and values.
    expect(printed.textContent).toContain('I, the undersigned applicant');
    expect(printed.textContent).toContain('Maria Garcia');
    expect(printed.textContent).toContain('***-**-6789');
    expect(printed.textContent).not.toContain('123-45-6789');
  });

  it('carries a typed signature into the print window', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal({ applicant: { ...APPLICANT, signature: 'TEXT_SIGNATURE:Maria Garcia' } });
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    const printed = printWindow.document.querySelector('[data-testid="voe-document"]');
    expect(printed.textContent).toContain('/s/ Maria Garcia');
    expect(printed.querySelector('img[alt="Signature"]')).toBeNull();
  });

  it('inlines the application stylesheet instead of loading the Tailwind CDN', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    const head = printWindow.document.head.innerHTML;
    expect(head).not.toContain('cdn.tailwindcss.com');
    expect(printWindow.document.querySelector('script')).toBeNull();
    expect(head).toContain('voe-print-probe');
    expect(head).toMatch(/print-color-adjust:\s*exact/);
  });

  it('never mutates the on-screen document while preparing the print copy', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal();
    // The 'Generated on …' clock is re-evaluated on every render, so mask it:
    // this asserts the scrub never touched the live node, not that time stood still.
    const html = () => documentNode().outerHTML.replace(/Generated on [^<]*/, 'Generated on <MASKED>');
    const before = html();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    expect(html()).toBe(before);
    expect(documentNode().querySelector('img[alt="Signature"]')).not.toBeNull();
  });

  it('prints only after the print document has been assembled', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    let bodyAtPrintTime = null;
    printWindow.print = vi.fn(() => {
      bodyAtPrintTime = printWindow.document.body.getAttribute('data-voe-print-ready');
    });

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    expect(bodyAtPrintTime).toBe('true');
  });

  it('reports a blocked pop-up and prints nothing', async () => {
    vi.stubGlobal('open', vi.fn(() => null));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not open the print window. Please allow pop-ups for this site and try again.',
    ));
    // Recoverable: the control is still usable.
    expect(screen.getByRole('button', { name: /^Print$/i })).toBeEnabled();
  });

  it('reports a preparation failure, closes the window and recovers the control', async () => {
    const printWindow = makePrintWindow();
    printWindow.document.write = vi.fn(() => { throw new Error('write blew up'); });
    vi.stubGlobal('open', vi.fn(() => printWindow));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to prepare the document for printing. Please try again.',
    ));
    expect(printWindow.print).not.toHaveBeenCalled();
    expect(printWindow.close).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Print$/i })).toBeEnabled());

    consoleError.mockRestore();
  });

  it('warns visibly when no stylesheet could be collected, and still prints', async () => {
    styleEl.remove();
    const styleSheets = Object.getOwnPropertyDescriptor(Document.prototype, 'styleSheets');
    Object.defineProperty(document, 'styleSheets', { configurable: true, get: () => [] });

    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the document styles for printing. The printed copy may be unstyled.',
    ));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    delete document.styleSheets;
    if (styleSheets) Object.defineProperty(Document.prototype, 'styleSheets', styleSheets);
  });

  it('does not print into a window the user closed while it was being prepared', async () => {
    const printWindow = makePrintWindow();
    printWindow.focus = vi.fn(() => { printWindow.closed = true; });
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^Print$/i })).toBeEnabled());
    expect(printWindow.print).not.toHaveBeenCalled();
  });

  it('does not route the trusted document through the user-content sanitiser', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    // `sanitizeUserContent` is the strict policy for user-authored rich text.
    // Applying it here is what deleted the signature and every class attribute.
    expect(sanitizeSpy.fn).not.toHaveBeenCalled();
  });
});

describe('VOEPreviewModal print escaping', () => {
  /**
   * The applicant and employer values are attacker-influenced. They are rendered
   * as React text nodes, so they are escaped on screen; this asserts they are
   * still inert *after* the clone reaches the print document.
   */
  const HOSTILE = '<img src=x onerror="window.__voePwned = true"><script>window.__voePwned = true' + '<' + '/script>';

  const makePrintWindow = () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.write = vi.fn();
    doc.close = vi.fn();
    return { document: doc, closed: false, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
  };

  afterEach(() => vi.unstubAllGlobals());

  it('renders hostile applicant and employer strings as text, never as markup', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal({
      employer: { ...EMPLOYER, companyName: HOSTILE, city: HOSTILE, email: `${HOSTILE}@x.test` },
      applicant: { ...APPLICANT, firstName: HOSTILE, lastName: 'Garcia', ipAddress: HOSTILE },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    const printed = printWindow.document.querySelector('[data-testid="voe-document"]');

    // Present as visible text …
    expect(printed.textContent).toContain('onerror="window.__voePwned = true"');
    // … and absent as markup.
    expect(printWindow.document.querySelector('script')).toBeNull();
    expect(printed.querySelector('img[src="x"]')).toBeNull();
    expect([...printed.querySelectorAll('*')].some(
      (el) => [...el.attributes].some((a) => a.name.toLowerCase().startsWith('on')),
    )).toBe(false);
  });

  it('drops a javascript: signature rather than carrying it into the print document', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    // eslint-disable-next-line no-script-url
    renderModal({ applicant: { ...APPLICANT, signature: 'javascript:window.__voePwned = true' } });
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    const printed = printWindow.document.querySelector('[data-testid="voe-document"]');
    const signature = printed.querySelector('img[alt="Signature"]');
    expect(signature).not.toBeNull();
    expect(signature.getAttribute('src')).toBeNull();
  });

  it('drops a data:text/html signature', async () => {
    const printWindow = makePrintWindow();
    vi.stubGlobal('open', vi.fn(() => printWindow));

    renderModal({
      applicant: { ...APPLICANT, signature: 'data:text/html;base64,PHNjcmlwdD4xPC9zY3JpcHQ+' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled());

    const printed = printWindow.document.querySelector('[data-testid="voe-document"]');
    expect(printed.querySelector('img[alt="Signature"]').getAttribute('src')).toBeNull();
  });

  it('keeps the on-screen signature contract unchanged for those hostile values', () => {
    // The scrub happens on the clone. The live document is untouched, so the
    // existing signature rules still hold exactly as before.
    // eslint-disable-next-line no-script-url
    renderModal({ applicant: { ...APPLICANT, signature: 'javascript:1' } });
    expect(within(documentNode()).getByAltText('Signature'))
      // eslint-disable-next-line no-script-url
      .toHaveAttribute('src', 'javascript:1');
  });
});

