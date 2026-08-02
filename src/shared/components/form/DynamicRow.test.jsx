import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DynamicRow from './DynamicRow';

function Harness({ listKey = 'employers', initial = [] }) {
  const [formData, setFormData] = useState({ [listKey]: initial });
  const updateFormData = (name, value) => {
    setFormData((prev) => ({
      ...prev,
      [name]: typeof value === 'function' ? value(prev[name]) : value,
    }));
  };
  return (
    <DynamicRow
      listKey={listKey}
      formData={formData}
      updateFormData={updateFormData}
      initialItemState={{ companyName: '', dotNumber: '' }}
      addButtonLabel="+ Add"
      renderRow={(index, item, onRowChange) => (
        <div>
          <span data-testid={`name-${index}`}>{item.companyName}</span>
          <span data-testid={`dot-${index}`}>{item.dotNumber}</span>
          <button
            type="button"
            onClick={() => {
              onRowChange('companyName', 'Acme LLC');
              onRowChange('dotNumber', '999');
            }}
          >
            Simulate FMCSA multi-field apply
          </button>
        </div>
      )}
    />
  );
}

describe('DynamicRow', () => {
  it('merges multiple same-tick field updates into one row (FMCSA autofill)', () => {
    render(<Harness initial={[{ id: 1, companyName: '', dotNumber: '' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Simulate FMCSA multi-field apply/i }));
    expect(screen.getByTestId('name-0')).toHaveTextContent('Acme LLC');
    expect(screen.getByTestId('dot-0')).toHaveTextContent('999');
  });
});
