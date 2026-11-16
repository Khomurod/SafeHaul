/**
 * The dossier on a phone (У4.10): only Close, the name and the section strip
 * stay put; the driver's details, the section's header and the section scroll
 * away together in the tab panel. A desktop keeps its three panes.
 *
 * What this proves is structure: which elements render, in which order, inside
 * which scroll container, and where focus lands. Pixel heights, what a 412 px
 * screen actually shows and how scrolling feels need a browser; jsdom has no
 * layout.
 *
 * The real `DossierSidebar` and `DossierHeader` are used: the layout is theirs.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { COMPACT_QUERY } from './useCompactViewport';

let claims = {};
let viewState = {};

vi.mock('@features/company-admin/hooks/useApplicationView', () => ({
  useApplicationView: () => viewState,
}));
vi.mock('@features/applications/hooks/useApplicationDelete', () => ({
  useApplicationDelete: () => ({ deleting: false, deleteApplication: vi.fn() }),
}));
// The template read is Firestore's; `useContactAttemptTexts.test.js` covers it.
vi.mock('./useContactAttemptTexts', () => ({ useContactAttemptTexts: () => () => null }));
vi.mock('@/context/DataContext', () => ({
  useData: () => ({ currentUserClaims: claims }),
}));
// The opt-out lookup is a callable; `DossierKeyFacts.test.jsx` covers it.
vi.mock('./useDoNotText', () => ({
  useDoNotText: () => ({ usable: true, checking: false, listed: false, markDoNotText: async () => ({ added: true }) }),
}));
vi.mock('./DossierContent', () => ({
  DossierContent: ({ activeTab }) => <div data-testid="content" data-active-tab={activeTab} />,
}));

import { DriverProfileModal } from './DriverProfileModal';

const baseView = () => ({
  loading: false,
  error: '',
  appData: {
    firstName: 'Maria',
    lastName: 'Garcia',
    email: 'maria@example.com',
    phone: '5125551234',
  },
  currentStatus: 'New Application',
  canEdit: true,
  handleStatusUpdate: vi.fn(),
  handleAssignChange: vi.fn(),
  handleDownloadPdf: vi.fn(),
  fileUrls: {},
  dqStatus: 'complete',
  collectionName: 'applications',
  teamMembers: [],
  assignedTo: '',
});

const originalMatchMedia = window.matchMedia;
/** A viewport the dossier reads as a phone (below `sm`) or not. */
function viewport({ phone }) {
  window.matchMedia = (query) => ({
    matches: phone && query === COMPACT_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

function renderDossier() {
  const onClose = vi.fn();
  render(<DriverProfileModal companyId="co-1" driverId="app-1" isOpen onClose={onClose} />);
  return { onClose, dialog: screen.getByRole('dialog', { name: 'Driver dossier' }) };
}

/** What Tab reaches inside the dossier, in order. */
const tabStops = (dialog) => [...dialog.querySelectorAll('a[href], button:not([disabled]), select, [tabindex]')]
  .filter((el) => el.getAttribute('tabindex') !== '-1');

const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  claims = { roles: { 'co-1': 'company_admin' } };
  viewState = baseView();
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

describe('the dossier on a phone', () => {
  beforeEach(() => viewport({ phone: true }));

  it('puts Close first, and has one', () => {
    const { dialog, onClose } = renderDossier();
    const close = screen.getByRole('button', { name: 'Close driver dossier' });

    expect(tabStops(dialog)[0]).toBe(close);
    expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the name and status on one line, without the desktop identity block', () => {
    renderDossier();
    const name = screen.getByRole('heading', { level: 2, name: 'Maria Garcia' });
    const bar = name.parentElement;

    expect(name).toHaveClass('truncate');
    expect(within(bar).getByRole('button', { name: 'Close driver dossier' })).toBeInTheDocument();
    expect(within(bar).getByText('New')).toBeInTheDocument();
    // The avatar's initials belong to the desktop block only.
    expect(screen.queryByText('MG')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('keeps the bar and a horizontal strip fixed, and scrolls everything else in the tab panel', () => {
    renderDossier();
    const panel = screen.getByRole('tabpanel');
    const tablist = screen.getByRole('tablist', { name: 'Driver dossier sections' });
    const close = screen.getByRole('button', { name: 'Close driver dossier' });

    expect(tablist).not.toHaveAttribute('aria-orientation', 'vertical');
    expect(panel.contains(close)).toBe(false);
    expect(panel.contains(tablist)).toBe(false);
    expect(precedes(close, tablist) && precedes(tablist, panel)).toBe(true);
    expect(panel).toHaveClass('overflow-y-auto', 'flex-1', 'min-h-0');

    // Inside, in reading order: Call, Log call and Email, the section header,
    // the section. The phone, email and last call are the Summary's Contact
    // card now, not the column's.
    const call = within(panel).getByRole('link', { name: /call/i });
    const title = within(panel).getByRole('heading', { level: 3, name: 'Application' });
    const status = within(panel).getByRole('combobox', { name: /status/i });
    const remove = within(panel).getByRole('button', { name: 'Delete application' });
    const content = within(panel).getByTestId('content');
    expect(precedes(call, title) && precedes(title, status)).toBe(true);
    expect(precedes(remove, content)).toBe(true);
    expect(within(panel).queryByText('Phone', { selector: 'dt' })).toBeNull();
  });

  it('opens with focus on the tab panel, at the top of what scrolls', () => {
    renderDossier();
    expect(document.activeElement).toBe(screen.getByRole('tabpanel'));
  });

  it('keeps every section reachable from the strip', () => {
    renderDossier();
    fireEvent.click(screen.getByRole('tab', { name: /^Documents/ }));
    expect(screen.getByTestId('content')).toHaveAttribute('data-active-tab', 'documents');
    expect(screen.getByRole('heading', { level: 3, name: 'Documents to sign' })).toBeInTheDocument();
  });

  it("shows a lead's wording there too", () => {
    viewState = { ...baseView(), collectionName: 'leads' };
    renderDossier();
    expect(screen.getByRole('heading', { level: 3, name: 'Lead' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete lead' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
  });
});

describe('the dossier on a desktop', () => {
  beforeEach(() => viewport({ phone: false }));

  it('keeps the three panes: the identity block and rail beside the header and panel, Close in the header', () => {
    const { dialog } = renderDossier();
    const panel = screen.getByRole('tabpanel');
    const tablist = screen.getByRole('tablist', { name: 'Driver dossier sections' });
    const close = screen.getByRole('button', { name: 'Close driver dossier' });

    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByText('MG')).toBeInTheDocument();
    expect(panel.contains(tablist)).toBe(false);
    expect(panel.contains(close)).toBe(false);
    expect(panel.contains(screen.getByRole('link', { name: /call/i }))).toBe(false);
    expect(precedes(tablist, close) && precedes(close, panel)).toBe(true);
    expect(tabStops(dialog)[0]).toBe(screen.getByRole('link', { name: /call/i }));
    expect(document.activeElement).toBe(panel);
  });
});
