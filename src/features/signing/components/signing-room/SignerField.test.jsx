// Focused coverage for the signer-facing field overlays. The accessible naming is
// the point of this suite: these controls sit absolutely positioned over a PDF
// with no room for a visible label, and a signer must be able to tell which
// control they are operating on a legally binding document. All fixtures are
// artificial.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignerField } from './SignerField';

let handlers;

function makeField(overrides = {}) {
    return { id: 'f-1', type: 'text', label: 'Full Name', pageNumber: 1, x: 10, y: 10, width: 25, height: 5, ...overrides };
}

function renderField(fieldOverrides = {}, props = {}) {
    const field = makeField(fieldOverrides);
    return {
        field,
        ...render(
            <SignerField
                field={field}
                signed={false}
                fieldValues={props.fieldValues || {}}
                {...handlers}
                {...props}
            />,
        ),
    };
}

beforeEach(() => {
    handlers = {
        handleFieldChange: vi.fn(),
        handleFieldFocus: vi.fn(),
        handleEnterAdvance: vi.fn(() => vi.fn()),
        handleSignatureTap: vi.fn(),
    };
});

describe('SignerField — accessible naming (P1 from review on PR #112)', () => {
    it('distinguishes two identically labelled checkboxes by position', () => {
        const first = renderField({ id: 'c1', type: 'checkbox', label: 'Checkbox' }, { fieldPosition: 2, fieldTotal: 5 });
        expect(screen.getByRole('checkbox', { name: 'Checkbox, field 2 of 5 on page 1' })).toBeInTheDocument();
        first.unmount();

        renderField({ id: 'c2', type: 'checkbox', label: 'Checkbox' }, { fieldPosition: 4, fieldTotal: 5 });
        expect(screen.getByRole('checkbox', { name: 'Checkbox, field 4 of 5 on page 1' })).toBeInTheDocument();
    });

    it('falls back to the field type when the author supplied no label', () => {
        renderField({ type: 'checkbox', label: '' }, { fieldPosition: 1, fieldTotal: 3 });
        expect(screen.getByRole('checkbox', { name: 'checkbox field, field 1 of 3 on page 1' })).toBeInTheDocument();
    });

    it('names the date control with its position and page', () => {
        renderField({ type: 'date', label: 'Date Signed', pageNumber: 2 }, { fieldPosition: 3, fieldTotal: 3 });
        expect(screen.getByLabelText('Date Signed, field 3 of 3 on page 2')).toHaveAttribute('type', 'date');
    });

    it('names the text control with its position and page', () => {
        renderField({}, { fieldPosition: 1, fieldTotal: 2 });
        expect(screen.getByRole('textbox', { name: 'Full Name, field 1 of 2 on page 1' })).toBeInTheDocument();
    });

    it('still names a control when no position is supplied', () => {
        renderField({ type: 'checkbox', label: 'Consent' });
        expect(screen.getByRole('checkbox', { name: 'Consent, page 1' })).toBeInTheDocument();
    });

    it('trims a whitespace-only label rather than producing a blank name', () => {
        renderField({ type: 'checkbox', label: '   ' }, { fieldPosition: 1, fieldTotal: 1 });
        expect(screen.getByRole('checkbox', { name: 'checkbox field, field 1 of 1 on page 1' })).toBeInTheDocument();
    });
});

describe('SignerField — frozen behaviour', () => {
    it('renders nothing once the document is signed', () => {
        const { container } = render(
            <SignerField field={makeField()} signed fieldValues={{}} {...handlers} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('reports text edits by field id', () => {
        renderField({}, { fieldPosition: 1, fieldTotal: 1 });
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pat Example' } });
        expect(handlers.handleFieldChange).toHaveBeenCalledWith('f-1', 'Pat Example');
    });

    it('reports checkbox state as a boolean', () => {
        renderField({ type: 'checkbox' }, { fieldPosition: 1, fieldTotal: 1 });
        fireEvent.click(screen.getByRole('checkbox'));
        expect(handlers.handleFieldChange).toHaveBeenCalledWith('f-1', true);
    });

    it('keeps the data-signer-input hook the E2E specs drive', () => {
        const { container } = renderField({}, { fieldPosition: 1, fieldTotal: 1 });
        expect(container.querySelector('[data-signer-input="f-1"]')).not.toBeNull();
    });

    it('renders a locked field as static text with no control', () => {
        renderField({ readOnly: true, prefillPolicy: 'locked', defaultValue: '2026-01-01', type: 'date' });
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByText('2026-01-01')).toBeInTheDocument();
    });

    it('opens the signature sheet from the signature placeholder', () => {
        renderField({ type: 'signature', label: 'Signature' }, { fieldPosition: 1, fieldTotal: 1 });
        fireEvent.click(screen.getByRole('button', { name: 'Tap to sign' }));
        expect(handlers.handleSignatureTap).toHaveBeenCalledTimes(1);
    });

    it('keeps the redraw wording once ink exists', () => {
        renderField({ type: 'initial' }, { fieldValues: { 'f-1': 'data:image/png;base64,artificial' }, fieldPosition: 1, fieldTotal: 1 });
        expect(screen.getByRole('button', { name: 'Initials added — tap to redraw' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Your initials' })).toBeInTheDocument();
    });
});

describe('SignerField — presentation', () => {
    it('uses no legacy palette classes, raw hex or unsupported small text', () => {
        for (const type of ['text', 'date', 'checkbox', 'signature', 'initial']) {
            const view = renderField({ type }, { fieldPosition: 1, fieldTotal: 1 });
            expect(view.container.innerHTML).not.toMatch(/(bg|text|border|accent)-(gray|blue|green|orange|yellow|purple)-\d{2,3}/);
            expect(view.container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
            expect(view.container.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
            view.unmount();
        }
    });

    it('gates the attention pulse behind reduced motion', () => {
        const { container } = renderField({ type: 'signature' }, { fieldPosition: 1, fieldTotal: 1 });
        expect(container.innerHTML).toContain('motion-safe:animate-pulse');
        expect(container.innerHTML).not.toMatch(/(?<!motion-safe:)animate-pulse/);
    });

    it('gives the signature placeholder a visible focus treatment', () => {
        renderField({ type: 'signature' }, { fieldPosition: 1, fieldTotal: 1 });
        expect(screen.getByRole('button', { name: 'Tap to sign' }).className).toContain('focus-visible:shadow-ds-focus');
    });

    it('has no accessibility violations for any field type', async () => {
        for (const type of ['text', 'date', 'checkbox', 'signature', 'initial']) {
            const view = renderField({ type }, { fieldPosition: 1, fieldTotal: 1 });
            expect((await axe(view.container)).violations).toEqual([]);
            view.unmount();
        }
    });
});
