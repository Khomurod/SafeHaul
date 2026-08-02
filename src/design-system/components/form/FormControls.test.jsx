import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import {
  FieldDisplay,
  FormField,
  FormSection,
  Input,
  Select,
  Textarea,
} from './FormControls';

describe('form controls', () => {
  it('connects labels, descriptions, errors, and required state', () => {
    render(
      <FormField
        id="display-name"
        label="Display name"
        description="Shown to other users."
        error="Enter a display name."
        required
      >
        <Input name="displayName" />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: /display name/i });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Shown to other users. Enter a display name.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a display name.');
  });

  it('preserves native events and native disabled/read-only behavior', () => {
    const onChange = vi.fn();
    render(
      <>
        <FormField id="editable" label="Editable">
          <Input value="" onChange={onChange} />
        </FormField>
        <FormField
          id="email"
          label="Email"
          description="This value cannot be changed."
        >
          <Input value="person@example.com" readOnly />
        </FormField>
        <FormField id="disabled" label="Disabled">
          <Input value="Unavailable" disabled />
        </FormField>
      </>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Editable' }), {
      target: { value: 'Updated' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Disabled' })).toBeDisabled();
  });

  it('provides the same field contract to textarea and select controls', () => {
    render(
      <>
        <FormField id="notes" label="Notes">
          <Textarea defaultValue="Existing notes" />
        </FormField>
        <FormField id="role" label="Role">
          <Select defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </FormField>
      </>,
    );

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Existing notes');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('member');
  });

  it('presents read-only values without adding form controls to keyboard order', () => {
    render(
      <FieldDisplay label="Company name" emphasis="strong">
        A very long logistics company name that must wrap safely
      </FieldDisplay>,
    );

    expect(screen.getByText('Company name')).toBeInTheDocument();
    expect(screen.getByText(/A very long logistics/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders a labelled form section without structural accessibility violations', async () => {
    const { container } = render(
      <FormSection title="Profile details" description="Update your information.">
        <FormField id="name" label="Name">
          <Input />
        </FormField>
      </FormSection>,
    );

    expect(screen.getByRole('region', { name: 'Profile details' })).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
});
