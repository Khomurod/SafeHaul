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
});
