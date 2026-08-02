import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FieldPropertiesPanel } from './FieldPropertiesPanel';

// Sub-slice B: presentation/accessibility only. These tests freeze every value
// and every updateActiveField call, including the paired writes that keep
// readOnly and prefillPolicy in sync.
const field = (over = {}) => ({
    id: 'f1',
    type: 'text',
    label: 'Artificial Label',
    required: true,
    readOnly: false,
    defaultValue: '',
    fontSize: 'Auto',
    ...over,
});

const getIcon = vi.fn(() => <svg data-testid="field-icon" />);

const setup = (over = {}) => {
    const updateActiveField = vi.fn();
    const props = { activeField: field(over.activeField), updateActiveField, getIcon, ...over };
    if (over.activeField !== undefined) props.activeField = over.activeField;
    return { updateActiveField, ...render(<FieldPropertiesPanel {...props} />) };
};

beforeEach(() => vi.clearAllMocks());

describe('FieldPropertiesPanel — rendering contract', () => {
    it('renders nothing without an active field', () => {
        const { container } = render(
            <FieldPropertiesPanel activeField={null} updateActiveField={vi.fn()} getIcon={getIcon} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the field type heading and delegates the icon to getIcon', () => {
        setup({ activeField: field({ type: 'date' }) });
        expect(screen.getByText('date Field')).toBeInTheDocument();
        expect(getIcon).toHaveBeenCalledWith('date');
        expect(screen.getByTestId('field-icon')).toBeInTheDocument();
    });
});

describe('FieldPropertiesPanel — label', () => {
    it('shows the current label with the frozen placeholder and a visible label', () => {
        setup();
        const input = screen.getByLabelText('Field Label');
        expect(input).toHaveValue('Artificial Label');
        expect(input).toHaveAttribute('type', 'text');
        expect(input).toHaveAttribute('placeholder', 'Field Label');
    });

    it('falls back to an empty string when the label is missing', () => {
        setup({ activeField: field({ label: undefined }) });
        expect(screen.getByLabelText('Field Label')).toHaveValue('');
    });

    it('updates the label with the exact value', () => {
        const { updateActiveField } = setup();
        fireEvent.change(screen.getByLabelText('Field Label'), { target: { value: 'Renamed' } });
        expect(updateActiveField).toHaveBeenCalledWith('label', 'Renamed');
    });
});

describe('FieldPropertiesPanel — option toggles', () => {
    it('reflects and toggles Required Field', () => {
        const { updateActiveField } = setup({ activeField: field({ required: true }) });
        const box = screen.getByRole('checkbox', { name: 'Required Field' });
        expect(box).toBeChecked();

        fireEvent.click(box);
        expect(updateActiveField).toHaveBeenCalledWith('required', false);
        expect(updateActiveField).toHaveBeenCalledTimes(1);
    });

    it('toggles Required Field on from false', () => {
        const { updateActiveField } = setup({ activeField: field({ required: false }) });
        expect(screen.getByRole('checkbox', { name: 'Required Field' })).not.toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Required Field' }));
        expect(updateActiveField).toHaveBeenCalledWith('required', true);
    });

    it('writes both readOnly and prefillPolicy when locking', () => {
        const { updateActiveField } = setup({ activeField: field({ readOnly: false }) });
        fireEvent.click(screen.getByRole('checkbox', { name: /Read Only/ }));

        expect(updateActiveField).toHaveBeenNthCalledWith(1, 'readOnly', true);
        expect(updateActiveField).toHaveBeenNthCalledWith(2, 'prefillPolicy', 'locked');
        expect(updateActiveField).toHaveBeenCalledTimes(2);
    });

    it('writes both readOnly and prefillPolicy when unlocking', () => {
        const { updateActiveField } = setup({ activeField: field({ readOnly: true }) });
        expect(screen.getByRole('checkbox', { name: /Read Only/ })).toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: /Read Only/ }));

        expect(updateActiveField).toHaveBeenNthCalledWith(1, 'readOnly', false);
        expect(updateActiveField).toHaveBeenNthCalledWith(2, 'prefillPolicy', 'editable');
    });

    it('keeps both toggles keyboard reachable', () => {
        setup();
        ['Required Field', /Read Only/].forEach((name) => {
            const box = screen.getByRole('checkbox', { name });
            box.focus();
            expect(box).toHaveFocus();
        });
    });
});

