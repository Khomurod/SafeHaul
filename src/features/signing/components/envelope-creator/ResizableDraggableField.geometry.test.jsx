// The placed-field overlay, part 1 of 2: geometry conversion, the drag
// contract, the resize contract, selection/label/removal, and keyboard
// placement — every percentage conversion, bound, floor and callback payload.
// The shared harness — the react-draggable double, fixtures and helpers —
// lives in `ResizableDraggableField.support.jsx`; the registration below
// delegates to it. All fixtures are artificial.
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-draggable', async () => (await import('./ResizableDraggableField.support')).reactDraggableMock());

import { ResizableDraggableField } from './ResizableDraggableField';
import {
    makeRenderField,
    resetHarness,
    resizeBy,
    makeField,
    icon,
    handlers,
    draggableProps,
    PAGE_WIDTH,
    PAGE_HEIGHT,
} from './ResizableDraggableField.support';

const renderField = makeRenderField(ResizableDraggableField);

beforeEach(resetHarness);

describe('ResizableDraggableField — geometry', () => {
    it('converts percentage position to pixels for the drag position', () => {
        renderField({ x: 10, y: 20 });
        expect(draggableProps.current.position).toEqual({ x: 80, y: 200 });
    });

    it('converts percentage size to pixels for the rendered box', () => {
        const { container } = renderField({ width: 25, height: 5 });
        const box = container.querySelector('[data-draggable]');
        expect(box).toHaveStyle({ width: '200px', height: '50px' });
    });

    it('falls back to a 800px page height when none is supplied', () => {
        renderField({ y: 50, height: 10 }, { pageHeight: undefined });
        // 50% of the 800px fallback, not of the real page.
        expect(draggableProps.current.position).toEqual({ x: 80, y: 400 });
    });

    it('treats a zero page height as absent', () => {
        renderField({ y: 50 }, { pageHeight: 0 });
        expect(draggableProps.current.position.y).toBe(400);
    });

    it('re-syncs the box when the field size prop changes', () => {
        const { container, rerender } = renderField({ width: 25, height: 5 });
        rerender(
            <ResizableDraggableField
                field={makeField({ width: 50, height: 10 })}
                pageNum={1}
                pageWidth={PAGE_WIDTH}
                pageHeight={PAGE_HEIGHT}
                getIcon={icon}
                isSelected={false}
                {...handlers}
            />,
        );
        expect(container.querySelector('[data-draggable]')).toHaveStyle({ width: '400px', height: '100px' });
    });
});

describe('ResizableDraggableField — drag contract', () => {
    it('constrains dragging to the page and cancels on the handle and label', () => {
        renderField();
        expect(draggableProps.current.bounds).toBe('parent');
        expect(draggableProps.current.cancel).toBe('.resize-handle, .label-input');
    });

    it('reports the drop position back as percentages of the page', () => {
        renderField();
        draggableProps.current.onStop({}, { x: 400, y: 500 });
        expect(handlers.onStop).toHaveBeenCalledTimes(1);
        // The trailing options object is additive: the four positional
        // arguments are unchanged, and `snap` marks this as a pointer gesture.
        expect(handlers.onStop).toHaveBeenCalledWith('f-1', 1, 50, 50, { snap: true });
    });

    it('uses the page-height fallback in the drop conversion too', () => {
        renderField({}, { pageHeight: undefined });
        draggableProps.current.onStop({}, { x: 200, y: 400 });
        expect(handlers.onStop).toHaveBeenCalledWith('f-1', 1, 25, 50, { snap: true });
    });

    it('reports the page it was dropped on', () => {
        renderField({}, { pageNum: 3 });
        draggableProps.current.onStop({}, { x: 0, y: 0 });
        expect(handlers.onStop).toHaveBeenCalledWith('f-1', 3, 0, 0, { snap: true });
    });
});

