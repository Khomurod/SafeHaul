// Which pages of a document the signing room paints. A page canvas on a phone
// takes megabytes, and a long document painted every page at once: the room
// now paints the first pages, then a page as it comes near the view, and gives
// a page's canvas up once it is far away again. Every page keeps its size and
// its fields, so "next field" still scrolls to any of them.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@shared/components/feedback';

const getEnvelopeFn = vi.fn();
const pdfMockState = vi.hoisted(() => ({ numPages: 1, painted: new Set() }));

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => getEnvelopeFn) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('react-pdf', () => ({
  Document: ({ children, onLoadSuccess }) => {
    React.useEffect(() => {
      onLoadSuccess?.({ numPages: pdfMockState.numPages });
    }, [onLoadSuccess]);
    return <div data-testid="pdf-document">{children}</div>;
  },
  // A mounted Page is a painted canvas.
  Page: ({ onLoadSuccess, onRenderSuccess, pageNumber }) => {
    React.useEffect(() => {
      pdfMockState.painted.add(pageNumber);
      onLoadSuccess?.({ getViewport: () => ({ width: 850, height: 1100 }) });
      onRenderSuccess?.();
      return () => { pdfMockState.painted.delete(pageNumber); };
    }, [onLoadSuccess, onRenderSuccess, pageNumber]);
    return <div data-testid="pdf-page" />;
  },
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
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
  await waitFor(() => expect(utils.container.querySelectorAll('[data-signing-page]')).toHaveLength(PAGES));
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
      fields: Array.from({ length: PAGES }, (_, i) => field(i + 1)),
    },
  });
  pdfMockState.numPages = PAGES;
  pdfMockState.painted = new Set();
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

  it('watches the pages a little beyond the visible area', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    await openRoom();

    expect(FakeIntersectionObserver.current.targets.size).toBe(PAGES);
    expect(FakeIntersectionObserver.current.options.rootMargin).toMatch(/%/);
  });

  it('paints every page where the browser cannot say what is in view', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    await openRoom();

    await waitFor(() => expect(painted()).toEqual([1, 2, 3, 4, 5, 6]));
  });
});
