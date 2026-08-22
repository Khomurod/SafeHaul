import React, { useState } from 'react';
import { FileText, Inbox } from 'lucide-react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { TabList, TabPanel, tabIds } from './Tabs';

const TABS = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'templates', label: 'Templates' },
  { id: 'archive', label: 'Archive', icon: Inbox },
];

function Harness({ initial = 'documents', orientation = 'horizontal' }) {
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
    expect(inOrder[0]).toHaveAccessibleName(/Documents/);
  });

  it('announces selection as text as well as colour', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName(/\(selected\)/);
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

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
