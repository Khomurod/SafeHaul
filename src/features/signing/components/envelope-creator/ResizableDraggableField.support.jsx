// Focused coverage for the placed-field overlay. The drag/resize mathematics is
// this component's real contract — every percentage conversion, bound, floor and
// callback payload is pinned here so the migration cannot move a field by a
// pixel. All fixtures are artificial.
//
// =====================================================================
// Shared harness for the ResizableDraggableField suites. `vi.mock` is
// hoisted per file, so each suite keeps its own registration, whose factory
// delegates to `reactDraggableMock()` below. This module must not import the
// component (it imports the mocked react-draggable) — each suite imports it
// and passes it to `makeRenderField`. `handlers` is an ESM live binding so
// the tests read the spies `resetHarness` installed for that test.
// =====================================================================

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

// react-draggable is replaced with a transparent harness that records the props
// it was given and lets a test invoke onStop with a chosen pixel position, so
// the conversion maths can be asserted without a real pointer gesture.
export const draggableProps = { current: null };
export const reactDraggableMock = () => ({
    default: ({ children, ...props }) => {
        draggableProps.current = props;
        return React.cloneElement(children, { 'data-draggable': 'true' });
    },
});

// --- fixtures and helpers, verbatim ----------------------------------------

export const PAGE_WIDTH = 800;
export const PAGE_HEIGHT = 1000;

export function icon(type) {
    return <span data-testid={`icon-${type}`} />;
}

export let handlers;

export function makeField(overrides = {}) {
    return {
        id: 'f-1',
        type: 'text',
        label: 'Full Name',
        page: 1,
        x: 10,
        y: 20,
        width: 25,
        height: 5,
        ...overrides,
    };
}

/**
 * The original `renderField`, verbatim, except the component arrives as an
 * argument: each suite imports it after its own hoisted mock.
 */
export const makeRenderField = (ResizableDraggableField) => (fieldOverrides = {}, propOverrides = {}) => {
    const field = makeField(fieldOverrides);
    const utils = render(
        <ResizableDraggableField
            field={field}
            pageNum={1}
            pageWidth={PAGE_WIDTH}
            pageHeight={PAGE_HEIGHT}
            getIcon={icon}
            isSelected={false}
            {...handlers}
            {...propOverrides}
        />,
    );
    return { field, ...utils };
};

/** Simulates a full resize gesture through the window-level listeners.
 *  The handle only exists on the selected field, so callers render selected. */
export function resizeBy(container, dx, dy) {
    const handle = container.querySelector('.resize-handle');
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
    fireEvent(window, new MouseEvent('mousemove', { clientX: 100 + dx, clientY: 100 + dy }));
    fireEvent(window, new MouseEvent('mouseup', {}));
}

/** The original suite's `beforeEach` body, verbatim, for each suite to call. */
export function resetHarness() {
    draggableProps.current = null;
    handlers = {
        onStop: vi.fn(),
        onResize: vi.fn(),
        onRemove: vi.fn(),
        onLabelChange: vi.fn(),
        onSelect: vi.fn(),
    };
}
