/**
 * Previous employers, added, edited and removed through Edit Application.
 *
 * ## What could not be done before 2026-09-09
 *
 * `SchemaSection` renders an `array` section as read-only `FieldDisplay` rows
 * whatever `isEditing` says. So a company admin could edit every scalar field on
 * a submitted application and **none** of the employment history — the section a
 * recruiter most often has to correct, since 49 CFR 391.21(b)(10) wants three
 * years accounted for and a driver who left an employer out or mistyped a date is
 * the ordinary case.
 *
 * This suite drives the real editor through the real tab. `SchemaSection` is
 * stubbed exactly as the sibling suite stubs it, so what is under test is the
 * employment section and the proposal it produces — not nine other sections.
 *
 * ## And the property that matters more than the feature
 *
 * A Previous Employment Verification mirror lives on each employer row. The
 * server is the authority — it strips whatever a client sends and re-attaches it
 * by employer identity (`functions/shared/employerEdits.js`) — and these cases
 * pin the client half of the same promise: the editor carries `employerId` and
 * `verification` through untouched, shows the state so a recruiter can see what a
 * removal costs, and never offers to edit either.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

let changesState;
vi.mock('@features/applications/hooks/useApplicationChanges', () => ({
  useApplicationChanges: () => changesState,
}));

// The other eight sections are somebody else's contract.
vi.mock('@shared/components/schema/SchemaRenderer', () => ({
  SchemaSection: ({ sectionId }) => <div data-testid={`schema-${sectionId}`} />,
}));

vi.mock('@features/applications/hooks/useSubmissionRecord', () => ({
  useSubmissionRecord: () => ({ record: null, loading: false, error: null }),
}));

import { ApplicationTab } from './ApplicationTab';

/** ABC has a completed verification; XYZ has none. The scenario from the task. */
const ABC = Object.freeze({
  employerId: 'aaaaaaaaaaaa',
  companyName: 'ABC Trucking',
  dotNumber: '123456',
  startDate: '2020-01',
  endDate: '2022-06',
  verification: Object.freeze({ status: 'Completed', respondentName: 'Pat Dispatcher' }),
});
const XYZ = Object.freeze({
  employerId: 'bbbbbbbbbbbb',
  companyName: 'XYZ Transport',
  startDate: '2022-07',
  endDate: '2024-01',
});

const APP = Object.freeze({
  id: 'app-1',
  firstName: 'Maria',
  lastName: 'Garcia',
  employers: [ABC, XYZ],
});

let proposeChanges;

function renderTab(appData = APP) {
  render(
    <ApplicationTab
      appData={appData}
      canEdit
      companyId="co-1"
      applicationId="app-1"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Edit application/i }));
}

/** The employers array a proposal carried, or undefined. */
function proposedEmployers() {
  const call = proposeChanges.mock.calls.at(-1);
  return call?.[0]?.find((change) => change.fieldKey === 'employers')?.proposedValue;
}

const propose = () => fireEvent.click(
  screen.getByRole('button', { name: /Propose changes for approval/i }),
);

beforeEach(() => {
  proposeChanges = vi.fn().mockResolvedValue(true);
  changesState = {
    pendingChanges: [],
    proposing: false,
    linking: false,
    proposeChanges,
    createReviewLink: vi.fn(),
  };
});
afterEach(cleanup);

