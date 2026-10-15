// Which pages of a document the signing room paints. A page canvas on a phone
// takes megabytes, and a long document painted every page at once: the room
// now paints the first pages, then a page as it comes near the view, and gives
// a page's canvas up once it is far away again. Every page keeps its size and
// its fields, so "next field" still scrolls to any of them; a field takes no
// input until its page has painted, whether by pointer or by keyboard.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@shared/components/feedback';

const getEnvelopeFn = vi.fn();
const pdfMockState = vi.hoisted(() => ({ numPages: 1, painted: new Set(), slowPages: new Set(), landscape: new Set() }));
const pageSize = (pageNumber) => (pdfMockState.landscape.has(pageNumber)
  ? { width: 1100, height: 850 }
  : { width: 850, height: 1100 });

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => getEnvelopeFn) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('react-pdf', () => ({
  // Like react-pdf: one load per file, reported once it has finished.
  Document: ({ children, file, onLoadSuccess }) => {
    const latest = React.useRef(onLoadSuccess);
    latest.current = onLoadSuccess;
    React.useEffect(() => {
      let live = true;
      Promise.resolve().then(() => {
        if (!live) return;
        latest.current?.({
          numPages: pdfMockState.numPages,
          getPage: async (pageNumber) => ({ getViewport: () => pageSize(pageNumber) }),
        });
      });
      return () => { live = false; };
    }, [file]);
    return <div data-testid="pdf-document">{children}</div>;
  },
  // A mounted Page is a canvas; a slow page never finishes painting.
  Page: ({ onLoadSuccess, onRenderSuccess, pageNumber }) => {
    React.useEffect(() => {
      pdfMockState.painted.add(pageNumber);
      onLoadSuccess?.({ getViewport: () => pageSize(pageNumber) });
      if (!pdfMockState.slowPages.has(pageNumber)) onRenderSuccess?.();
      return () => { pdfMockState.painted.delete(pageNumber); };
    }, [onLoadSuccess, onRenderSuccess, pageNumber]);
    return <div data-testid="pdf-page" />;
  },
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}));
// The drawing pad needs a real 2D canvas context, which happy-dom lacks: a
// pad that always holds ink. Trimming finds no context and the sheet adopts
// the pad's own PNG.
vi.mock('signature_pad', () => ({
  default: class MockSignaturePad {
    clear() {}
    isEmpty() { return false; }
    toDataURL() { return 'data:image/png;base64,mock-ink'; }
    off() {}
  },
}));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: vi.fn(() => '') }));
vi.mock('@shared/hooks', () => ({ useIsMobile: () => true }));

import SigningRoom from './SigningRoom';

/** An IntersectionObserver the test drives: `show(n)` / `hide(n)` move page n. */
class FakeIntersectionObserver {
  static current = null;

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    FakeIntersectionObserver.current = this;
  }

  observe(target) { this.targets.add(target); }

  unobserve(target) { this.targets.delete(target); }

  disconnect() { this.targets.clear(); }

  move(pageNumber, isIntersecting) {
    const target = [...this.targets].find((node) => node.dataset.signingPage === String(pageNumber));
    act(() => { this.callback([{ target, isIntersecting }], this); });
  }
}

const PAGES = 6;
const field = (pageNumber) => ({
  id: `field-${pageNumber}`, type: 'text', label: `Box ${pageNumber}`, pageNumber, required: false,
  xPosition: 10, yPosition: 10, width: 20, height: 5,
});

