// Focused coverage for the signer's signature/initials capture dialog.
// The accessible name, the three controls and every drawing prop are frozen
// contracts — `SigningRoom.test.jsx` and the signing E2E specs drive them — so
// each is pinned here. All fixtures are artificial; no real recipient, document
// or signature data appears.
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The drawing pad needs a real 2D canvas context, which happy-dom lacks. The
// fake has the surface the sheet uses and starts empty, like the real pad;
// `drawOnPad()` marks the open pad as drawn.
const mockPads = [];
const mockClear = vi.fn();

vi.mock('signature_pad', () => ({
    default: class FakeSignaturePad {
        constructor(canvas, options) {
            this.canvas = canvas;
            this.options = options;
            this.drawn = false;
            this.released = false;
            mockPads.push(this);
        }

        clear() {
            mockClear();
            this.drawn = false;
        }

        isEmpty() {
            return !this.drawn;
        }

        toDataURL() {
            return 'data:image/png;base64,untrimmed-ink';
        }

        off() {
            this.released = true;
        }
    },
}));

const mockTrim = vi.fn();
vi.mock('./trimSignature', () => ({
    trimmedSignaturePng: (...args) => mockTrim(...args),
}));

import { SignatureSheet } from './SignatureSheet';

let onCancel;
let onAdopt;

function renderSheet(props = {}) {
    return render(<SignatureSheet onCancel={onCancel} onAdopt={onAdopt} {...props} />);
}

function drawOnPad() {
    mockPads.at(-1).drawn = true;
}

beforeEach(() => {
    mockPads.length = 0;
    vi.resetAllMocks();
    mockTrim.mockImplementation(() => 'data:image/png;base64,artificial-ink');
    onCancel = vi.fn();
    onAdopt = vi.fn();
});

describe('SignatureSheet — frozen contracts', () => {
    it('keeps the dialog name the signing room and E2E specs query', () => {
        renderSheet();
        expect(screen.getByRole('dialog', { name: /Draw your signature/i })).toBeInTheDocument();
    });

    it('names the initials variant separately', () => {
        renderSheet({ kind: 'initial' });
        expect(screen.getByRole('dialog', { name: /Draw your initials/i })).toBeInTheDocument();
    });

    it('adopts the trimmed PNG of the drawing canvas through onAdopt', () => {
        renderSheet();
        drawOnPad();
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));
        expect(mockTrim).toHaveBeenCalledWith(screen.getByTestId('signature-sheet-canvas'));
        expect(onAdopt).toHaveBeenCalledWith('data:image/png;base64,artificial-ink');
    });

    it('adopts the whole canvas when the browser cannot trim it', () => {
        mockTrim.mockImplementation(() => {
            throw new TypeError('no 2D context');
        });
        renderSheet();
        drawOnPad();
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));
        expect(onAdopt).toHaveBeenCalledWith('data:image/png;base64,untrimmed-ink');
    });

    it('cancels without adopting', () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onAdopt).not.toHaveBeenCalled();
    });

    it('clears the pad without adopting or cancelling', () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(mockClear).toHaveBeenCalledTimes(1);
        expect(onAdopt).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('keeps the canvas test hook and how the ink is drawn', () => {
        renderSheet();
        const canvas = screen.getByTestId('signature-sheet-canvas');
        expect(mockPads).toHaveLength(1);
        expect(mockPads[0].canvas).toBe(canvas);
        // The ink colour is document content, not theme: an already-signed PDF
        // must never retint.
        expect(mockPads[0].options).toEqual({
            penColor: '#0f172a',
            minWidth: 1.2,
            maxWidth: 2.6,
            velocityFilterWeight: 0.7,
        });
        // Strokes must never scroll the page.
        expect(canvas.style.touchAction).toBe('none');
    });

    it('releases the pad when the sheet closes', () => {
        const view = renderSheet();
        view.unmount();
        expect(mockPads[0].released).toBe(true);
    });

    /*
     * Asserted against the source rather than the render: happy-dom's CSSOM
     * cannot parse `max(0.75rem, env(safe-area-inset-top))`, so it drops the
     * declaration and React emits no style attribute at all. Chromium does
     * apply it: the probe for this slice measured the `max()` resolving to its
     * 12 px / 16 px fallbacks at 390/834/1440 px, none of which report a
     * non-zero safe-area inset. So a DOM assertion here would only be testing
     * happy-dom. This guard still catches an accidental deletion, which is what
     * it is for.
     */
    it('keeps both safe-area insets', () => {
        const source = readFileSync(path.join(__dirname, 'SignatureSheet.jsx'), 'utf8');
        expect(source).toContain('max(0.75rem, env(safe-area-inset-top))');
        expect(source).toContain('max(1rem, env(safe-area-inset-bottom))');
    });
});

