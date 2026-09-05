// The placed-field overlay, part 2 of 2: appearance states, pointer
// selection order, and presentation.
// The shared harness — the react-draggable double, fixtures and helpers —
// lives in `ResizableDraggableField.support.jsx`; the registration below
// delegates to it. All fixtures are artificial.
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-draggable', async () => (await import('./ResizableDraggableField.support')).reactDraggableMock());

import { ResizableDraggableField } from './ResizableDraggableField';
import {
    makeRenderField,
    resetHarness,
    makeField,
    icon,
    handlers,
    PAGE_WIDTH,
    PAGE_HEIGHT,
} from './ResizableDraggableField.support';

const renderField = makeRenderField(ResizableDraggableField);

beforeEach(resetHarness);

describe('ResizableDraggableField — appearance states', () => {
    const box = (container) => container.querySelector('[data-draggable]');

    it('is a thin toned border over a translucent fill when unselected', () => {
        const { container } = renderField();
        const target = box(container);
        expect(target.className).toContain('border-ds-status-info-border');
        expect(target.className).not.toContain('border-2');
        expect(target.querySelector('[data-field-fill]').className).toContain('opacity-40');
    });

    it('states selection with a primary border, a ring and a heavier fill', () => {
        const { container } = renderField({}, { isSelected: true });
        const target = box(container);
        expect(target.className).toContain('border-ds-action-primary');
        expect(target.className).toContain('ring-2');
        expect(target.querySelector('[data-field-fill]').className).toContain('opacity-70');
    });

    it('distinguishes a field in a multi-selection from the one being edited', () => {
        const { container } = renderField({}, { isMultiSelected: true });
        const target = box(container);
        // In the selection: primary border and the heavier fill…
        expect(target.className).toContain('border-ds-action-primary');
        expect(target.querySelector('[data-field-fill]').className).toContain('opacity-70');
        // …but not the ring, which marks the single field the inspector shows.
        expect(target.className).not.toContain('ring-2');
        expect(target).toHaveAccessibleName(/, selected$/);
    });

    it('leaves an unselected field with no selected state to report', () => {
        const { container } = renderField();
        expect(box(container)).toHaveAccessibleName('Full Name, text field on page 1');
    });

    it('reveals the remove control and resize handle only on the selected field', () => {
        const { container, rerender } = renderField();
        expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
        expect(container.querySelector('.resize-handle')).toBeNull();

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
        expect(screen.getByRole('button', { name: 'Remove Full Name from page 1' })).toBeInTheDocument();
        expect(container.querySelector('.resize-handle')).not.toBeNull();
    });

    it('keeps the label editable whether or not the field is selected', () => {
        const { unmount } = renderField();
        expect(screen.getByRole('textbox', { name: /^Label for/ })).toBeInTheDocument();
        unmount();

        renderField({}, { isSelected: true });
        expect(screen.getByRole('textbox', { name: /^Label for/ })).toBeInTheDocument();
    });

    it('reports a Shift-click as an additive selection', () => {
        const { container } = renderField();
        fireEvent.click(box(container), { shiftKey: true });
        expect(handlers.onSelect).toHaveBeenCalledWith('f-1', { additive: true });
    });

    it('raises the selected field above its neighbours', () => {
        /*
         * The three states are LOCAL layers, not application ones: a field only
         * has to outrank the fields beside it, inside a PDF page that carries
         * `isolate` for exactly that reason. They were `z-50` / `z-[55]` /
         * `z-[60]`, which looked like the dialog scale and never was.
         */
        const plain = renderField();
        expect(box(plain.container).className).toContain('z-ds-layer-1');
        plain.unmount();

        const multi = renderField({}, { isMultiSelected: true });
        expect(box(multi.container).className).toContain('z-ds-layer-2');
        multi.unmount();

        const selected = renderField({}, { isSelected: true });
        expect(box(selected.container).className).toContain('z-ds-layer-3');
    });

    it('has no accessibility violations while selected', async () => {
        const { container } = renderField({}, { isSelected: true });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('ResizableDraggableField — pointer selection order', () => {
    const box = (container) => container.querySelector('[data-draggable]');

    it('lets the click own selection when a pointer press focused the field', () => {
        // A pointer press focuses before the click is dispatched. If focus also
        // selected, a Shift-click would select on focus and toggle straight back
        // out on click, leaving an empty selection.
        const { container } = renderField();
        const target = box(container);

        fireEvent.mouseDown(target);
        fireEvent.focus(target);
        expect(handlers.onSelect).not.toHaveBeenCalled();

        fireEvent.click(target, { shiftKey: true });
        expect(handlers.onSelect).toHaveBeenCalledTimes(1);
        expect(handlers.onSelect).toHaveBeenCalledWith('f-1', { additive: true });
    });

    it('still selects on focus when the keyboard got there', () => {
        const { container } = renderField();
        fireEvent.focus(box(container));
        expect(handlers.onSelect).toHaveBeenCalledWith('f-1');
    });

    it('selects on focus again after the pointer leaves the field', () => {
        const { container } = renderField();
        const target = box(container);

        fireEvent.mouseDown(target);
        fireEvent.focus(target);
        fireEvent.blur(target);
        handlers.onSelect.mockClear();

        // Tabbing back in is a keyboard focus again, not the earlier press.
        fireEvent.focus(target);
        expect(handlers.onSelect).toHaveBeenCalledWith('f-1');
    });
});

describe('ResizableDraggableField — presentation', () => {
    it.each([
        ['signature', 'warning'],
        ['initial', 'warning'],
        ['text', 'info'],
        ['date', 'success'],
        ['checkbox', 'accent'],
    ])('tones a %s field with the %s status tokens', (type, tone) => {
        const { container } = renderField({ type });
        const box = container.querySelector('[data-draggable]');
        expect(box.className).toContain(`border-ds-status-${tone}-border`);
        // The fill is a separate translucent layer so the PDF stays readable.
        const fill = box.querySelector('[data-field-fill]');
        expect(fill.className).toContain(`bg-ds-status-${tone}-bg`);
        expect(fill.className).toContain('opacity-40');
    });

    it('keeps the class names react-draggable cancels on', () => {
        const { container } = renderField({}, { isSelected: true });
        expect(container.querySelector('.resize-handle')).not.toBeNull();
        expect(container.querySelector('.label-input')).not.toBeNull();
    });

    it('no longer hides the resize affordance until hover', () => {
        const { container } = renderField({}, { isSelected: true });
        const handle = container.querySelector('.resize-handle');
        expect(handle.className).not.toContain('opacity-0');
        expect(handle.className).toContain('opacity-60');
    });

    it('uses no legacy palette, no raw hex and no 9px or 10px text', () => {
        const { container } = renderField();
        expect(container.innerHTML).not.toMatch(/bg-(yellow|orange|blue|green|purple)-\d{2,3}|bg-red-500|text-gray-600/);
        expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(container.innerHTML).not.toMatch(/text-\[9px\]|text-\[10px\]/);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderField();
        expect((await axe(container)).violations).toEqual([]);
    });
});
