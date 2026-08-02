/**
 * Contract freeze for the Driver Dossier header.
 *
 * Frozen: the per-tab title strings, the App-ID presentation rule, the status
 * option set and its dedupe/`'New'` fallback, the assign option labels and their
 * fallback chain, the exact single-argument callbacks, the PDF payload, and the
 * `canEdit` / `canDelete` visibility rules.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const generateApplicationPDFSpy = vi.fn();
vi.mock('@shared/utils/pdfGenerator', () => ({
  generateApplicationPDF: (...args) => generateApplicationPDFSpy(...args),
}));

import { ATS_STATUS_DROPDOWN_OPTIONS } from '@shared/constants/atsStatus';
import { DossierHeader } from './DossierHeader';

afterEach(cleanup);

const baseProps = () => ({
  activeTab: 'application',
  appData: { id: 'app12345678' },
  companyProfile: { companyName: 'Acme' },
  currentStatus: 'New',
  onClose: vi.fn(),
  onStatusUpdate: vi.fn(),
  canEdit: true,
  teamMembers: [],
  assignedTo: '',
  onAssignChange: vi.fn(),
  canDelete: false,
  onDelete: vi.fn(),
});

const renderHeader = (overrides = {}) => {
  const props = { ...baseProps(), ...overrides };
  render(<DossierHeader {...props} />);
  return props;
};

describe('DossierHeader titles', () => {
  it.each([
    ['application', 'Application Review'],
    ['documents', 'Document Gallery'],
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

describe('DossierHeader application id', () => {
  it('shows the first 8 characters of the id on the application tab', () => {
    renderHeader();
    expect(screen.getByText('App ID: app12345')).toBeInTheDocument();
  });

  it('shows the loading placeholder when there is no appData yet', () => {
    renderHeader({ appData: null });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('does not show the id on other tabs', () => {
    renderHeader({ activeTab: 'documents' });
    expect(screen.queryByText(/App ID:/)).toBeNull();
  });
});

describe('DossierHeader status control', () => {
  it('offers every ATS dropdown option and defaults the value to New', () => {
    renderHeader({ currentStatus: '' });
    const select = screen.getByRole('combobox', { name: /status/i });
    expect(select).toHaveValue('New');
    const values = [...select.querySelectorAll('option')].map((o) => o.value);
    for (const option of ATS_STATUS_DROPDOWN_OPTIONS) {
      expect(values).toContain(option);
    }
  });

  it('adds an unknown current status without duplicating it', () => {
    renderHeader({ currentStatus: 'Bespoke Stage' });
    const select = screen.getByRole('combobox', { name: /status/i });
    const values = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(values.filter((v) => v === 'Bespoke Stage')).toHaveLength(1);
    expect(select).toHaveValue('Bespoke Stage');
  });

  it('does not duplicate a status that is already an ATS option', () => {
    const existing = ATS_STATUS_DROPDOWN_OPTIONS[0];
    renderHeader({ currentStatus: existing });
    const select = screen.getByRole('combobox', { name: /status/i });
    const values = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(values.filter((v) => v === existing)).toHaveLength(1);
  });

  it('calls onStatusUpdate with just the new value', () => {
    const target = ATS_STATUS_DROPDOWN_OPTIONS[1];
    const props = renderHeader();
    fireEvent.change(screen.getByRole('combobox', { name: /status/i }), { target: { value: target } });
    expect(props.onStatusUpdate).toHaveBeenCalledWith(target);
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

describe('DossierHeader actions', () => {
  beforeEach(() => generateApplicationPDFSpy.mockClear());

  it('generates the PDF with the frozen payload shape', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(generateApplicationPDFSpy).toHaveBeenCalledWith({
      applicant: { id: 'app12345678' },
      company: { companyName: 'Acme' },
      agreements: [],
    });
  });

  it('does not attempt a PDF when there is no application data', () => {
    renderHeader({ appData: null });
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(generateApplicationPDFSpy).not.toHaveBeenCalled();
  });

  it('closes the dossier from a named close control', () => {
    const props = renderHeader();
    // DEFECT-FIX assertion: the close button previously had no accessible name
    // at all — an icon-only <button> with no title and no aria-label.
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