describe('SignatureSheet — empty pad', () => {
    it('does not adopt an empty pad and says why', () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));

        expect(onAdopt).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Draw your signature before adopting it.');
    });

    it('uses the initials wording for the initials variant', () => {
        renderSheet({ kind: 'initial' });
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));
        expect(screen.getByRole('status')).toHaveTextContent('Draw your initials before adopting them.');
    });

    it('retires the hint once the pad is cleared', () => {
        renderSheet();
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));
        expect(screen.getByRole('status')).toHaveTextContent(/before adopting/);

        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(screen.getByRole('status')).toHaveTextContent('');
    });

    it('does not adopt a canvas that holds no ink', () => {
        mockTrim.mockImplementation(() => null);
        renderSheet();
        drawOnPad();
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));

        expect(onAdopt).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Draw your signature before adopting it.');
    });

    it('forgets the drawing when a new size wipes the canvas', () => {
        renderSheet();
        const canvas = screen.getByTestId('signature-sheet-canvas');
        drawOnPad();
        expect(mockClear).not.toHaveBeenCalled();

        // A phone turned on its side: the wrapper measures larger, the canvas
        // gets new pixel dimensions, and its pixels are gone.
        vi.spyOn(canvas.parentElement, 'getBoundingClientRect').mockReturnValue({
            width: 600, height: 300, top: 0, left: 0, right: 600, bottom: 300, x: 0, y: 0,
        });
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(canvas).toHaveAttribute('width', '600');
        expect(mockClear).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: /Adopt & continue/i }));
        expect(onAdopt).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Draw your signature before adopting it.');
    });

    it('mounts the live region before there is anything to announce', () => {
        renderSheet();
        expect(screen.getByRole('status')).toHaveTextContent('');
    });
});

describe('SignatureSheet — dialog behaviour', () => {
    it('cancels on Escape, which the hand-rolled overlay never did', () => {
        renderSheet();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not discard a drawing when the backdrop is clicked', () => {
        const { container } = renderSheet();
        const backdrop = container.firstChild;
        fireEvent.mouseDown(backdrop);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('moves focus into the dialog on open', () => {
        renderSheet();
        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    it('describes the dialog with the legal consent text', () => {
        renderSheet();
        const dialog = screen.getByRole('dialog');
        const describedBy = dialog.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy)).toHaveTextContent(/is your legal signature/);
    });
});

describe('SignatureSheet — presentation', () => {
    it('uses no legacy palette classes, raw hex in markup or unsupported small text', () => {
        for (const kind of ['signature', 'initial']) {
            const view = renderSheet({ kind });
            const html = view.container.innerHTML;
            expect(html).not.toMatch(/(bg|text|border)-(gray|blue|green|red|amber|yellow|slate)-\d{2,3}/);
            expect(html).not.toMatch(/text-\[(9|10|11)px\]/);
            expect(html).not.toMatch(/bg-black|bg-white/);
            view.unmount();
        }
    });

    it('uses approved Buttons for all three controls', () => {
        renderSheet();
        for (const name of [/Adopt & continue/i, 'Cancel', 'Clear']) {
            expect(screen.getByRole('button', { name })).toHaveClass('ds-button');
        }
    });

    it('has no accessibility violations in either variant', async () => {
        for (const kind of ['signature', 'initial']) {
            const view = renderSheet({ kind });
            expect((await axe(view.container)).violations).toEqual([]);
            view.unmount();
        }
    });
});