async function openRoom() {
  const utils = render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/sign/co1/req1?token=valid-token']}>
        <Routes>
          <Route path="/sign/:companyId/:requestId" element={<SigningRoom />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
  await screen.findByText('Six Page Agreement');
  fireEvent.click(screen.getByRole('button', { name: /I Agree - Proceed to Sign/i }));
  // The document loads after the room mounts, as with react-pdf: wait until
  // every page is there, watched (where the browser can watch), and the first
  // pages have painted.
  await waitFor(() => {
    expect(utils.container.querySelectorAll('[data-signing-page]')).toHaveLength(PAGES);
    if (typeof globalThis.IntersectionObserver === 'function') {
      expect(FakeIntersectionObserver.current?.targets.size).toBe(PAGES);
    }
    expect(painted()).toEqual(expect.arrayContaining([1, 2]));
  });
  return utils;
}

const painted = () => [...pdfMockState.painted].sort((a, b) => a - b);

beforeEach(() => {
  try { localStorage.clear(); } catch { /* best effort */ }
  getEnvelopeFn.mockReset();
  getEnvelopeFn.mockResolvedValue({
    data: {
      title: 'Six Page Agreement',
      recipientName: 'Artificial Signer',
      status: 'sent',
      pdfUrl: 'https://example.test/six-pages.pdf',
      fields: [
        ...Array.from({ length: PAGES }, (_, i) => field(i + 1)),
        { id: 'check-5', type: 'checkbox', pageNumber: 5, required: false, xPosition: 10, yPosition: 30, width: 4, height: 3 },
        { id: 'sig-5', type: 'signature', pageNumber: 5, required: false, xPosition: 10, yPosition: 50, width: 20, height: 8 },
      ],
    },
  });
  pdfMockState.numPages = PAGES;
  pdfMockState.painted = new Set();
  pdfMockState.slowPages = new Set();
  pdfMockState.landscape = new Set();
  FakeIntersectionObserver.current = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the pages the signing room paints', () => {
  it('paints the first pages at once and the others as they come near the view', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    await openRoom();

    expect(painted()).toEqual([1, 2]);

    FakeIntersectionObserver.current.move(5, true);

    await waitFor(() => expect(painted()).toEqual([1, 2, 5]));
  });

  it('gives a page its canvas back once it is far from the view again', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    await openRoom();
    FakeIntersectionObserver.current.move(5, true);
    await waitFor(() => expect(painted()).toContain(5));

    FakeIntersectionObserver.current.move(5, false);

    await waitFor(() => expect(painted()).toEqual([1, 2]));
    expect(screen.getByText(/Rendering page 5/)).toBeInTheDocument();
  });

  it('keeps every page its size and its fields, painted or not', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { container } = await openRoom();

    for (let page = 1; page <= PAGES; page += 1) {
      const node = container.querySelector(`[data-signing-page="${page}"]`);
      expect(node.style.height).not.toBe('');
      expect(node.querySelector(`[data-field-id="field-${page}"]`)).toBeTruthy();
    }
  });

  it('gives a page not yet painted its own shape, so nothing jumps when it paints', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    pdfMockState.landscape = new Set([5]);
    const { container } = await openRoom();
    const shape = (page) => {
      const { width, height } = container.querySelector(`[data-signing-page="${page}"]`).style;
      return parseFloat(height) / parseFloat(width);
    };

    await waitFor(() => expect(shape(5)).toBeCloseTo(850 / 1100, 2));
    expect(painted()).not.toContain(5);
    expect(shape(4)).toBeCloseTo(1100 / 850, 2);
  });

  it('watches the pages a little beyond the visible area', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    await openRoom();

    expect(FakeIntersectionObserver.current.targets.size).toBe(PAGES);
    expect(FakeIntersectionObserver.current.options.rootMargin).toMatch(/%/);
  });

  it('paints a page as soon as one of its fields takes the keyboard focus', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { container } = await openRoom();

    act(() => { container.querySelector('[data-signer-input="field-5"]').focus(); });

    await waitFor(() => expect(painted()).toContain(5));
  });

  it('lets no field on a page still painting take input, by keyboard or pointer', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    pdfMockState.slowPages = new Set([5]);
    const { container } = await openRoom();
    const text = container.querySelector('[data-signer-input="field-5"]');
    act(() => { text.focus(); });
    await waitFor(() => expect(painted()).toContain(5));

    expect(text.readOnly).toBe(true);
    const checkbox = container.querySelector('[data-field-id="check-5"] input');
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(container.querySelector('[data-field-id="sig-5"] button'));
    expect(screen.queryByRole('dialog', { name: /Draw your signature/i })).toBeNull();
    // A painted page's fields work as before.
    expect(container.querySelector('[data-signer-input="field-1"]').readOnly).toBe(false);
  });

  it('paints every page where the browser cannot say what is in view', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    await openRoom();

    await waitFor(() => expect(painted()).toEqual([1, 2, 3, 4, 5, 6]));
  });
});
