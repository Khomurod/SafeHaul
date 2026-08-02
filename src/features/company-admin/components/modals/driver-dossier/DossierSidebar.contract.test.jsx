/**
 * Contract freeze for the Driver Dossier sidebar: the navigation item ids and
 * their order, the labels, the `setActiveTab` values, the identity presentation,
 * the DQ-incomplete indicator rule, and the contact link hrefs.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DossierSidebar } from './DossierSidebar';

afterEach(cleanup);

const baseProps = () => ({
  appData: {
    firstName: 'Maria',
    lastName: 'Garcia',
    email: 'maria@example.com',
    phone: '5125551234',
  },
  currentStatus: 'In Review',
  activeTab: 'application',
  setActiveTab: vi.fn(),
  loading: false,
  dqStatus: 'complete',
});

const renderSidebar = (overrides = {}) => {
  const props = { ...baseProps(), ...overrides };
  render(<DossierSidebar {...props} />);
  return props;
};

const TAB_ORDER = [
  ['application', 'Application'],
  ['documents', 'Documents'],
  ['dq', 'DQ File'],
  ['pev', 'Previous Employment'],
  ['activity', 'Activity'],
  ['notes', 'Notes'],
];

describe('DossierSidebar navigation contract', () => {
  it('keeps the six navigation items in their frozen order with frozen labels', () => {
    renderSidebar();
    const labels = screen
      .getAllByRole('tab')
      .map((el) => el.textContent.replace(/\s*\(selected\)\s*/, '').trim());
    expect(labels).toEqual(TAB_ORDER.map(([, label]) => label));
  });

  it.each(TAB_ORDER)('selecting %s emits that exact state value', (id, label) => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${label}`) }));
    expect(props.setActiveTab).toHaveBeenCalledWith(id);
  });

  it.each(TAB_ORDER)('marks %s selected when it is the active tab', (id) => {
    renderSidebar({ activeTab: id });
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });
});

describe('DossierSidebar tab semantics', () => {
  it('exposes a named tablist wiring every tab to the shared panel', () => {
    renderSidebar({ tabPanelId: 'panel-1', tabIdFor: (t) => `tab-${t}` });

    expect(screen.getByRole('tablist', { name: 'Driver dossier sections' })).toBeInTheDocument();
    screen.getAllByRole('tab').forEach((tab) => {
      expect(tab).toHaveAttribute('aria-controls', 'panel-1');
    });
    expect(screen.getByRole('tab', { name: /^Application/ })).toHaveAttribute('id', 'tab-application');
  });

  it('keeps only the selected tab in the tab order (roving tabindex)', () => {
    renderSidebar({ activeTab: 'documents' });
    const tabs = screen.getAllByRole('tab');
    const tabbable = tabs.filter((t) => t.getAttribute('tabindex') === '0');

    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName(/^Documents/);
  });
});

describe('DossierSidebar tab keyboard model', () => {
  // Automatic activation: Arrow/Home/End move focus AND select, so the panel
  // always matches the focused tab.
  const press = (key, activeTab = 'application') => {
    const props = renderSidebar({ activeTab });
    fireEvent.keyDown(screen.getByRole('tab', { name: new RegExp(`^${
      TAB_ORDER.find(([id]) => id === activeTab)[1]
    }`) }), { key });
    return props;
  };

  it.each([
    ['ArrowDown', 'application', 'documents'],
    ['ArrowRight', 'application', 'documents'],
    ['ArrowUp', 'documents', 'application'],
    ['ArrowLeft', 'documents', 'application'],
  ])('%s from %s selects %s', (key, from, expected) => {
    const props = press(key, from);
    expect(props.setActiveTab).toHaveBeenCalledWith(expected);
  });

  it('wraps forward from the last tab to the first', () => {
    const props = press('ArrowDown', 'notes');
    expect(props.setActiveTab).toHaveBeenCalledWith('application');
  });

  it('wraps backward from the first tab to the last', () => {
    const props = press('ArrowUp', 'application');
    expect(props.setActiveTab).toHaveBeenCalledWith('notes');
  });

  it('Home selects the first tab and End the last', () => {
    expect(press('Home', 'dq').setActiveTab).toHaveBeenCalledWith('application');
    cleanup();
    expect(press('End', 'dq').setActiveTab).toHaveBeenCalledWith('notes');
  });

  it('moves DOM focus onto the newly selected tab', () => {
    renderSidebar({ activeTab: 'application' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Application/ }), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Documents/ }));
  });

  it('leaves other keys to the browser', () => {
    const props = renderSidebar();
    const tab = screen.getByRole('tab', { name: /^Application/ });
    fireEvent.keyDown(tab, { key: 'Tab' });
    fireEvent.keyDown(tab, { key: 'a' });
    expect(props.setActiveTab).not.toHaveBeenCalled();
  });
});

describe('DossierSidebar identity presentation', () => {
  it('shows the driver name and their status', () => {
    renderSidebar();
    expect(screen.getByText('Maria Garcia')).toBeInTheDocument();
    expect(screen.getByText('In Review')).toBeInTheDocument();
  });

  it('renders initials from the first and last name', () => {
    renderSidebar();
    expect(screen.getByText('MG')).toBeInTheDocument();
  });

  it('survives missing name parts without crashing', () => {
    renderSidebar({ appData: {} });
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });
});

describe('DossierSidebar DQ indicator', () => {
  it('flags an incomplete DQ file in text, not colour alone', () => {
    renderSidebar({ dqStatus: 'incomplete' });
    // DEFECT-FIX assertion: previously a bare coloured dot with no text.
    expect(screen.getByRole('tab', { name: /DQ File/ })).toHaveTextContent(/incomplete/i);
  });

  it('does not flag a complete DQ file', () => {
    renderSidebar({ dqStatus: 'complete' });
    expect(screen.getByRole('tab', { name: /DQ File/ })).not.toHaveTextContent(/incomplete/i);
  });
});

describe('DossierSidebar contact actions', () => {
  it('links phone and email with the frozen href schemes', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /call/i })).toHaveAttribute('href', 'tel:5125551234');
    expect(screen.getByRole('link', { name: /email/i })).toHaveAttribute('href', 'mailto:maria@example.com');
  });

  it('does not expose an actionable contact control when the value is missing', () => {
    renderSidebar({ appData: { firstName: 'A', lastName: 'B' } });
    // DEFECT-FIX assertion: the disabled state used `pointer-events-none` on a
    // real <a href="tel:">, which stayed in the tab order and announced as a
    // link to nowhere.
    expect(screen.queryByRole('link', { name: /call/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /email/i })).toBeNull();
  });
});
