/**
 * `RadioGroup` compatibility contract, plus a regression freeze for the
 * duplicate-id defect that the design-system migration fixed.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RadioGroup from './RadioGroup';

const YES_NO = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];

describe('RadioGroup element-id contract', () => {
  it('generates the frozen `${name}-${value}` ids the E2E specs click', () => {
    render(
      <RadioGroup
        label="I Consent to MVR Check"
        name="consent-mvr"
        options={YES_NO}
        value=""
        onChange={vi.fn()}
        required
      />,
    );

    // `e2e/helpers/wizardHelpers.cjs` clicks `label[for="consent-mvr-yes"]`.
    expect(document.getElementById('consent-mvr-yes')).not.toBeNull();
    expect(document.getElementById('consent-mvr-no')).not.toBeNull();
    expect(document.querySelector('label[for="consent-mvr-yes"]')).not.toBeNull();
  });

  it('calls onChange with the field name and the option value', () => {
    const onChange = vi.fn();
    render(<RadioGroup label="SMS?" name="sms-consent" options={YES_NO} value="" onChange={onChange} />);

    fireEvent.click(document.querySelector('label[for="sms-consent-yes"]'));
    expect(onChange).toHaveBeenCalledWith('sms-consent', 'yes');
  });

  it('names the group once and does not repeat the required marker per option', () => {
    render(<RadioGroup label="Legally eligible to work in the U.S.?" name="legal-work" options={YES_NO} value="" onChange={vi.fn()} required />);

    expect(screen.getByRole('group', { name: /Legally eligible to work in the U\.S\.\? required/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeRequired();
    expect(screen.queryByRole('radio', { name: /Yes required/ })).toBeNull();
  });

  it('maps horizontal to the primitive orientation', () => {
    const { container, rerender } = render(
      <RadioGroup label="Q" name="q" options={YES_NO} value="" onChange={vi.fn()} />,
    );
    expect(container.querySelector('.ds-choice-group')).toHaveAttribute('data-orientation', 'horizontal');

    rerender(<RadioGroup label="Q" name="q" options={YES_NO} value="" onChange={vi.fn()} horizontal={false} />);
    expect(container.querySelector('.ds-choice-group')).toHaveAttribute('data-orientation', 'vertical');
  });
});

describe('RadioGroup repeated-row scoping (defect regression)', () => {
  /** Two rows of the same logical field, as `DynamicRow` renders them. */
  function TwoRows() {
    const [rows, setRows] = useState([{ commercial: 'no' }, { commercial: 'no' }]);
    const setRow = (index) => (name, value) =>
      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [name]: value } : r)));

    return (
      <>
        {rows.map((row, index) => (
          <RadioGroup
            key={index}
            label="Were you in a commercial vehicle?"
            name="commercial"
            idPrefix={`accident-commercial-${index}`}
            groupName={`accident-commercial-${index}`}
            options={YES_NO}
            value={row.commercial}
            onChange={setRow(index)}
          />
        ))}
        <span data-testid="row-0">{rows[0].commercial}</span>
        <span data-testid="row-1">{rows[1].commercial}</span>
      </>
    );
  }

  it('gives every row unique ids so a row label activates its own input', () => {
    render(<TwoRows />);

    expect(document.querySelectorAll('#accident-commercial-0-yes')).toHaveLength(1);
    expect(document.querySelectorAll('#accident-commercial-1-yes')).toHaveLength(1);
    // Before the fix both rows rendered `id="commercial-yes"`.
    expect(document.querySelectorAll('[id="commercial-yes"]')).toHaveLength(0);
  });

  it('does not group separate rows into one browser radio group', () => {
    render(<TwoRows />);
    expect(document.getElementById('accident-commercial-0-yes')).toHaveAttribute('name', 'accident-commercial-0');
    expect(document.getElementById('accident-commercial-1-yes')).toHaveAttribute('name', 'accident-commercial-1');
  });

  it('clicking row 2 changes row 2 only, and still writes the shared field key', () => {
    render(<TwoRows />);

    fireEvent.click(document.querySelector('label[for="accident-commercial-1-yes"]'));

    expect(screen.getByTestId('row-1')).toHaveTextContent('yes');
    expect(screen.getByTestId('row-0')).toHaveTextContent('no');
  });

  it('defaults idPrefix and groupName to name so single-instance ids are unchanged', () => {
    render(<RadioGroup label="TWIC?" name="has-twic" options={YES_NO} value="" onChange={vi.fn()} />);
    expect(document.getElementById('has-twic-no')).toHaveAttribute('name', 'has-twic');
  });
});
