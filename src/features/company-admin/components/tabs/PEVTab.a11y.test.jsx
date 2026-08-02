/**
 * Accessibility coverage for the migrated PEV surfaces.
 *
 * Why this exists as a unit test rather than an E2E spec: under
 * `VITE_E2E_TEST_MODE=1` Firestore is unreachable, so the driver dossier settles
 * into its error state and **never mounts `DossierContent`** — which means the
 * PEV tab body cannot be reached in a Playwright run at all. These checks run
 * the real axe engine against the real markup so the coverage lives in CI
 * instead of depending on a browser session. See the roadmap completion log for
 * the separately-recorded real-browser measurements.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { axe } from 'vitest-axe';

const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
const dataMock = vi.hoisted(() => ({ value: { currentCompanyProfile: {} } }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@/context/DataContext', () => ({ useData: () => dataMock.value }));
vi.mock('@shared/utils/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@lib/firebase', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), updateDoc: vi.fn() }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('../modals/PEVRequestModal', () => ({ PEVRequestModal: () => <div data-testid="request-modal" /> }));
vi.mock('../modals/VOEPreviewModal', () => ({ VOEPreviewModal: () => <div data-testid="preview-modal" /> }));

import { PEVTab } from './PEVTab';

const EMPLOYERS = () => [
  { companyName: 'Acme Freight', city: 'Austin', state: 'TX', startDate: '2020-01', endDate: '2022-06' },
  {
    name: 'Legacy Hauling',
    city: 'Dallas',
    state: 'TX',
    verification: {
      status: 'Sent',
      method: 'Email',
      verificationUrl: 'https://portal.test/v/tok-1',
      history: [{ action: 'Sent via Portal', method: 'Email', recipient: 'hr@legacy.test', timestamp: '2026-07-01T10:00:00.000Z' }],
    },
  },
  {
    companyName: 'Completed Carrier',
    city: 'Houston',
    state: 'TX',
    verification: {
      status: 'Completed',
      method: 'Fax',
      respondentName: 'Dana Reyes',
      resultUrl: 'https://files.test/r.pdf',
      history: [],
    },
  },
];

const renderTab = (employers = EMPLOYERS()) => render(
  <PEVTab
    companyId="co-1"
    applicationId="app-1"
    collectionName="applications"
    appData={{ firstName: 'Maria', lastName: 'Garcia', employers }}
  />,
);

beforeEach(() => {
  vi.clearAllMocks();
  dataMock.value = { currentCompanyProfile: {} };
});
afterEach(cleanup);

describe('PEVTab accessibility', () => {
  it('has no axe violations with a mix of statuses', async () => {
    const { container } = renderTab();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no axe violations in the no-employer state', async () => {
    const { container } = renderTab([]);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no axe violations in the paywalled state', async () => {
    dataMock.value = { currentCompanyProfile: { features: { pev: false } } };
    const { container } = renderTab();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no axe violations with the history dialog open', async () => {
    const { container } = renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /View History/i })[0]);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('PEVTab structure and naming', () => {
  it('presents the employers as a real list', () => {
    renderTab();
    // A bare <div> grid never told assistive technology how many employers
    // there were.
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps heading order without skipping a level', () => {
    const { container } = renderTab();
    const levels = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map((h) => Number(h.tagName[1]));

    // The tab renders under the dossier header's <h3>, so it starts at <h4>.
    expect(levels[0]).toBe(4);
    levels.slice(1).forEach((level, i) => {
      expect(level - levels[i]).toBeLessThanOrEqual(1);
    });
  });

  it('names the resend action after the employer it targets', () => {
    renderTab();
    // Previously an icon-only button whose only name source was `title`.
    expect(screen.getByRole('button', { name: 'Resend verification request to Legacy Hauling' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification request to Completed Carrier' })).toBeInTheDocument();
  });

  it('states each status in text beside its tone', () => {
    renderTab();
    // Status must never be carried by colour alone. Scoped to the employer
    // list, because "Completed" is also a summary-card label.
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Not Started')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Sent')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Completed')).toBeInTheDocument();
  });

  it('exposes a live region for the asynchronous actions', () => {
    renderTab();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('PEVTab history dialog accessibility', () => {
  it('is a named modal dialog with a named close control', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /View History/i })[0]);

    const dialog = screen.getByRole('dialog', { name: 'Verification History' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close verification history' })).toBeInTheDocument();
  });

  it('moves focus into the dialog and closes on Escape', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /View History/i })[0]);

    const dialog = screen.getByRole('dialog', { name: 'Verification History' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the action that opened it', () => {
    renderTab();
    const trigger = screen.getAllByRole('button', { name: /View History/i })[0];
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close verification history' }));

    expect(document.activeElement).toBe(trigger);
  });

  it('presents the trail as an ordered list', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /View History/i })[0]);

    const dialog = screen.getByRole('dialog', { name: 'Verification History' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
  });
});
