/**
 * Contract freeze for the shared `SignaturePad`.
 *
 * WHY THIS FILE EXISTS
 *
 * `SignaturePad` collects the legally operative mark on an FMCSA 49 CFR §391.23
 * employer verification. The 2026-07-23 portal migration deliberately left it
 * untouched, so it went into this campaign as the last unmigrated surface — with
 * raw palette classes, no accessible name, an unassociated error, and a bare
 * `<button>` clear action.
 *
 * Everything asserted here is asserted **by value and before** the presentation
 * work, so the migration is provably behaviour-preserving. The two contracts the
 * portal depends on are the emission format (`data:image/png…` on stroke end,
 * `null` on clear) and the 150 px canvas height.
 *
 * The divergence group at the bottom is different: those tests **failed** when
 * written. They pin the invariant the resize defect broke — see the file header
 * of `SignaturePad.jsx`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { SignaturePad, SIGNATURE_CANVAS_HEIGHT } from './SignaturePad';

/**
 * happy-dom has no 2D canvas implementation. Stub enough of it that the drawing
 * lifecycle runs. `drawImage` is deliberately **absent** by default: that is the
 * "cannot preserve the bitmap" environment, and the component must fail safe
 * there rather than leave stale data behind.
 */
function makeCtx(extra = {}) {
  return {
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), clearRect: vi.fn(), closePath: vi.fn(),
    ...extra,
  };
}

let ctxStub;
let rect;

beforeEach(() => {
  ctxStub = makeCtx();
  rect = { left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150 };
  window.HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub);
  window.HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,TEST');
  window.HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => rect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const canvasOf = (container) => container.querySelector('canvas');

function drawStroke(canvas, from = { clientX: 10, clientY: 10 }, to = { clientX: 40, clientY: 40 }) {
  fireEvent.mouseDown(canvas, from);
  fireEvent.mouseMove(canvas, to);
  fireEvent.mouseUp(canvas);
}

// ─────────────────────────────────────────────────────────────────────────────
// Frozen: the contract the verification portal submits against.
// ─────────────────────────────────────────────────────────────────────────────

describe('SignaturePad emission contract', () => {
  it('emits a PNG data URL when a stroke finishes', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);

    drawStroke(canvasOf(container));

    expect(ctxStub.stroke).toHaveBeenCalled();
    expect(onSignatureChange).toHaveBeenCalledWith('data:image/png;base64,TEST');
    expect(onSignatureChange.mock.calls[0][0]).toMatch(/^data:image\/png/);
  });

  it('emits exactly null when cleared', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);

    drawStroke(canvasOf(container));
    fireEvent.click(screen.getByRole('button', { name: /clear signature/i }));

    expect(ctxStub.clearRect).toHaveBeenCalled();
    expect(onSignatureChange).toHaveBeenLastCalledWith(null);
  });

  it('does not emit for a mouse-up that drew nothing', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);

    fireEvent.mouseUp(canvasOf(container));

    expect(onSignatureChange).not.toHaveBeenCalled();
  });

  it('keeps the 150 px canvas height contract', () => {
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} />);
    expect(SIGNATURE_CANVAS_HEIGHT).toBe(150);
    expect(canvasOf(container).height).toBe(150);
  });

  it('shows the placeholder until something is drawn, then hides it', () => {
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} />);
    expect(screen.getByText('Draw your signature here')).toBeInTheDocument();

    drawStroke(canvasOf(container));

    expect(screen.queryByText('Draw your signature here')).toBeNull();
  });
});