describe('the employers editor', () => {
  it('is reachable at all, which it was not', () => {
    renderTab();

    // The read-only renderer is not what is showing for this section any more.
    expect(screen.queryByTestId('schema-employmentHistory')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add an employer/i })).toBeInTheDocument();
    // The other sections are untouched.
    expect(screen.getByTestId('schema-personalInfo')).toBeInTheDocument();
  });

  it('shows each employer’s verification state, spelled out and not by colour', () => {
    renderTab();

    expect(screen.getByText('Verification: Completed')).toBeInTheDocument();
    expect(screen.getByText('Verification: Not Started')).toBeInTheDocument();
  });

  it('edits an existing employer without disturbing its verification', async () => {
    renderTab();

    const names = screen.getAllByLabelText(/^Company Name/);
    fireEvent.change(names[0], { target: { value: 'ABC Trucking LLC' } });
    fireEvent.change(screen.getAllByLabelText(/^Reason for Leaving/)[0], {
      target: { value: 'Better route' },
    });
    propose();

    await waitFor(() => expect(proposeChanges).toHaveBeenCalled());
    const employers = proposedEmployers();
    expect(employers[0]).toMatchObject({
      employerId: 'aaaaaaaaaaaa',
      companyName: 'ABC Trucking LLC',
      reasonForLeaving: 'Better route',
      // Carried through untouched. The server re-attaches it by identity anyway,
      // and a client that dropped it would make that pass do the work twice.
      verification: { status: 'Completed', respondentName: 'Pat Dispatcher' },
    });
    expect(employers[1].employerId).toBe('bbbbbbbbbbbb');
  });

  it('adds an employer with no identity and no verification of its own', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Add an employer/i }));
    const names = screen.getAllByLabelText(/^Company Name/);
    expect(names).toHaveLength(3);
    fireEvent.change(names[2], { target: { value: 'New Freight Co' } });
    propose();

    await waitFor(() => expect(proposeChanges).toHaveBeenCalled());
    const employers = proposedEmployers();
    expect(employers).toHaveLength(3);
    expect(employers[2].companyName).toBe('New Freight Co');
    // The server mints the identity, so it is never a value a browser chose.
    expect(employers[2].employerId).toBeUndefined();
    expect(employers[2].verification).toBeUndefined();
  });

  it('removes an unverified employer without ceremony', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', {
      name: /Remove XYZ Transport from the employment history/i,
    }));
    propose();

    await waitFor(() => expect(proposeChanges).toHaveBeenCalled());
    const employers = proposedEmployers();
    expect(employers).toHaveLength(1);
    expect(employers[0].companyName).toBe('ABC Trucking');
  });

  it('confirms before removing one that has verification activity', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', {
      name: /Remove ABC Trucking from the employment history/i,
    }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Remove ABC Trucking\?/i)).toBeInTheDocument();
    // And it says exactly what is and is not lost.
    expect(within(dialog).getByText(/stay on file and are not deleted/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/never transferred to another employer/i)).toBeInTheDocument();

    // Cancelling leaves the row alone.
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByLabelText(/^Company Name/)).toHaveLength(2);
  });

  it('removes it once confirmed, and XYZ does not inherit anything', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', {
      name: /Remove ABC Trucking from the employment history/i,
    }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Remove employer/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    propose();

    await waitFor(() => expect(proposeChanges).toHaveBeenCalled());
    const employers = proposedEmployers();
    expect(employers).toHaveLength(1);
    expect(employers[0].employerId).toBe('bbbbbbbbbbbb');
    // The whole point.
    expect(employers[0].verification).toBeUndefined();
  });

  it('never mutates the record it was handed', async () => {
    // `startEdit` copies `appData` shallowly, so an editor working in place would
    // corrupt the original AND make the value diff conclude nothing had changed.
    const appData = { ...APP, employers: [{ ...ABC }, { ...XYZ }] };
    const before = JSON.stringify(appData.employers);
    renderTab(appData);

    fireEvent.change(screen.getAllByLabelText(/^Company Name/)[0], {
      target: { value: 'Changed' },
    });
    propose();

    await waitFor(() => expect(proposeChanges).toHaveBeenCalled());
    expect(JSON.stringify(appData.employers)).toBe(before);
  });

  it('proposes nothing when nothing was changed', async () => {
    renderTab();
    propose();

    // `handlePropose` diffs by value, and an untouched array must compare equal —
    // which it cannot if the editor rewrote legacy field names on load.
    await waitFor(() => expect(screen.queryByRole('button', {
      name: /Propose changes for approval/i,
    })).not.toBeInTheDocument());
    expect(proposeChanges).not.toHaveBeenCalled();
  });

  it('reads a legacy row’s own field names, and rewrites none of them unasked', async () => {
    const legacy = {
      ...APP,
      employers: [{ name: 'Old Hauling', street: '4 Depot Rd', reason: 'Laid off' }],
    };
    renderTab(legacy);

    // Displayed from the pre-rename keys the dossier renderer also falls back to.
    expect(screen.getByLabelText(/^Company Name/)).toHaveValue('Old Hauling');
    expect(screen.getByLabelText(/^Address/)).toHaveValue('4 Depot Rd');
    expect(screen.getByLabelText(/^Reason for Leaving/)).toHaveValue('Laid off');

    // Typing sets the canonical key; the legacy one is left where it is, because
    // rewriting it on load would show the driver a change nobody made.
    fireEvent.change(screen.getByLabelText(/^Company Name/), { target: { value: 'Old Hauling Inc' } });
    propose();
    await waitFor(() => expect(proposeChanges).toHaveBeenCalled());
    expect(proposedEmployers()[0]).toMatchObject({
      companyName: 'Old Hauling Inc',
      name: 'Old Hauling',
      street: '4 Depot Rd',
    });
  });

  it('leaves the read-only renderer in charge when not editing', () => {
    render(<ApplicationTab appData={APP} canEdit companyId="co-1" applicationId="app-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Edit application/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    expect(screen.getByTestId('schema-employmentHistory')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add an employer/i })).not.toBeInTheDocument();
  });
});
