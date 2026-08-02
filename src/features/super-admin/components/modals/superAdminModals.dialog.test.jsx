/**
 * Dialog-behaviour and contract freeze for the Super Admin modals.
 *
 * Before the 2026-07-28 migration every one of these was a hand-built
 * `fixed inset-0` overlay: no `role="dialog"`, no focus trap, no Escape, no
 * focus restoration, and unnamed icon-only close controls. This file proves each
 * of those is fixed and freezes the callable payloads the modals own, so the
 * presentation change cannot quietly alter a destructive action.
 *
 * All company, user and driver names below are artificial.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
const mockLoadApplications = vi.fn();
const mockUpdateCompany = vi.fn(() => Promise.resolve());
const mockUploadCompanyLogo = vi.fn(() => Promise.resolve('https://example.test/logo.png'));
const mockGetDoc = vi.fn();

vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({
  db: {},
  functions: { __functions: true },
  uploadCompanyLogo: (...a) => mockUploadCompanyLogo(...a),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, col, id) => ({ col, id })),
  getDoc: (...a) => mockGetDoc(...a),
}));
vi.mock('@features/companies', () => ({ updateCompany: (...a) => mockUpdateCompany(...a) }));
vi.mock('@features/applications/services/applicationService', () => ({
  loadApplications: (...a) => mockLoadApplications(...a),
}));
vi.mock('../users/EditUserNameForm', () => ({
  EditUserNameForm: () => <div data-testid="edit-user-name-form" />,
}));
vi.mock('../users/UserMembershipsManager', () => ({
  UserMembershipsManager: () => <div data-testid="user-memberships-manager" />,
}));

import { DeleteCompanyModal } from './DeleteCompanyModal';
import { DeleteUserModal } from './DeleteUserModal';
import { EditCompanyModal } from './EditCompanyModal';
import { EditUserModal } from './EditUserModal';
import { ViewCompanyAppsModal } from './ViewCompanyAppsModal';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockLoadApplications.mockResolvedValue([]);
  mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Artificial User', email: 'user@example.test' }) });
});

function companyDoc(overrides = {}) {
  return {
    id: 'co-1',
    data: () => ({
      companyName: 'Artificial Freight Co',
      appSlug: 'artificial-freight',
      contact: { phone: '555-0100', email: 'ops@example.test' },
      address: { street: '1 Test Way', city: 'Testville', state: 'tx', zip: '00000' },
      legal: { mcNumber: 'MC000000', dotNumber: 'DOT000000' },
      companyLogoUrl: '',
      planType: 'free',
      ...overrides,
    }),
  };
}

/** Renders a modal behind a real trigger so focus restoration can be observed. */
function renderWithTrigger(renderModal) {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open dialog</button>
        {open && renderModal(() => setOpen(false))}
      </>
    );
  }
  const utils = render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Open dialog' });
  trigger.focus();
  fireEvent.click(trigger);
  return { ...utils, trigger };
}

const CASES = [
  {
    name: 'DeleteCompanyModal',
    render: (onClose) => (
      <DeleteCompanyModal companyId="co-1" companyName="Artificial Freight Co" onClose={onClose} onConfirm={async () => {}} />
    ),
    title: 'Delete Company?',
    dismissable: true,
  },
  {
    name: 'DeleteUserModal',
    render: (onClose) => (
      <DeleteUserModal userId="u-1" userName="Artificial User" onClose={onClose} onConfirm={async () => {}} />
    ),
    title: 'Delete User?',
    dismissable: true,
  },
  {
    name: 'EditCompanyModal',
    render: (onClose) => (
      <EditCompanyModal companyDoc={companyDoc()} onClose={onClose} onSave={async () => {}} />
    ),
    title: 'Edit Company',
    dismissable: true,
  },
  {
    name: 'EditUserModal',
    render: (onClose) => (
      <EditUserModal userId="u-1" allCompaniesMap={new Map()} onClose={onClose} onSave={async () => {}} />
    ),
    title: 'Edit User',
    dismissable: true,
  },
  {
    name: 'ViewCompanyAppsModal',
    render: (onClose) => (
      <ViewCompanyAppsModal companyId="co-1" companyName="Artificial Freight Co" onClose={onClose} />
    ),
    title: 'Driver Applications',
    dismissable: true,
  },
];

