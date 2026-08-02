import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SignaturePad } from './SignaturePad';

// happy-dom does not implement the 2D canvas API; stub just enough of it so
// the component's drawing lifecycle (begin/line/stroke/clear/toDataURL) runs.
const ctxStub = {
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
};

beforeEach(() => {
    vi.restoreAllMocks();
    window.HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub);
    window.HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,TEST');
    window.HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, width: 300, height: 150,
    }));
});

function drawStroke(canvas) {
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 40, clientY: 40 });
    fireEvent.mouseUp(canvas);
}

describe('shared SignaturePad', () => {
    it('shows the placeholder until a signature is drawn', () => {
        const { getByText } = render(<SignaturePad onSignatureChange={vi.fn()} />);
        expect(getByText('Draw your signature here')).toBeInTheDocument();
    });

    it('emits a PNG data URL after a stroke is drawn (same format the PEV submit sends)', () => {
        const onChange = vi.fn();
        const { container } = render(<SignaturePad onSignatureChange={onChange} />);
        const canvas = container.querySelector('canvas');

        drawStroke(canvas);

        expect(ctxStub.stroke).toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledWith('data:image/png;base64,TEST');
    });

    it('clear button wipes the canvas and reports null (field becomes required again)', () => {
        const onChange = vi.fn();
        const { container, getByText, queryByText } = render(<SignaturePad onSignatureChange={onChange} />);
        const canvas = container.querySelector('canvas');

        drawStroke(canvas);
        expect(queryByText('Draw your signature here')).toBeNull();

        fireEvent.click(getByText('Clear Signature'));

        expect(ctxStub.clearRect).toHaveBeenCalled();
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(getByText('Draw your signature here')).toBeInTheDocument();
    });

    it('does not emit a signature for a mouse-up without drawing', () => {
        const onChange = vi.fn();
        const { container } = render(<SignaturePad onSignatureChange={onChange} />);
        const canvas = container.querySelector('canvas');

        fireEvent.mouseUp(canvas);

        expect(onChange).not.toHaveBeenCalled();
    });

    it('supports touch drawing (mobile signers)', () => {
        const onChange = vi.fn();
        const { container } = render(<SignaturePad onSignatureChange={onChange} />);
        const canvas = container.querySelector('canvas');

        fireEvent.touchStart(canvas, { touches: [{ clientX: 5, clientY: 5 }] });
        fireEvent.touchMove(canvas, { touches: [{ clientX: 25, clientY: 25 }] });
        fireEvent.touchEnd(canvas);

        expect(onChange).toHaveBeenCalledWith('data:image/png;base64,TEST');
    });
});
