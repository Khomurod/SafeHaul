import React, { useState } from 'react';
import { FileText, Inbox } from '../../icons';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { TabList, TabPanel, tabIds } from './Tabs';

const TABS = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'templates', label: 'Templates' },
  { id: 'archive', label: 'Archive', icon: Inbox },
];

function Harness({
  initial = 'documents', orientation = 'horizontal', variant, fitted,
}) {
  const [active, setActive] = useState(initial);
  return (
    <>
      <TabList
        ariaLabel="Documents workspace views"
        idBase="docs"
        tabs={TABS}
        activeTab={active}
        onChange={setActive}
        orientation={orientation}
        {...(variant ? { variant } : {})}
        {...(fitted ? { fitted } : {})}
      />
      <TabPanel idBase="docs" tabId={active}>Panel for {active}</TabPanel>
    </>
  );
}

describe('TabList structure', () => {
  it('exposes a named tablist with one tab per entry', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Documents workspace views' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('refuses a tablist with no name', () => {
    // "tab list" is not a name. Two of the nine hand-rolled copies had none.
    expect(() => render(<TabList idBase="x" tabs={TABS} activeTab="documents" onChange={vi.fn()} />))
      .toThrow(/requires an ariaLabel/i);
  });

  it('refuses an empty tablist', () => {
    expect(() => render(<TabList ariaLabel="Views" idBase="x" tabs={[]} activeTab="" onChange={vi.fn()} />))
      .toThrow(/at least one tab/i);
  });

  it('keeps exactly one tab in the tab order', () => {
    // Roving tabIndex. Without it, a ten-tab strip costs ten Tab presses to
    // walk past — which is what a `role="tab"` with no roving index produces.
    render(<Harness />);
    const inOrder = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') === '0');
    expect(inOrder).toHaveLength(1);
    expect(inOrder[0]).toHaveAccessibleName('Documents');
  });

  /*
   * `aria-selected` is the whole mechanism, and the accessible name is only the
   * label.
   *
   * This component used to append a visually-hidden " (selected)" as well, so
   * that selection was "not colour alone". It made the selected tab announce its
   * state twice, and it put state inside the NAME — which means every exact-match
   * query for a tab has to know about it. The visual half of that concern is
   * handled in `Tabs.css`, where a `forced-colors` rule keeps the selected tab
   * distinguishable by a border that is present against ones that are not.
   */
  it('carries selection in aria-selected and keeps it out of the name', () => {
    render(<Harness />);
    const selected = screen.getByRole('tab', { selected: true });
    expect(selected).toHaveAccessibleName('Documents');
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveAttribute('aria-selected', 'false');
  });
});

/**
 * The two strip shapes, and the reason they are props rather than call-site CSS.
 *
 * Eleven hand-rolled strips carried at least three treatments between them. A
 * primitive that could express only the page-level underline would have left the
 * others hand-rolled, which is how a primitive ends up with zero consumers — as
 * this one did for the four days between being built and being adopted.
 */
describe('TabList shapes', () => {
  it('defaults to the underline strip', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist')).toHaveAttribute('data-variant', 'underline');
    expect(screen.getByRole('tablist')).not.toHaveAttribute('data-fitted');
  });

  it('takes the pill variant for a strip inside a panel', () => {
    render(<Harness variant="pill" />);
    expect(screen.getByRole('tablist')).toHaveAttribute('data-variant', 'pill');
  });

  it('takes fitted for a strip that must span its container', () => {
    render(<Harness fitted />);
    expect(screen.getByRole('tablist')).toHaveAttribute('data-fitted', 'true');
  });

  it('keeps the same keyboard model in every shape', () => {
    // The shapes differ in the selected treatment and nothing else. If a variant
    // ever changed the interaction it would stop being the same control.
    render(<Harness variant="pill" fitted />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Archive');
  });

  it('refuses an unsupported variant rather than ignoring it', () => {
    expect(() => render(<Harness variant="ghost" />)).toThrow(/Unsupported TabList variant/i);
  });

  it('refuses the one combination it does not support', () => {
    // A silently-ignored combination is how a component starts lying about what
    // it supports.
    expect(() => render(<Harness variant="pill" orientation="vertical" />))
      .toThrow(/does not support variant="pill"/i);
  });

  it('has no accessibility violations in either shape', async () => {
    const pill = render(<Harness variant="pill" />);
    expect((await axe(pill.container)).violations).toEqual([]);
    pill.unmount();
    const fitted = render(<Harness fitted />);
    expect((await axe(fitted.container)).violations).toEqual([]);
  });
});

