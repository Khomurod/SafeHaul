import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Checkbox, ChoiceGroup, Radio } from './ChoiceControls';

describe('Checkbox', () => {
  it('associates its label, description and error with the control', () => {
    render(
      <Checkbox
        id="agree"
        label="I Agree"
        description="You are agreeing to the terms."
        error="This must be checked."
        required
        checked={false}
        onChange={() => {}}
      />,
    );

    const box = screen.getByRole('checkbox', { name: /I Agree required/i });
    expect(box).toBeRequired();
    expect(box).toHaveAttribute('aria-required', 'true');
    expect(box).toHaveAttribute('aria-invalid', 'true');

    const describedBy = box.getAttribute('aria-describedby').split(' ');
    expect(describedBy).toContain('agree-description');
    expect(describedBy).toContain('agree-error');
    expect(screen.getByRole('alert')).toHaveTextContent('This must be checked.');
  });

  it('emits native change events and reflects checked state', () => {
    const onChange = vi.fn();
    render(<Checkbox id="opt" label="Optional" checked onChange={onChange} />);

    const box = screen.getByRole('checkbox', { name: 'Optional' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('is togglable by clicking its own label text', () => {
    const onChange = vi.fn();
    render(<Checkbox id="lbl" label="Click me" checked={false} onChange={onChange} />);

    fireEvent.click(screen.getByText('Click me'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('adds no error wiring when valid', () => {
    render(<Checkbox id="clean" label="Clean" checked={false} onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Clean' });
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects a missing label', () => {
    expect(() => render(<Checkbox label="" />)).toThrow(/non-empty label/);
  });
});

describe('Radio', () => {
  it('requires a grouping name', () => {
    expect(() => render(<Radio label="Yes" />)).toThrow(/non-empty name/);
  });

  it('keeps the native required attribute but drops the marker when the group carries it', () => {
    render(
      <ChoiceGroup legend="Consent" required>
        <Radio
          id="g-yes"
          name="g"
          value="yes"
          label="Yes"
          required
          requiredMark={false}
          checked={false}
          onChange={() => {}}
        />
      </ChoiceGroup>,
    );

    // Exact accessible name — no "Yes required" duplication of the legend marker.
    const yes = screen.getByRole('radio', { name: 'Yes' });
    expect(yes).toBeRequired();
    expect(yes).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('group', { name: /Consent required/i })).toBeInTheDocument();
  });

  it('groups options under one name so the browser owns arrow-key selection', () => {
    render(
      <>
        <Radio id="c-yes" name="consent" value="yes" label="Yes" checked onChange={() => {}} />
        <Radio id="c-no" name="consent" value="no" label="No" checked={false} onChange={() => {}} />
      </>,
    );

    const yes = screen.getByRole('radio', { name: 'Yes' });
    const no = screen.getByRole('radio', { name: 'No' });
    expect(yes).toHaveAttribute('name', 'consent');
    expect(no).toHaveAttribute('name', 'consent');
    expect(yes).toBeChecked();
    expect(no).not.toBeChecked();
  });
});

describe('ChoiceGroup', () => {
  it('names the group once through a real legend', () => {
    render(
      <ChoiceGroup legend="Can we send you SMS messages?" required>
        <Radio id="s-yes" name="sms" value="yes" label="Yes" checked={false} onChange={() => {}} />
        <Radio id="s-no" name="sms" value="no" label="No" checked={false} onChange={() => {}} />
      </ChoiceGroup>,
    );

    const group = screen.getByRole('group', { name: /Can we send you SMS messages\? required/i });
    expect(group.tagName).toBe('FIELDSET');
    // The question is not repeated inside each option's own accessible name.
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeInTheDocument();
  });

  it('links its description and error to the group', () => {
    render(
      <ChoiceGroup legend="Pick one" description="Only one answer." error="Answer is required.">
        <Radio id="p-a" name="pick" value="a" label="A" checked={false} onChange={() => {}} />
      </ChoiceGroup>,
    );

    const group = screen.getByRole('group', { name: 'Pick one' });
    const describedBy = group.getAttribute('aria-describedby').split(' ');
    expect(describedBy).toHaveLength(2);
    expect(screen.getByText('Only one answer.').id).toBe(describedBy[0]);
    expect(screen.getByRole('alert')).toHaveTextContent('Answer is required.');
  });

  it('exposes orientation as data, not as a colour or layout hack', () => {
    const { container } = render(
      <ChoiceGroup legend="Row" orientation="horizontal">
        <Radio id="r-a" name="row" value="a" label="A" checked={false} onChange={() => {}} />
      </ChoiceGroup>,
    );
    expect(container.querySelector('.ds-choice-group')).toHaveAttribute('data-orientation', 'horizontal');
  });

  it('rejects unsupported orientation and empty legend', () => {
    expect(() => render(<ChoiceGroup legend="X" orientation="diagonal">{null}</ChoiceGroup>))
      .toThrow(/Unsupported ChoiceGroup orientation/);
    expect(() => render(<ChoiceGroup legend="  ">{null}</ChoiceGroup>))
      .toThrow(/non-empty legend/);
  });
});

describe('ChoiceGroup appearance="card"', () => {
  function RoleCards({ value = 'standard', onChange = () => {} }) {
    return (
      <ChoiceGroup legend="Access" required appearance="card" orientation="horizontal">
        <Radio
          id="access-standard"
          name="access"
          value="standard"
          label="Standard"
          description="Sees their own records."
          required
          requiredMark={false}
          checked={value === 'standard'}
          onChange={onChange}
        />
        <Radio
          id="access-full"
          name="access"
          value="full"
          label="Full access"
          description="Sees everything and changes settings."
          required
          requiredMark={false}
          checked={value === 'full'}
          onChange={onChange}
        />
      </ChoiceGroup>
    );
  }

  it('marks the group for the card treatment and leaves the default unmarked', () => {
    const { container, rerender } = render(<RoleCards />);
    expect(container.querySelector('.ds-choice-group')).toHaveAttribute('data-appearance', 'card');
    rerender(
      <ChoiceGroup legend="Plain">
        <Radio id="plain-a" name="plain" value="a" label="A" checked={false} onChange={() => {}} />
      </ChoiceGroup>,
    );
    expect(container.querySelector('.ds-choice-group')).not.toHaveAttribute('data-appearance');
  });

  it('stays a group of native radios: one name, a description each, the question asked once', () => {
    render(<RoleCards />);
    expect(screen.getByRole('group', { name: /Access required/ }).tagName).toBe('FIELDSET');
    const standard = screen.getByRole('radio', { name: 'Standard' });
    const full = screen.getByRole('radio', { name: 'Full access' });
    expect(standard).toBeChecked();
    expect(full).not.toBeChecked();
    expect(full).toHaveAttribute('name', 'access');
    expect(full).toBeRequired();
    expect(full).toHaveAccessibleDescription('Sees everything and changes settings.');
  });

  it('chooses an option when its title is pressed, as a label does', () => {
    const onChange = vi.fn();
    render(<RoleCards onChange={onChange} />);
    fireEvent.click(screen.getByText('Full access'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe('full');
  });

  it('refuses an appearance it does not have', () => {
    expect(() => render(<ChoiceGroup legend="X" appearance="tiles">{null}</ChoiceGroup>))
      .toThrow(/Unsupported ChoiceGroup appearance: tiles/);
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(<RoleCards />);
    expect((await axe(container)).violations).toEqual([]);
  });

  /* jsdom lays nothing out; the rules that make a card a card are what is pinned. */
  it('draws a chosen card as SelectableCard draws a selected one, and stretches the label over the card', () => {
    const css = readFileSync(path.join(__dirname, 'ChoiceControls.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const checked = css.slice(css.indexOf(".ds-choice-group[data-appearance='card'] .ds-choice:has(.ds-choice__control:checked) {"));
    expect(checked).toMatch(/border-color:\s*var\(--ds-color-action-primary\)/);
    expect(checked).toMatch(/background:\s*var\(--ds-color-surface-selected\)/);
    expect(checked).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--ds-color-action-primary\)/);
    expect(css).toMatch(/\.ds-choice-group\[data-appearance='card'\] \.ds-choice__label::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/);
    // Hover never repaints a chosen card: the hover rule outranks the checked
    // one, so it must exclude it (a grey edge round the navy ring otherwise).
    const hover = css.match(/\.ds-choice-group\[data-appearance='card'\] \.ds-choice:hover[^{]*\{/);
    expect(hover?.[0]).toContain(':not(:has(.ds-choice__control:checked))');
    expect(hover?.[0]).toContain(':not(:has(.ds-choice__control:disabled))');
  });

  it('keeps a link in a card description and the error message above the stretched hit area', () => {
    const css = readFileSync(path.join(__dirname, 'ChoiceControls.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const lifted = css.match(
      /\.ds-choice-group\[data-appearance='card'\] \.ds-choice__description :is\(a, button\),\s*\.ds-choice-group\[data-appearance='card'\] \.ds-choice \.ds-field-message\s*\{([^}]*)\}/,
    );
    expect(lifted?.[1]).toMatch(/position:\s*relative;/);
    expect(lifted?.[1]).toMatch(/z-index:\s*var\(--ds-z-layer-1\);/);
  });
});