describe('ResizableDraggableField — resize contract', () => {
    // The resize handle is contextual: it belongs to the selected field.
    it('reports the new size as percentages after a drag of the handle', () => {
        const { container } = renderField({ width: 25, height: 5 }, { isSelected: true });
        // 200x50 px + 200x50 px = 400x100 px → 50% x 10%.
        resizeBy(container, 200, 50);
        expect(handlers.onResize).toHaveBeenCalledTimes(1);
        expect(handlers.onResize).toHaveBeenCalledWith('f-1', 50, 10);
    });

    it('enforces the 8px minimum in both dimensions', () => {
        const { container } = renderField({ width: 25, height: 5 }, { isSelected: true });
        resizeBy(container, -1000, -1000);
        expect(handlers.onResize).toHaveBeenCalledWith('f-1', (8 / PAGE_WIDTH) * 100, (8 / PAGE_HEIGHT) * 100);
    });

    it('grows the rendered box live while dragging', () => {
        const { container } = renderField({ width: 25, height: 5 }, { isSelected: true });
        const handle = container.querySelector('.resize-handle');
        fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 });
        fireEvent(window, new MouseEvent('mousemove', { clientX: 100, clientY: 20 }));
        expect(container.querySelector('[data-draggable]')).toHaveStyle({ width: '300px', height: '70px' });
        fireEvent(window, new MouseEvent('mouseup', {}));
    });

    it('stops tracking the pointer after the gesture ends', () => {
        const { container } = renderField({}, { isSelected: true });
        resizeBy(container, 100, 100);
        handlers.onResize.mockClear();

        // A stray move after mouseup must not resize anything further.
        fireEvent(window, new MouseEvent('mousemove', { clientX: 999, clientY: 999 }));
        fireEvent(window, new MouseEvent('mouseup', {}));
        expect(handlers.onResize).not.toHaveBeenCalled();
    });

    it('uses the page-height fallback in the resize conversion', () => {
        const { container } = renderField({ width: 25, height: 5 }, { pageHeight: undefined, isSelected: true });
        resizeBy(container, 0, 0);
        // Height starts at 5% of the 800px fallback = 40px → back to 5%.
        expect(handlers.onResize).toHaveBeenCalledWith('f-1', 25, 5);
    });
});

describe('ResizableDraggableField — selection, label and removal', () => {
    it('selects by id and does not let the click reach the page', () => {
        const { container } = renderField();
        const box = container.querySelector('[data-draggable]');
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        const stopPropagation = vi.spyOn(clickEvent, 'stopPropagation');
        box.dispatchEvent(clickEvent);

        expect(handlers.onSelect).toHaveBeenCalledWith('f-1', { additive: false });
        expect(stopPropagation).toHaveBeenCalled();
    });

    it('shows a selection ring only when selected', () => {
        const { container, rerender } = renderField();
        expect(container.querySelector('[data-draggable]').className).not.toContain('ring-2');

        rerender(
            <ResizableDraggableField
                field={makeField()}
                pageNum={1}
                pageWidth={PAGE_WIDTH}
                pageHeight={PAGE_HEIGHT}
                getIcon={icon}
                isSelected
                {...handlers}
            />,
        );
        expect(container.querySelector('[data-draggable]').className).toContain('ring-2');
    });

    it('edits the label by id with the raw value', () => {
        renderField();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Signer Name' } });
        expect(handlers.onLabelChange).toHaveBeenCalledWith('f-1', 'Signer Name');
    });

    it('hides the label input at or below the 40px width threshold', () => {
        const { container } = renderField({ width: 5 }); // 40px exactly
        expect(container.querySelector('.label-input')).toBeNull();
    });

    it('shows the label input above the 40px threshold', () => {
        const { container } = renderField({ width: 6 }); // 48px
        expect(container.querySelector('.label-input')).not.toBeNull();
    });

    it('removes by id on mousedown so the drag never starts', () => {
        renderField({}, { isSelected: true });
        const remove = screen.getByRole('button', { name: 'Remove Full Name from page 1' });
        fireEvent.mouseDown(remove);
        expect(handlers.onRemove).toHaveBeenCalledWith('f-1');
    });

    it('names the remove control even for an unlabelled field', () => {
        renderField({ label: '' }, { isSelected: true });
        expect(screen.getByRole('button', { name: 'Remove Untitled field from page 1' })).toBeInTheDocument();
    });

    it('names the label input by field type and page', () => {
        renderField({ type: 'signature' }, { pageNum: 2 });
        expect(screen.getByRole('textbox', { name: 'Label for signature field on page 2' })).toBeInTheDocument();
    });
});