describe('SignaturePad input devices', () => {
  it('signs with a mouse', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    drawStroke(canvasOf(container));
    expect(onSignatureChange).toHaveBeenCalledWith('data:image/png;base64,TEST');
  });

  it('signs with touch', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    const canvas = canvasOf(container);

    fireEvent.touchStart(canvas, { touches: [{ clientX: 5, clientY: 5 }] });
    fireEvent.touchMove(canvas, { touches: [{ clientX: 25, clientY: 25 }] });
    fireEvent.touchEnd(canvas);

    expect(onSignatureChange).toHaveBeenCalledWith('data:image/png;base64,TEST');
  });

  it('signs with a pointer (pen and stylus)', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    const canvas = canvasOf(container);

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'pen', clientX: 5, clientY: 5 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'pen', clientX: 30, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen' });

    expect(onSignatureChange).toHaveBeenCalledWith('data:image/png;base64,TEST');
  });

  it('does not draw a single gesture twice when the browser also fires compatibility mouse events', () => {
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} />);
    const canvas = canvasOf(container);

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 5 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 30, clientY: 30 });
    // The browser's compatibility mouse events for the same gesture.
    fireEvent.mouseDown(canvas, { clientX: 5, clientY: 5 });
    fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30 });

    expect(ctxStub.lineTo).toHaveBeenCalledTimes(1);
  });

  it('ends the stroke when the cursor leaves the pad mid-drag', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    const canvas = canvasOf(container);

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 40, clientY: 40 });
    fireEvent.mouseLeave(canvas);

    expect(onSignatureChange).toHaveBeenCalledWith('data:image/png;base64,TEST');
  });

  it('maps client coordinates through the canvas scale factor', () => {
    // A backing store twice the rendered width must halve incoming coordinates.
    rect = { left: 20, top: 10, right: 320, bottom: 160, width: 300, height: 150 };
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} />);
    const canvas = canvasOf(container);
    canvas.width = 600;

    fireEvent.mouseDown(canvas, { clientX: 170, clientY: 85 });

    // (170 - 20) * (600 / 300) = 300 ; (85 - 10) * (150 / 150) = 75
    expect(ctxStub.moveTo).toHaveBeenCalledWith(300, 75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The defect: visible signature vs submitted data.
// ─────────────────────────────────────────────────────────────────────────────

describe('SignaturePad resize and orientation invariant', () => {
  /**
   * Setting `canvas.width` resets the bitmap. The pre-fix component resized on
   * every window `resize` event and never told the parent, so the pixels went
   * blank while `formData.signatureData` still held the old PNG — the submitted
   * signature was one the respondent could no longer see. On a phone, rotating
   * the device or the URL bar collapsing was enough to trigger it.
   */
  it('never leaves stored signature data behind when the bitmap cannot be preserved', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    drawStroke(canvasOf(container));
    expect(onSignatureChange).toHaveBeenLastCalledWith('data:image/png;base64,TEST');

    // Rotate: the rendered width changes, so the bitmap is rebuilt. This
    // environment has no `drawImage`, so the drawing cannot be carried over.
    rect = { ...rect, width: 500, right: 500 };
    fireEvent(window, new Event('resize'));

    // The pad must report the loss rather than let stale data outlive the pixels.
    expect(onSignatureChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Draw your signature here')).toBeInTheDocument();
  });

  it('preserves the drawing and re-emits it when the bitmap can be carried over', () => {
    const drawImage = vi.fn();
    ctxStub = makeCtx({ drawImage });
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    drawStroke(canvasOf(container));
    onSignatureChange.mockClear();

    rect = { ...rect, width: 500, right: 500 };
    fireEvent(window, new Event('resize'));

    // Copied out and back in, and the parent's stored PNG re-issued so it
    // matches the pixels now on screen.
    expect(drawImage).toHaveBeenCalled();
    expect(onSignatureChange).toHaveBeenLastCalledWith('data:image/png;base64,TEST');
    expect(screen.queryByText('Draw your signature here')).toBeNull();
  });

  it('ignores a resize event that does not change the rendered size', () => {
    ctxStub = makeCtx({ drawImage: vi.fn() });
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    drawStroke(canvasOf(container));
    onSignatureChange.mockClear();

    // A mobile URL bar collapsing fires resize without changing our width.
    fireEvent(window, new Event('resize'));

    expect(onSignatureChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Draw your signature here')).toBeNull();
  });

  it('does not emit anything when an empty pad is resized', () => {
    const onSignatureChange = vi.fn();
    render(<SignaturePad onSignatureChange={onSignatureChange} />);

    rect = { ...rect, width: 500, right: 500 };
    fireEvent(window, new Event('resize'));

    expect(onSignatureChange).not.toHaveBeenCalled();
  });

  it('responds to orientationchange as well as resize', () => {
    const onSignatureChange = vi.fn();
    const { container } = render(<SignaturePad onSignatureChange={onSignatureChange} />);
    drawStroke(canvasOf(container));
    onSignatureChange.mockClear();

    rect = { ...rect, width: 800, right: 800 };
    fireEvent(window, new Event('orientationchange'));

    expect(onSignatureChange).toHaveBeenLastCalledWith(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility surface added by this campaign.
// ─────────────────────────────────────────────────────────────────────────────

describe('SignaturePad accessibility', () => {
  it('gives the drawing surface an accessible name', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />);
    expect(screen.getByRole('img', { name: /signature/i })).toBeInTheDocument();
  });

  it('accepts a caller-supplied accessible name', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} label="Respondent signature" />);
    expect(screen.getByRole('img', { name: 'Respondent signature' })).toBeInTheDocument();
  });

  it('associates the drawing instructions with the surface', () => {
    const { container } = render(
      <SignaturePad onSignatureChange={vi.fn()} instructions="Draw with a finger or mouse." />,
    );
    const canvas = canvasOf(container);
    const describedBy = canvas.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const described = describedBy.split(' ').map((id) => container.querySelector(`#${id}`)?.textContent).join(' ');
    expect(described).toContain('Draw with a finger or mouse.');
  });

  it('associates an error with the surface and marks it invalid', () => {
    const { container } = render(
      <SignaturePad onSignatureChange={vi.fn()} error="Please provide your electronic signature" />,
    );
    const canvas = canvasOf(container);
    expect(canvas).toHaveAttribute('aria-invalid', 'true');

    const describedBy = canvas.getAttribute('aria-describedby').split(' ');
    const messages = describedBy.map((id) => container.querySelector(`#${id}`)?.textContent).join(' ');
    expect(messages).toContain('Please provide your electronic signature');
  });

  it('is not marked invalid when there is no error', () => {
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} />);
    expect(canvasOf(container)).not.toHaveAttribute('aria-invalid');
  });

  it('exposes Clear as a real button that is disabled until there is something to clear', () => {
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} />);
    const clear = screen.getByRole('button', { name: /clear signature/i });

    expect(clear).toBeDisabled();
    expect(clear).toHaveAttribute('type', 'button');

    drawStroke(canvasOf(container));
    expect(screen.getByRole('button', { name: /clear signature/i })).toBeEnabled();
  });

  it('announces capture and clearing in a live region', () => {
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();

    drawStroke(canvasOf(container));
    expect(status.textContent).toMatch(/captured/i);

    fireEvent.click(screen.getByRole('button', { name: /clear signature/i }));
    expect(status.textContent).toMatch(/cleared/i);
  });

  it('carries no raw palette classes, only design-system tokens', () => {
    const { container } = render(<SignaturePad onSignatureChange={vi.fn()} error="x" />);
    const offenders = [...container.querySelectorAll('*')]
      .map((el) => el.getAttribute('class') || '')
      .filter((c) => /(^|\s)(bg|text|border)-(gray|slate|blue|red|green|zinc|neutral)-\d{2,3}(\s|$)/.test(c));
    expect(offenders).toEqual([]);
  });
});