/**
 * The keyboard model seven files had each re-derived. Every assertion here
 * matches what those copies did, so migrating them changes no behaviour.
 */
describe('TabList keyboard model', () => {
  const arrow = (key) => fireEvent.keyDown(screen.getByRole('tablist'), { key });

  it('moves to the next and previous tab with the arrow keys', () => {
    render(<Harness />);
    arrow('ArrowRight');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Templates/);
    arrow('ArrowLeft');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Documents/);
  });

  it('wraps at both ends', () => {
    render(<Harness />);
    arrow('ArrowLeft');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Archive/);
    arrow('ArrowRight');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Documents/);
  });

  it('jumps to the first and last tab with Home and End', () => {
    render(<Harness initial="templates" />);
    arrow('End');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Archive/);
    arrow('Home');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Documents/);
  });

  it('moves focus with the selection', () => {
    render(<Harness />);
    arrow('ArrowRight');
    expect(document.activeElement).toHaveAccessibleName(/Templates/);
  });

  it('uses the vertical arrows when the strip is vertical', () => {
    render(<Harness orientation="vertical" />);
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    arrow('ArrowDown');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Templates/);
    // The horizontal arrows must not also move, or a vertical strip inside a
    // horizontally scrolling region hijacks the scroll keys.
    arrow('ArrowRight');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Templates/);
  });

  it('leaves other keys to the page', () => {
    render(<Harness />);
    arrow('a');
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/Documents/);
  });
});

describe('TabPanel wiring', () => {
  it('links the panel to its tab in both directions', () => {
    render(<Harness />);
    const tab = screen.getByRole('tab', { selected: true });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  /*
   * `aria-controls` on an unselected tab pointed at a panel id that does not
   * exist, because only the active panel is rendered. The ARIA tab pattern makes
   * the attribute optional in exactly that case, and a dangling IDREF is worse
   * than an absent optional attribute.
   */
  it('does not leave a dangling aria-controls on the unselected tabs', () => {
    render(<Harness />);
    for (const tab of screen.getAllByRole('tab')) {
      const controls = tab.getAttribute('aria-controls');
      if (tab.getAttribute('aria-selected') === 'true') {
        expect(document.getElementById(controls)).not.toBeNull();
      } else {
        expect(controls).toBeNull();
      }
    }
  });

  it('derives the same ids from the same base in both components', () => {
    // The two are separate exports because two consumers render them in
    // different components; this is what stops the pair drifting apart.
    expect(tabIds('docs', 'templates')).toEqual({
      tabId: 'docs-tab-templates',
      panelId: 'docs-panel-templates',
    });
  });

  it('refuses an empty id base rather than emitting undefined ids', () => {
    expect(() => tabIds('', 'x')).toThrow(/non-empty idBase/i);
  });

  it('makes the panel focusable so keyboard focus lands in the content', () => {
    render(<Harness />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
  });

  it('forwards its ref, because the panel is a real focus target', () => {
    // The driver dossier passes it to `Modal`'s `initialFocusRef`, so opening
    // the dialog lands the user in the content instead of on its close button.
    const ref = React.createRef();
    render(<TabPanel ref={ref} idBase="docs" tabId="documents">body</TabPanel>);
    expect(ref.current).toBe(screen.getByRole('tabpanel'));
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