describe('ResizableDraggableField — keyboard placement', () => {
    function box(container) {
        return container.querySelector('[data-draggable]');
    }

    it('is reachable by keyboard and selects on focus', () => {
        const { container } = renderField();
        const target = box(container);
        expect(target).toHaveAttribute('tabindex', '0');
        fireEvent.focus(target);
        expect(handlers.onSelect).toHaveBeenCalledWith('f-1');
    });

    it('names itself and describes how to move', () => {
        renderField({ type: 'signature', label: 'Signature' }, { pageNum: 2 });
        const target = screen.getByRole('group', { name: 'Signature, signature field on page 2' });
        const describedBy = target.getAttribute('aria-describedby');
        expect(document.getElementById(describedBy)).toHaveTextContent(/Arrow keys move the field/);
    });

    it.each([
        ['ArrowRight', 11, 20],
        ['ArrowLeft', 9, 20],
        ['ArrowDown', 10, 21],
        ['ArrowUp', 10, 19],
    ])('moves by one percent on %s', (key, x, y) => {
        const { container } = renderField({ x: 10, y: 20 });
        fireEvent.keyDown(box(container), { key });
        expect(handlers.onStop).toHaveBeenCalledWith('f-1', 1, x, y);
    });

    it('moves by five percent with Shift', () => {
        const { container } = renderField({ x: 10, y: 20 });
        fireEvent.keyDown(box(container), { key: 'ArrowRight', shiftKey: true });
        expect(handlers.onStop).toHaveBeenCalledWith('f-1', 1, 15, 20);
    });

    it('clamps movement to the page just like bounds="parent"', () => {
        const { container } = renderField({ x: 0, y: 0 });
        fireEvent.keyDown(box(container), { key: 'ArrowLeft' });
        expect(handlers.onStop).toHaveBeenCalledWith('f-1', 1, 0, 0);

        handlers.onStop.mockClear();
        // width 25 → the right edge stops at 75. The y axis is clamped in the same
        // move, so a field already past the bottom edge (96 + height 5) is pulled
        // back to 95 rather than left hanging off the page.
        const wide = renderField({ x: 74, y: 96, width: 25, height: 5 });
        fireEvent.keyDown(wide.container.querySelector('[data-draggable]'), { key: 'ArrowRight', shiftKey: true });
        expect(handlers.onStop).toHaveBeenCalledWith('f-1', 1, 75, 95);
    });

    it('resizes with Alt and keeps the field inside the page', () => {
        const { container } = renderField({ x: 10, y: 20, width: 25, height: 5 });
        fireEvent.keyDown(box(container), { key: 'ArrowRight', altKey: true });
        expect(handlers.onResize).toHaveBeenCalledWith('f-1', 26, 5);

        handlers.onResize.mockClear();
        fireEvent.keyDown(box(container), { key: 'ArrowDown', altKey: true });
        expect(handlers.onResize).toHaveBeenCalledWith('f-1', 25, 6);
    });

    it('never resizes below one percent', () => {
        const { container } = renderField({ width: 1, height: 1 });
        fireEvent.keyDown(box(container), { key: 'ArrowLeft', altKey: true });
        expect(handlers.onResize).toHaveBeenCalledWith('f-1', 1, 1);
    });

    it('ignores keys outside the placement contract', () => {
        const { container } = renderField();
        fireEvent.keyDown(box(container), { key: 'Enter' });
        fireEvent.keyDown(box(container), { key: 'a' });
        expect(handlers.onStop).not.toHaveBeenCalled();
        expect(handlers.onResize).not.toHaveBeenCalled();
    });
});