describe('FieldPropertiesPanel — prefill behavior', () => {
    it('derives the value from prefillPolicy when present', () => {
        setup({ activeField: field({ prefillPolicy: 'locked' }) });
        expect(screen.getByLabelText('Prefill Behavior')).toHaveValue('locked');
    });

    it.each([
        [true, 'locked'],
        [false, 'editable'],
    ])('falls back to readOnly=%s → %s', (readOnly, expected) => {
        setup({ activeField: field({ prefillPolicy: undefined, readOnly }) });
        expect(screen.getByLabelText('Prefill Behavior')).toHaveValue(expected);
    });

    it('offers the exact two options with their frozen labels', () => {
        setup();
        const select = screen.getByLabelText('Prefill Behavior');
        expect([...select.options].map(o => o.value)).toEqual(['editable', 'locked']);
        expect([...select.options].map(o => o.textContent)).toEqual([
            'Editable when prefilled',
            'Locked after prefill',
        ]);
    });

    it.each([
        ['locked', true],
        ['editable', false],
    ])('writes prefillPolicy=%s and the paired readOnly', (mode, expectedReadOnly) => {
        const { updateActiveField } = setup();
        fireEvent.change(screen.getByLabelText('Prefill Behavior'), { target: { value: mode } });

        expect(updateActiveField).toHaveBeenNthCalledWith(1, 'prefillPolicy', mode);
        expect(updateActiveField).toHaveBeenNthCalledWith(2, 'readOnly', expectedReadOnly);
        expect(updateActiveField).toHaveBeenCalledTimes(2);
    });
});

describe('FieldPropertiesPanel — default value and formatting', () => {
    it('shows the default value with the frozen placeholder and rows', () => {
        setup({ activeField: field({ defaultValue: 'seed' }) });
        const area = screen.getByLabelText('Default value');
        expect(area).toHaveValue('seed');
        expect(area).toHaveAttribute('placeholder', 'Enter default value...');
        expect(area).toHaveAttribute('rows', '3');
    });

    it('updates the default value with the exact value', () => {
        const { updateActiveField } = setup();
        fireEvent.change(screen.getByLabelText('Default value'), { target: { value: '{{full_name}}' } });
        expect(updateActiveField).toHaveBeenCalledWith('defaultValue', '{{full_name}}');
    });

    it('documents all four prefill tokens', () => {
        setup();
        ['{{full_name}}', '{{email}}', '{{phone}}', '{{current_date}}'].forEach((token) => {
            expect(screen.getByText(token)).toBeInTheDocument();
        });
    });

    it('offers the exact font-size options and updates with the exact value', () => {
        const { updateActiveField } = setup();
        const select = screen.getByLabelText('Font Size');
        expect(select).toHaveValue('Auto');
        expect([...select.options].map(o => o.value)).toEqual(['Auto', '10', '12', '14', '18']);
        expect([...select.options].map(o => o.textContent)).toEqual([
            'Auto (fit to box)', '10pt', '12pt', '14pt', '18pt',
        ]);

        fireEvent.change(select, { target: { value: '14' } });
        expect(updateActiveField).toHaveBeenCalledWith('fontSize', '14');
    });

    it('falls back to Auto when no font size is set', () => {
        setup({ activeField: field({ fontSize: undefined }) });
        expect(screen.getByLabelText('Font Size')).toHaveValue('Auto');
    });
});

describe('FieldPropertiesPanel — content-less field types', () => {
    it.each(['signature', 'initial', 'checkbox'])(
        'hides prefill, default value and formatting for %s fields',
        (type) => {
            setup({ activeField: field({ type }) });
            expect(screen.queryByLabelText('Prefill Behavior')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Default value')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Font Size')).not.toBeInTheDocument();
            expect(screen.queryByText('Default Value')).not.toBeInTheDocument();
            expect(screen.queryByText('Formatting')).not.toBeInTheDocument();
        },
    );

    it.each(['text', 'date'])('keeps all three sections for %s fields', (type) => {
        setup({ activeField: field({ type }) });
        expect(screen.getByLabelText('Prefill Behavior')).toBeInTheDocument();
        expect(screen.getByLabelText('Default value')).toBeInTheDocument();
        expect(screen.getByLabelText('Font Size')).toBeInTheDocument();
    });

    it('still shows the label and both toggles for content-less types', () => {
        setup({ activeField: field({ type: 'signature' }) });
        expect(screen.getByLabelText('Field Label')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Required Field' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /Read Only/ })).toBeInTheDocument();
    });
});

describe('FieldPropertiesPanel — presentation guardrails', () => {
    it('uses no unsupported 9px or 10px interface text', () => {
        const { container } = setup();
        expect(container.querySelector('[class*="text-[10px]"]')).toBeNull();
        expect(container.querySelector('[class*="text-[9px]"]')).toBeNull();
    });

    it('has no accessibility violations for a text field', async () => {
        const { container } = setup();
        expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });

    it('has no accessibility violations for a signature field', async () => {
        const { container } = setup({ activeField: field({ type: 'signature' }) });
        expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });
});
