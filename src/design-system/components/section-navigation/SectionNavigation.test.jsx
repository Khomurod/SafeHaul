import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { SectionNavigation } from './SectionNavigation';

const groups = [
  {
    id: 'general',
    label: 'General',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'disabled', label: 'Unavailable', disabled: true },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'security', label: 'Security' },
      { id: 'billing', label: 'Billing' },
    ],
  },
];

describe('SectionNavigation', () => {
  it('provides grouped navigation and current-item semantics', () => {
    const onSelect = vi.fn();
    render(
      <SectionNavigation
        label="Settings sections"
        groups={groups}
        currentId="profile"
        controlsId="settings-panel"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Settings sections' }))
      .toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument();

    const profile = screen.getByRole('button', { name: 'Profile' });
    expect(profile).toHaveAttribute('aria-current', 'page');
    expect(profile).toHaveAttribute('aria-controls', 'settings-panel');

    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    expect(onSelect).toHaveBeenCalledWith('security');
  });

  it('moves focus with directional keys while skipping disabled items', () => {
    render(
      <SectionNavigation
        groups={groups}
        currentId="profile"
        onSelect={() => {}}
      />,
    );

    const profile = screen.getByRole('button', { name: 'Profile' });
    const security = screen.getByRole('button', { name: 'Security' });
    const billing = screen.getByRole('button', { name: 'Billing' });

    profile.focus();
    fireEvent.keyDown(profile, { key: 'ArrowDown' });
    expect(security).toHaveFocus();

    fireEvent.keyDown(security, { key: 'End' });
    expect(billing).toHaveFocus();

    fireEvent.keyDown(billing, { key: 'ArrowDown' });
    expect(profile).toHaveFocus();

    fireEvent.keyDown(profile, { key: 'ArrowUp' });
    expect(billing).toHaveFocus();

    fireEvent.keyDown(billing, { key: 'Home' });
    expect(profile).toHaveFocus();
  });

  it('retains native focus when an item is selected', () => {
    const onSelect = vi.fn();
    render(
      <SectionNavigation
        groups={groups}
        currentId="profile"
        onSelect={onSelect}
      />,
    );

    const security = screen.getByRole('button', { name: 'Security' });
    security.focus();
    fireEvent.click(security);

    expect(security).toHaveFocus();
    expect(onSelect).toHaveBeenCalledWith('security');
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <>
        <SectionNavigation
          label="Settings sections"
          groups={groups}
          currentId="profile"
          controlsId="settings-panel"
          onSelect={() => {}}
          mobileLayout="grid"
        />
        <section id="settings-panel" aria-label="Settings content" />
      </>,
    );

    expect((await axe(container)).violations).toEqual([]);
  });

  describe('wizard steps', () => {
    const steps = [{
      id: 'wizard',
      items: [
        { id: 'audience', label: 'Audience', status: 'complete' },
        { id: 'content', label: 'Content', status: 'incomplete' },
      ],
    }];

    it('says step rather than page when asked', () => {
      // `aria-current="step"` is what ARIA defines for a position in a process.
      // A wizard rail announcing "current page" tells a screen-reader user they
      // navigated somewhere they did not.
      render(<SectionNavigation groups={steps} currentId="content" currentType="step" onSelect={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Content/ })).toHaveAttribute('aria-current', 'step');
    });

    it('still says page by default, so no existing consumer moved', () => {
      render(<SectionNavigation groups={groups} currentId="profile" onSelect={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    });

    it('rejects a current type it does not have', () => {
      expect(() => render(<SectionNavigation groups={steps} currentType="location" onSelect={vi.fn()} />))
        .toThrow(/Unsupported SectionNavigation currentType/i);
    });

    /*
     * The exact strings, with the leading space. `CampaignEditor.test.jsx`
     * asserts both at four lines, and the space is what makes the announced
     * name "Audience (completed)" rather than "Audience(completed)".
     */
    it('speaks each step\'s completion as part of the item name', () => {
      render(<SectionNavigation groups={steps} currentId="content" currentType="step" onSelect={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Audience (completed)' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Content (incomplete)' })).toBeInTheDocument();
    });

    it('marks the status on the element, so the third grid column is scoped', () => {
      // The CSS adds a trailing track only for `[data-status]`. Measured in
      // Chromium: an unscoped `auto` track costs 12px of label width even when
      // empty, because grid gaps sit between every declared track. Every
      // existing consumer would have quietly lost that.
      render(<SectionNavigation groups={steps} currentId="content" currentType="step" onSelect={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Audience/ })).toHaveAttribute('data-status', 'complete');

      const { container } = render(<SectionNavigation groups={groups} currentId="profile" onSelect={vi.fn()} />);
      expect(container.querySelector('[data-status]')).toBeNull();
    });

    it('rejects a status it does not have', () => {
      const bad = [{ id: 'g', items: [{ id: 'a', label: 'A', status: 'pending' }] }];
      expect(() => render(<SectionNavigation groups={bad} onSelect={vi.fn()} />))
        .toThrow(/Unsupported SectionNavigation item status/i);
    });

    it('drops the frame when the container already draws one', () => {
      const { container } = render(
        <SectionNavigation groups={steps} currentId="content" frame="none" onSelect={vi.fn()} />,
      );
      expect(container.querySelector('.ds-section-navigation')).toHaveAttribute('data-frame', 'none');
    });

    it('keeps the card frame by default, so no existing consumer moved', () => {
      const { container } = render(<SectionNavigation groups={groups} currentId="profile" onSelect={vi.fn()} />);
      expect(container.querySelector('.ds-section-navigation')).not.toHaveAttribute('data-frame');
    });

    /*
     * A single-group rail has no heading to give a region, and a `<section>`
     * with no accessible name is a landmark element claiming nothing. So the
     * group falls back to a plain `<div>` — asserted both ways, because "no
     * heading rendered" and "no region exposed" are two different failures.
     */
    it('renders no heading and no region when a group has no label', () => {
      render(<SectionNavigation groups={steps} currentId="content" currentType="step" onSelect={vi.fn()} />);
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('has no axe violations as a step rail', async () => {
      const { container } = render(
        <SectionNavigation
          label="Campaign sections"
          groups={steps}
          currentId="content"
          currentType="step"
          frame="none"
          onSelect={vi.fn()}
        />,
      );
      expect((await axe(container)).violations).toEqual([]);
    });
  });
});