describe.each(CASES)('$name — shared dialog behaviour', ({ render: renderModal, title, dismissable }) => {
  it('renders a real modal dialog named by its visible heading', async () => {
    renderWithTrigger(renderModal);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: new RegExp(title, 'i') })).toBeInTheDocument();
    // The accessible name must come from that heading, not a hardcoded string.
    expect(dialog).toHaveAccessibleName(new RegExp(title, 'i'));
  });

  it('moves focus inside the dialog on open', async () => {
    renderWithTrigger(renderModal);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('restores focus to the exact trigger on close', async () => {
    const { trigger } = renderWithTrigger(renderModal);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('modal-close'));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('exposes a named close control instead of a bare icon button', async () => {
    renderWithTrigger(renderModal);
    const dialog = await screen.findByRole('dialog');
    // Targeted by testid because some dialogs also carry a footer "Close"
    // button; the assertion is that this icon-only control has an accessible
    // name at all, which it previously did not.
    expect(within(dialog).getByTestId('modal-close')).toHaveAccessibleName('Close');
  });

  if (dismissable) {
    it('closes on Escape', async () => {
      renderWithTrigger(renderModal);
      const dialog = await screen.findByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  }

  it('has no serious accessibility violations', async () => {
    renderWithTrigger(renderModal);
    await screen.findByRole('dialog');
    const results = await axe(document.body);
    const severe = (results.violations || []).filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(severe.map((v) => `${v.id} [${v.impact}]`)).toEqual([]);
  });
});

describe('Destructive modals — frozen callable contracts', () => {
  it('DeleteCompanyModal calls deleteCompany with the exact payload and order', async () => {
    const deleteFn = vi.fn().mockResolvedValue({ data: { success: true } });
    httpsCallable.mockReturnValue(deleteFn);
    const order = [];
    const onConfirm = vi.fn(async () => { order.push('confirm'); });
    const onClose = vi.fn(() => { order.push('close'); });

    render(<DeleteCompanyModal companyId="co-1" companyName="Artificial Freight Co" onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Company' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(httpsCallable).toHaveBeenCalledWith({ __functions: true }, 'deleteCompany');
    expect(deleteFn).toHaveBeenCalledWith({ companyId: 'co-1' });
    expect(order).toEqual(['confirm', 'close']);
  });

  it('DeleteUserModal calls deletePortalUser with the exact payload and order', async () => {
    const deleteFn = vi.fn().mockResolvedValue({ data: { success: true } });
    httpsCallable.mockReturnValue(deleteFn);
    const order = [];
    const onConfirm = vi.fn(async () => { order.push('confirm'); });
    const onClose = vi.fn(() => { order.push('close'); });

    render(<DeleteUserModal userId="u-1" userName="Artificial User" onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(httpsCallable).toHaveBeenCalledWith({ __functions: true }, 'deletePortalUser');
    expect(deleteFn).toHaveBeenCalledWith({ userId: 'u-1' });
    expect(order).toEqual(['confirm', 'close']);
  });

  it('announces a delete failure instead of showing it silently', async () => {
    httpsCallable.mockReturnValue(vi.fn().mockRejectedValue(new Error('permission denied')));

    render(<DeleteCompanyModal companyId="co-1" companyName="Artificial Freight Co" onClose={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Company' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('permission denied');
  });

  it('does not dismiss a destructive confirmation on a backdrop click', async () => {
    const onClose = vi.fn();
    render(<DeleteCompanyModal companyId="co-1" companyName="Artificial Freight Co" onClose={onClose} onConfirm={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog.parentElement);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EditCompanyModal — frozen save contract and duplicate-id defect', () => {
  it('gives each plan radio a distinct id and a real group', () => {
    render(<EditCompanyModal companyDoc={companyDoc()} onClose={vi.fn()} onSave={vi.fn()} />);

    const free = screen.getByRole('radio', { name: /Free Plan/ });
    const paid = screen.getByRole('radio', { name: /Paid Plan/ });
    // The pre-migration markup rendered `id="planType"` on both inputs.
    expect(free.id).not.toBe(paid.id);
    expect(free.id).toBeTruthy();
    expect(paid.id).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Subscription Plan' })).toBeInTheDocument();
  });

  it('reflects the saved plan and lets it be changed', () => {
    render(<EditCompanyModal companyDoc={companyDoc({ planType: 'paid' })} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /Paid Plan/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Free Plan/ }));
    expect(screen.getByRole('radio', { name: /Free Plan/ })).toBeChecked();
  });

  it('preserves the exact updateCompany payload shape', async () => {
    const onSave = vi.fn(async () => {});
    render(<EditCompanyModal companyDoc={companyDoc()} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateCompany).toHaveBeenCalled());
    const [id, data, originalSlug] = mockUpdateCompany.mock.calls[0];
    expect(id).toBe('co-1');
    expect(originalSlug).toBe('artificial-freight');
    expect(data).toEqual({
      companyName: 'Artificial Freight Co',
      appSlug: 'artificial-freight',
      address: { street: '1 Test Way', city: 'Testville', state: 'TX', zip: '00000' },
      contact: { phone: '555-0100', email: 'ops@example.test' },
      legal: { mcNumber: 'MC000000', dotNumber: 'DOT000000' },
      companyLogoUrl: '',
      planType: 'free',
    });
  });

  it('labels every text field', () => {
    render(<EditCompanyModal companyDoc={companyDoc()} onClose={vi.fn()} onSave={vi.fn()} />);
    ['Company Name', 'Unique URL Slug', 'Contact Phone', 'Contact Email', 'City', 'State', 'ZIP Code']
      .forEach((label) => expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument());
    expect(screen.getByLabelText('Company Logo')).toBeInTheDocument();
  });
});

describe('ViewCompanyAppsModal — frozen data contract', () => {
  it('loads applications for the exact company id', async () => {
    render(<ViewCompanyAppsModal companyId="co-1" companyName="Artificial Freight Co" onClose={vi.fn()} />);
    await waitFor(() => expect(mockLoadApplications).toHaveBeenCalledWith('co-1'));
  });

  it('resolves driver names, contact and date from every supported shape', async () => {
    mockLoadApplications.mockResolvedValue([
      { id: 'a1', firstName: 'Artificial', lastName: 'Driver', email: 'd1@example.test', phone: '555-0111', status: 'Hired', submittedAt: { seconds: 1700000000 } },
      { id: 'a2', personalInfo: { 'first-name': 'Nested', 'last-name': 'Shape', email: 'd2@example.test' }, createdAt: { seconds: 1700000000 } },
      { id: 'a3' },
    ]);

    render(<ViewCompanyAppsModal companyId="co-1" companyName="Artificial Freight Co" onClose={vi.fn()} />);

    expect(await screen.findByText('Artificial Driver')).toBeInTheDocument();
    expect(screen.getByText('Nested Shape')).toBeInTheDocument();
    expect(screen.getByText('Unknown Driver')).toBeInTheDocument();
    expect(screen.getByText('No Email')).toBeInTheDocument();
    // Two rows lack a phone (the nested-shape row and the empty row).
    expect(screen.getAllByText('No Phone')).toHaveLength(2);
    // Missing both timestamps still renders the frozen placeholder.
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('states the status as text, not colour alone', async () => {
    mockLoadApplications.mockResolvedValue([
      { id: 'a1', firstName: 'Artificial', lastName: 'Driver', status: 'Hired' },
      { id: 'a2', firstName: 'No', lastName: 'Status' },
    ]);

    render(<ViewCompanyAppsModal companyId="co-1" companyName="Artificial Freight Co" onClose={vi.fn()} />);

    expect(await screen.findByText('Hired')).toBeInTheDocument();
    expect(screen.getByText('New Application')).toBeInTheDocument();
  });

  it('filters across name, email and status', async () => {
    mockLoadApplications.mockResolvedValue([
      { id: 'a1', firstName: 'Alpha', lastName: 'Driver', email: 'alpha@example.test', status: 'Hired' },
      { id: 'a2', firstName: 'Beta', lastName: 'Driver', email: 'beta@example.test', status: 'Rejected' },
    ]);

    render(<ViewCompanyAppsModal companyId="co-1" companyName="Artificial Freight Co" onClose={vi.fn()} />);
    await screen.findByText('Alpha Driver');

    fireEvent.change(screen.getByLabelText(/Filter applications/), { target: { value: 'rejected' } });
    expect(screen.queryByText('Alpha Driver')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Driver')).toBeInTheDocument();
  });

  it('announces the load failure', async () => {
    mockLoadApplications.mockRejectedValue(new Error('boom'));
    render(<ViewCompanyAppsModal companyId="co-1" companyName="Artificial Freight Co" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load applications/);
  });
});
