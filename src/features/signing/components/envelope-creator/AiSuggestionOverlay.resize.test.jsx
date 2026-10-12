/**
 * An AI suggestion's corner handle resizes it with any pointer, a finger
 * included. It listened for mouse events only, so on a phone or tablet a drag
 * of the handle scrolled the page instead. The suggestion is artificial.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-draggable', () => ({
    default: ({ children }) => children,
}));

import { AiSuggestionOverlay } from './AiSuggestionOverlay';

const SUGGESTION = {
    suggestionId: 'sug-1',
    label: 'Driver signature',
    type: 'signature',
    page: 1,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    confidence: 0.9,
};

function renderSuggestion() {
    const onResize = vi.fn();
    const utils = render(
        <AiSuggestionOverlay
            suggestion={SUGGESTION}
            pageNum={1}
            pageWidth={800}
            pageHeight={1000}
            isSelected
            onSelect={vi.fn()}
            onMove={vi.fn()}
            onResize={onResize}
            onAccept={vi.fn()}
            onReject={vi.fn()}
        />,
    );
    return { onResize, handle: utils.container.querySelector('.resize-handle') };
}

describe('AiSuggestionOverlay resize', () => {
    it('resizes with a finger, and the handle never lets the page scroll instead', () => {
        const { onResize, handle } = renderSuggestion();
        fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerType: 'touch' });
        fireEvent(window, new PointerEvent('pointermove', { clientX: 300, clientY: 150, pointerType: 'touch' }));
        fireEvent(window, new PointerEvent('pointerup', { pointerType: 'touch' }));

        // 200x50 px + 200x50 px = 400x100 px of an 800x1000 page.
        expect(onResize).toHaveBeenCalledWith('sug-1', 50, 10);
        expect(handle.className.split(/\s+/)).toContain('touch-none');
    });
});
