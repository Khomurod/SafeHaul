/**
 * Contract freeze for the Driver Dossier header.
 *
 * Frozen: the per-tab title strings, the confirmation-number rule, the status
 * option set and its `'New'` fallback, the assign option labels and their
 * fallback chain, the exact single-argument callbacks, the Download forwarding,
 * and the `canEdit` / `canDelete` visibility rules.
 *
 * The status option set is the funnel stages and Interested, plus the record's
 * own value when it is none of those: a legacy value that names a stage stands
 * in for that stage under its name, any other is kept by its stored name. The
 * stored value never changes; the legacy values stay valid in the rules
 * (`src/tests/statusVocabulary.test.js`).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  ATS_INTERESTED_STATUS,
  ATS_LEGACY_STATUS_ALIASES,
  ATS_PIPELINE_STATUSES,
  ATS_STATUS_DROPDOWN_OPTIONS,
  LEAD_DEFAULT_STATUS,
} from '@shared/constants/atsStatus';
import { DossierHeader } from './DossierHeader';

afterEach(cleanup);

const baseProps = () => ({
  activeTab: 'application',
  // As the dossier loads it: the record's fields, without its document id.
  appData: { firstName: 'Maria' },
  currentStatus: 'New',
  onClose: vi.fn(),
  onStatusUpdate: vi.fn(),
  canEdit: true,
  teamMembers: [],
  assignedTo: '',
  onAssignChange: vi.fn(),
  canDelete: false,
  onDelete: vi.fn(),
  onDownload: vi.fn(),
});

const renderHeader = (overrides = {}) => {
  const props = { ...baseProps(), ...overrides };
  render(<DossierHeader {...props} />);
  return props;
};

describe('DossierHeader titles', () => {
  it.each([
    ['application', 'Application Review'],
    ['documents', 'Documents to sign'],
    ['dq', 'Driver Qualification File'],
    ['activity', 'Activity Timeline'],
    ['notes', 'Internal Notes'],
    ['pev', 'Previous Employment Verification'],
    ['something-else', 'Driver Dossier'],
  ])('tab %s keeps the frozen title %s', (activeTab, expected) => {
    renderHeader({ activeTab });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

describe('DossierHeader confirmation number', () => {
  const withNumber = { firstName: 'Maria', confirmationNumber: 'SAF-2026-AB3CD' };

  it('shows the confirmation number the driver was given, on the application tab', () => {
    renderHeader({ appData: withNumber });
    expect(screen.getByText('Confirmation Number: SAF-2026-AB3CD')).toBeInTheDocument();
  });

  it("never shows the record's document id, and nothing when the record has no number", () => {
    // A caller handing the header an id must not bring the old chip back.
    renderHeader({ recordId: 'app12345678' });
    expect(screen.queryByText(/Confirmation Number/)).toBeNull();
    expect(screen.queryByText(/App ID|app12345/)).toBeNull();
  });

  it('shows the loading placeholder while the record loads, not a number it had before', () => {
    renderHeader({ appData: withNumber, loading: true });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText(/Confirmation Number/)).toBeNull();
  });

  it('shows nothing when there is no record to show', () => {
    renderHeader({ appData: null });
    expect(screen.queryByText(/Loading|Confirmation Number/)).toBeNull();
  });

  it('does not show the number on other tabs', () => {
    renderHeader({ activeTab: 'documents', appData: withNumber });
    expect(screen.queryByText(/Confirmation Number/)).toBeNull();
  });
});

describe('DossierHeader status control', () => {
  const STAGES = [...ATS_PIPELINE_STATUSES, ATS_INTERESTED_STATUS];
  const asOptions = (values) => values.map((value) => ({ value, label: value }));
  const statusSelect = () => screen.getByRole('combobox', { name: /status/i });
  const optionsOf = (select) => [...select.querySelectorAll('option')]
    .map((option) => ({ value: option.value, label: option.textContent }));

  it('offers the funnel stages and Interested, and defaults the value to New', () => {
    renderHeader({ currentStatus: '' });
    const select = statusSelect();
    expect(select).toHaveValue('New');
    expect(optionsOf(select)).toEqual(asOptions(STAGES));
    expect(ATS_STATUS_DROPDOWN_OPTIONS).toEqual(STAGES);
  });

  it('offers no legacy value to a record that holds none', () => {
    renderHeader({ currentStatus: 'In Process' });
    const values = optionsOf(statusSelect()).map((option) => option.value);
    for (const legacy of [...ATS_LEGACY_STATUS_ALIASES, LEAD_DEFAULT_STATUS]) {
      expect(values).not.toContain(legacy);
    }
  });

  it.each([
    ['New Application', 'New'],
    [LEAD_DEFAULT_STATUS, 'New'],
    ['Approved', 'Hired'],
    ['Rejected', 'Declined'],
  ])("shows a record's %s as its stage, %s, offered once in the stage's place", (stored, stage) => {
    renderHeader({ currentStatus: stored });
    const select = statusSelect();
    expect(select).toHaveValue(stored);
    expect(select.selectedOptions[0].textContent).toBe(stage);
    // The stored value takes the stage's place, so choosing "New" on a
    // `New Application` record writes nothing, and "New" is not offered twice.
    const expected = asOptions(STAGES).map((option) => (option.value === stage ? { value: stored, label: stage } : option));
    expect(optionsOf(select)).toEqual(expected);
  });

  it.each(['Background Check', 'Offer Accepted', 'Contacted', 'Bespoke Stage'])(
    "keeps a record's own %s, once, by its stored name, after the stages",
    (stored) => {
      renderHeader({ currentStatus: stored });
      const select = statusSelect();
      expect(select).toHaveValue(stored);
      expect(optionsOf(select)).toEqual([...asOptions(STAGES), { value: stored, label: stored }]);
    },
  );

  it('does not duplicate a status that is already a stage', () => {
    renderHeader({ currentStatus: 'Hired' });
    expect(optionsOf(statusSelect())).toEqual(asOptions(STAGES));
  });

  it('calls onStatusUpdate with just the stored value chosen', () => {
    const props = renderHeader({ currentStatus: 'New Application' });
    fireEvent.change(statusSelect(), { target: { value: 'Contact Attempt 1' } });
    expect(props.onStatusUpdate).toHaveBeenCalledWith('Contact Attempt 1');
    expect(props.onStatusUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('DossierHeader assignment control', () => {
  const members = [
    { id: 'm1', name: 'Rae Recruiter' },
    { id: 'm2', displayName: 'Dee Display' },
    { id: 'm3', email: 'ella@example.com' },
    { id: 'm4' },
  ];

  it('labels each member by name, then displayName, then email, then id', () => {
    renderHeader({ teamMembers: members });
    const select = screen.getByRole('combobox', { name: /assign/i });
    const labels = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toEqual(['Unassigned', 'Rae Recruiter', 'Dee Display', 'ella@example.com', 'm4']);
  });

  it('represents unassigned as the empty string', () => {
    renderHeader({ teamMembers: members, assignedTo: null });
    expect(screen.getByRole('combobox', { name: /assign/i })).toHaveValue('');
  });

  it('calls onAssignChange with just the member id', () => {
    const props = renderHeader({ teamMembers: members });
    fireEvent.change(screen.getByRole('combobox', { name: /assign/i }), { target: { value: 'm2' } });
    expect(props.onAssignChange).toHaveBeenCalledWith('m2');
  });

  it('calls onAssignChange with the empty string when unassigning', () => {
    const props = renderHeader({ teamMembers: members, assignedTo: 'm2' });
    fireEvent.change(screen.getByRole('combobox', { name: /assign/i }), { target: { value: '' } });
    expect(props.onAssignChange).toHaveBeenCalledWith('');
  });
});

describe('DossierHeader permission gating', () => {
  it('hides both editing controls when canEdit is false', () => {
    renderHeader({ canEdit: false });
    expect(screen.queryByRole('combobox', { name: /status/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /assign/i })).toBeNull();
  });

  it('hides the delete action when canDelete is false', () => {
    renderHeader({ canDelete: false });
    expect(screen.queryByRole('button', { name: /delete application/i })).toBeNull();
  });

  it('shows the delete action and forwards the click when canDelete is true', () => {
    const props = renderHeader({ canDelete: true });
    fireEvent.click(screen.getByRole('button', { name: /delete application/i }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('DossierHeader for a lead (a lead is not an application)', () => {
  it("titles a lead's first tab Lead, deletes a lead, and offers no application PDF", () => {
    const props = renderHeader({ collectionName: 'leads', canDelete: true });

    expect(screen.getByRole('heading', { level: 3, name: 'Lead' })).toBeInTheDocument();
    expect(screen.queryByText('Application Review')).toBeNull();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete application/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps every other tab's title", () => {
    renderHeader({ collectionName: 'leads', activeTab: 'dq' });
    expect(screen.getByText('Driver Qualification File')).toBeInTheDocument();
  });

  it.each([['applications'], [undefined]])(
    'keeps the application wording for collection %s, the default before a record loads',
    (collectionName) => {
      renderHeader({ collectionName, canDelete: true });
      expect(screen.getByRole('heading', { level: 3, name: 'Application Review' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download application PDF' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete application' })).toBeInTheDocument();
    },
  );
});

describe('DossierHeader actions', () => {
  it("leaves the download to the dossier's own handler", () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(props.onDownload).toHaveBeenCalledTimes(1);
  });

  it('closes the dossier from a named close control', () => {
    const props = renderHeader();
    // DEFECT-FIX assertion: the close button previously had no accessible name
    // at all — an icon-only <button> with no title and no aria-label.
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
