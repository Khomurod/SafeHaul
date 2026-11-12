import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe, configureAxe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { CheckCircle2 } from '../../icons';
import { SectionNavigation } from './SectionNavigation';

/* axe ships Label in Name (WCAG 2.5.3) switched off; the settings rail failed it. */
const labelInNameAxe = configureAxe({ rules: { 'label-content-name-mismatch': { enabled: true } } });

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

  describe('item descriptions', () => {
    const described = [{
      id: 'company',
      label: 'Company',
      items: [
        { id: 'profile', label: 'Profile', description: 'Name, logo and address' },
        { id: 'team', label: 'Team', description: 'Who works here' },
        { id: 'plain', label: 'Plain' },
        // `null` is how React spells "none"; it is no description, not a bad one.
        { id: 'empty', label: 'Empty', description: null },
      ],
    }];

    it('draws a second line and keeps the item named by its label alone', () => {
      // Every caller — and every speech-input user — finds the item by its
      // label; the line is its description, not part of its name.
      render(<SectionNavigation groups={described} currentId="team" onSelect={vi.fn()} />);
      const team = screen.getByRole('button', { name: 'Team' });
      expect(team).toHaveAccessibleDescription('Who works here');
      expect(team).toHaveAttribute('aria-current', 'page');
      expect(team).toHaveAttribute('data-described');
      expect(team.closest('li')).toHaveAttribute('data-described');
    });

    /*
     * WCAG 2.5.3, Label in Name: every word a button SHOWS must be in its name.
     * With the line inside the button the visible text was "Team Who works
     * here" against the name "Team" — axe's `label-content-name-mismatch`, x7
     * on every settings page. So the line is the button's sibling, and the
     * button's own text is its name.
     */
    it('draws the line beside the button, not inside it, so the visible text is the name', () => {
      render(<SectionNavigation groups={described} currentId="team" onSelect={vi.fn()} />);
      const team = screen.getByRole('button', { name: 'Team' });
      expect(team).toHaveTextContent(/^Team$/);
      expect(team).not.toHaveAttribute('aria-labelledby');
      expect(team.querySelector('.ds-section-navigation__description')).toBeNull();
      const line = team.parentElement.querySelector(':scope > .ds-section-navigation__description');
      expect(line).toHaveTextContent('Who works here');
      expect(team).toHaveAttribute('aria-describedby', line.id);
    });

    it('raises no Label-in-Name finding (axe rule switched on: it is off by default)', async () => {
      const { container } = render(
        <SectionNavigation label="Settings sections" groups={described} currentId="team" onSelect={vi.fn()} />,
      );
      // jsdom draws nothing, so axe reports the old structure as "incomplete"
      // rather than a violation: both lists must stay clear of the rule.
      const results = await labelInNameAxe(container);
      expect([...results.violations, ...results.incomplete].map((finding) => finding.id))
        .not.toContain('label-content-name-mismatch');
    });

    it.each(['Plain', 'Empty'])('leaves an item without a description (%s) exactly as it was', (name) => {
      render(<SectionNavigation groups={described} currentId="team" onSelect={vi.fn()} />);
      const plain = screen.getByRole('button', { name });
      expect(plain).not.toHaveAttribute('aria-labelledby');
      expect(plain).not.toHaveAttribute('aria-describedby');
      expect(plain).not.toHaveAttribute('data-described');
      expect(plain.closest('li')).not.toHaveAttribute('data-described');
      expect(plain.querySelector('.ds-section-navigation__label')).not.toHaveAttribute('id');
      expect(plain.closest('li').querySelector('.ds-section-navigation__description')).toBeNull();
    });

    it('draws the described rail\'s glyph at 16px (C2), and leaves every other rail at 20px', () => {
      const withGlyphs = [{
        id: 'g',
        items: [
          { id: 'a', label: 'Alpha', icon: CheckCircle2, description: 'First line' },
          { id: 'b', label: 'Beta', icon: CheckCircle2 },
        ],
      }];
      render(<SectionNavigation groups={withGlyphs} currentId="a" onSelect={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Alpha' }).querySelector('.ds-section-navigation__icon'))
        .toHaveAttribute('data-size', 'md');
      expect(screen.getByRole('button', { name: 'Beta' }).querySelector('.ds-section-navigation__icon'))
        .toHaveAttribute('data-size', 'xl');
    });

    it('keeps the arrow keys moving between described items', () => {
      render(<SectionNavigation groups={described} currentId="team" onSelect={vi.fn()} />);
      const team = screen.getByRole('button', { name: 'Team' });
      team.focus();
      fireEvent.keyDown(team, { key: 'ArrowUp' });
      expect(screen.getByRole('button', { name: 'Profile' })).toHaveFocus();
    });

    it('keeps a step\'s completion in its name when it has a description', () => {
      const steps = [{
        id: 'wizard',
        items: [{ id: 'audience', label: 'Audience', status: 'complete', description: 'Who receives it' }],
      }];
      render(<SectionNavigation groups={steps} currentId="audience" currentType="step" onSelect={vi.fn()} />);
      const audience = screen.getByRole('button', { name: 'Audience (completed)' });
      expect(audience).toHaveAccessibleDescription('Who receives it');
    });

    it('still selects on activation', () => {
      const onSelect = vi.fn();
      render(<SectionNavigation groups={described} currentId="team" onSelect={onSelect} />);
      fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
      expect(onSelect).toHaveBeenCalledWith('profile');
    });

    it.each([[''], ['  '], [7]])('refuses a description of %j', (description) => {
      const bad = [{ id: 'g', items: [{ id: 'a', label: 'A', description }] }];
      expect(() => render(<SectionNavigation groups={bad} onSelect={vi.fn()} />))
        .toThrow(/SectionNavigation item description must be a non-empty string \(a\)/);
    });

    it('has no axe violations with descriptions', async () => {
      const { container } = render(
        <SectionNavigation label="Settings sections" groups={described} currentId="team" onSelect={vi.fn()} />,
      );
      expect((await axe(container)).violations).toEqual([]);
    });
  });

  /* jsdom lays nothing out; the C2 rail is pinned as rules. */
  describe('stylesheet', () => {
    const css = readFileSync(path.join(__dirname, 'SectionNavigation.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector) => {
      const start = css.indexOf(`${selector} {`);
      return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
    };

    it('tints the current item and inks it in the action navy, not the link blue', () => {
      expect(rule(".ds-section-navigation__item[data-current='true']"))
        .toMatch(/color:\s*var\(--ds-color-action-primary\)/);
      expect(rule(".ds-section-navigation__item[data-current='true']:not([data-described])"))
        .toMatch(/background:\s*var\(--ds-color-surface-selected\)/);
      // A described item's tint is its whole row's, not its first line's.
      expect(rule(".ds-section-navigation__item[data-described][data-current='true']::before"))
        .toMatch(/background:\s*var\(--ds-color-surface-selected\)/);
      expect(css).not.toMatch(/--ds-color-content-link/);
    });

    it('stretches a described button over its whole row: hit area, fill and focus ring', () => {
      expect(rule('.ds-section-navigation__list-item[data-described]')).toMatch(/position:\s*relative/);
      const box = rule('.ds-section-navigation__item[data-described]::before');
      expect(box).toMatch(/position:\s*absolute/);
      expect(box).toMatch(/inset:\s*0/);
      // The button itself must not be the containing block, or the box shrinks to the first line.
      expect(rule('.ds-section-navigation__item[data-described]')).not.toMatch(/position:/);
      expect(rule('.ds-section-navigation__item[data-described]:hover:not(:disabled):not([data-current=\'true\'])::before'))
        .toMatch(/background:\s*var\(--ds-color-surface-hover\)/);
      expect(rule('.ds-section-navigation__item[data-described]:focus-visible::before'))
        .toMatch(/outline:\s*2px solid var\(--ds-color-focus\)/);
      // The line lets the pointer through to the button beneath it.
      expect(rule('.ds-section-navigation__description')).toMatch(/pointer-events:\s*none/);
    });

    /*
     * No z-index (the stylesheet contract refuses a bare one, and the scale has
     * no negative step): the row's box is the button's FIRST pseudo-element and
     * everything drawn over it is positioned after it in tree order.
     */
    it('keeps the text over the row box by tree order, with no z-index', () => {
      expect(css).not.toMatch(/z-index/);
      expect(css).not.toMatch(/\[data-described\][^{]*::after/);
      expect(rule('.ds-section-navigation__item[data-described] > .ds-section-navigation__status'))
        .toMatch(/position:\s*relative/);
      expect(css).toMatch(/\.ds-section-navigation__item\[data-described\] > \.ds-section-navigation__icon,\s*\.ds-section-navigation__item\[data-described\] > \.ds-section-navigation__label,/);
      expect(rule('.ds-section-navigation__description')).toMatch(/position:\s*relative/);
      expect(rule('.ds-section-navigation__list-item[data-described]')).toMatch(/isolation:\s*isolate/);
    });

    it('keeps a cue that is not a colour: a semibold label, and a Highlight bar in forced colours', () => {
      expect(rule(".ds-section-navigation__item[data-current='true'] .ds-section-navigation__label"))
        .toMatch(/font-weight:\s*var\(--ds-font-weight-semibold\)/);
      expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*\[data-current='true'\]\s*\{\s*border-left-color:\s*Highlight/);
    });

    it('draws the rail as a card, from the card roles', () => {
      const frame = rule('.ds-section-navigation');
      expect(frame).toMatch(/border:\s*1px solid var\(--ds-card-border\)/);
      expect(frame).toMatch(/border-radius:\s*var\(--ds-card-radius\)/);
      expect(frame).toMatch(/box-shadow:\s*var\(--ds-card-shadow\)/);
    });

    it('puts a description in the label\'s column, wrapping', () => {
      const description = rule('.ds-section-navigation__description');
      // Edge, inset, glyph column and gap: where the button's label starts.
      expect(description).toMatch(/padding-inline:\s*calc\(3px \+ var\(--ds-space-3\) \+ 20px \+ var\(--ds-space-3\)\) var\(--ds-space-3\)/);
      expect(description).toMatch(/text-wrap:\s*pretty/);
      expect(description).not.toMatch(/ellipsis|nowrap/);
    });

    it('keeps a label and its description together in the phone grid: only the column gap tightens', () => {
      const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
      const item = phone.slice(phone.indexOf('.ds-section-navigation__item {'));
      const body = item.slice(0, item.indexOf('}'));
      expect(body).toMatch(/column-gap:\s*var\(--ds-space-2\)/);
      expect(body).not.toMatch(/(^|[^-])gap:/);
    });

    it('gives an item with no glyph no glyph column', () => {
      expect(rule('.ds-section-navigation__item:not(:has(> .ds-section-navigation__icon))'))
        .toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    });
  });
});
