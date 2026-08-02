/**
 * Contract freeze for the Driver Dossier shell.
 *
 * Written BEFORE the design-system migration so the migration is provably
 * behaviour-preserving. These tests assert values and call arguments, not
 * markup: the `useApplicationView` argument list, the delete payload and its
 * ordering, the permission rule that gates delete, the open/close contract, the
 * default active tab, and the exact confirmation strings.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const useApplicationViewSpy = vi.fn();
const deleteApplicationSpy = vi.fn();
let claims = {};
let viewState = {};
let deleting = false;

vi.mock('@features/company-admin/hooks/useApplicationView', () => ({
  useApplicationView: (...args) => {
    useApplicationViewSpy(...args);
    return viewState;
  },
}));

vi.mock('@features/applications/hooks/useApplicationDelete', () => ({
  useApplicationDelete: () => ({ deleting, deleteApplication: deleteApplicationSpy }),
}));

vi.mock('@/context/DataContext', () => ({
  useData: () => ({ currentUserClaims: claims }),
}));

// The tab bodies are irrelevant here; the shell is under test.
vi.mock('./DossierContent', () => ({
  DossierContent: (props) => <div data-testid="content" data-active-tab={props.activeTab} />,
}));
vi.mock('./DossierSidebar', () => ({
  DossierSidebar: ({ activeTab, setActiveTab }) => (
    <div>
      <span data-testid="sidebar-active">{activeTab}</span>
      <button type="button" onClick={() => setActiveTab('documents')}>go-documents</button>
    </div>
  ),
}));
vi.mock('./DossierHeader', () => ({
  DossierHeader: ({ onClose, onDelete, canDelete }) => (
    <div>
      <button type="button" onClick={onClose}>header-close</button>
      {canDelete && <button type="button" onClick={onDelete}>header-delete</button>}
    </div>
  ),
}));

import { DriverProfileModal } from './DriverProfileModal';

const baseView = () => ({
  loading: false,
  error: '',
  appData: { id: 'app-123', firstName: 'Maria', lastName: 'Garcia' },
  companyProfile: { companyName: 'Acme' },
  currentStatus: 'New',
  isEditing: false,
  setIsEditing: vi.fn(),
  isSaving: false,
  canEdit: true,
  handleStatusUpdate: vi.fn(),
  handleAssignChange: vi.fn(),
  handleSaveEdit: vi.fn(),
  handleManagementComplete: vi.fn(),
  fileUrls: {},
  dqStatus: 'complete',
  collectionName: 'applications',
  teamMembers: [],
  assignedTo: '',
});

const renderModal = (props = {}) => {
  const onClose = props.onClose || vi.fn();
  const onDeleted = props.onDeleted || vi.fn();
  const utils = render(
    <DriverProfileModal
      companyId="co-1"
      driverId="app-123"
      isOpen
      onClose={onClose}
      onDeleted={onDeleted}
      {...props}
    />,
  );
  return { ...utils, onClose, onDeleted };
};

describe('DriverProfileModal open/close contract', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    claims = { roles: { 'co-1': 'company_admin' } };
    viewState = baseView();
    deleting = false;
  });

  it('renders nothing when isOpen is false', () => {
    render(<DriverProfileModal companyId="co-1" driverId="app-123" isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes exactly one dialog named "Driver dossier"', () => {
    renderModal();
    // `e2e/company-candidate-table.spec.cjs` selects this name directly.
    expect(screen.getAllByRole('dialog', { name: 'Driver dossier' })).toHaveLength(1);
  });

  it('closes on Escape', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Driver dossier' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the header close action', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('header-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens on the application tab and hands the active tab to the content', () => {
    renderModal();
    expect(screen.getByTestId('sidebar-active')).toHaveTextContent('application');
    expect(screen.getByTestId('content')).toHaveAttribute('data-active-tab', 'application');
  });

  it('keeps the active-tab state values the sidebar emits', () => {
    renderModal();
    fireEvent.click(screen.getByText('go-documents'));
    expect(screen.getByTestId('content')).toHaveAttribute('data-active-tab', 'documents');
  });
});

describe('DriverProfileModal data-hook contract', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    claims = { roles: { 'co-1': 'company_admin' } };
    viewState = baseView();
    deleting = false;
  });

  it('calls useApplicationView with the exact frozen argument list', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    // (companyId, applicationId, onStatusUpdate=null, onClosePanel=onClose, onPhoneClick=null)
    expect(useApplicationViewSpy).toHaveBeenCalledWith('co-1', 'app-123', null, onClose, null);
  });

  // DEFECT-FIX assertion (not a frozen contract): before the design-system
  // migration the loading state was a bare spinning icon with no role and no
  // text, so a screen-reader user was told nothing while the dossier loaded.
  it('shows an announced loading state while the view loads', () => {
    viewState = { ...baseView(), loading: true };
    renderModal();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the frozen error copy and the raw error detail', () => {
    viewState = { ...baseView(), loading: false, error: 'permission-denied' };
    renderModal();
    expect(screen.getByText('Error loading application details.')).toBeInTheDocument();
    expect(screen.getByText('permission-denied')).toBeInTheDocument();
  });

  it('does not render tab content while loading or errored', () => {
    viewState = { ...baseView(), loading: true };
    const { unmount } = renderModal();
    expect(screen.queryByTestId('content')).toBeNull();
    unmount();

    viewState = { ...baseView(), error: 'boom' };
    renderModal();
    expect(screen.queryByTestId('content')).toBeNull();
  });
});

describe('DriverProfileModal delete permission and payload', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    viewState = baseView();
    deleting = false;
  });

  it('allows delete for a company_admin of THIS company', () => {
    claims = { roles: { 'co-1': 'company_admin' } };
    renderModal();
    expect(screen.getByText('header-delete')).toBeInTheDocument();
  });

  it('allows delete for a super_admin', () => {
    claims = { roles: { globalRole: 'super_admin' } };
    renderModal();
    expect(screen.getByText('header-delete')).toBeInTheDocument();
  });

  it('denies delete for a company_admin of a DIFFERENT company', () => {
    claims = { roles: { 'other-co': 'company_admin' } };
    renderModal();
    expect(screen.queryByText('header-delete')).toBeNull();
  });

  it('denies delete for a recruiter and for missing claims', () => {
    claims = { roles: { 'co-1': 'recruiter' } };
    const { unmount } = renderModal();
    expect(screen.queryByText('header-delete')).toBeNull();
    unmount();

    claims = {};
    renderModal();
    expect(screen.queryByText('header-delete')).toBeNull();
  });

  it('keeps the frozen confirmation copy', () => {
    claims = { roles: { 'co-1': 'company_admin' } };
    renderModal();
    fireEvent.click(screen.getByText('header-delete'));

    expect(screen.getByText('Delete this application?')).toBeInTheDocument();
    expect(screen.getByText(/This permanently removes the application, its activity history, notes, and all\s+uploaded documents\. This cannot be undone\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument();
  });

  it('sends the exact delete payload and then calls onDeleted before onClose', async () => {
    claims = { roles: { 'co-1': 'company_admin' } };
    deleteApplicationSpy.mockResolvedValue(true);
    const order = [];
    const onDeleted = vi.fn(() => order.push('onDeleted'));
    const onClose = vi.fn(() => order.push('onClose'));

    renderModal({ onClose, onDeleted });
    fireEvent.click(screen.getByText('header-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(deleteApplicationSpy).toHaveBeenCalledTimes(1));
    expect(deleteApplicationSpy).toHaveBeenCalledWith({
      companyId: 'co-1',
      applicationId: 'app-123',
      collectionName: 'applications',
    });
    await waitFor(() => expect(order).toEqual(['onDeleted', 'onClose']));
  });

  it('forwards the resolved collectionName rather than assuming "applications"', async () => {
    claims = { roles: { 'co-1': 'company_admin' } };
    viewState = { ...baseView(), collectionName: 'leads' };
    deleteApplicationSpy.mockResolvedValue(true);

    renderModal();
    fireEvent.click(screen.getByText('header-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(deleteApplicationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: 'leads' }),
    ));
  });

  it('keeps the dossier open and the dialog raised when the delete fails', async () => {
    claims = { roles: { 'co-1': 'company_admin' } };
    deleteApplicationSpy.mockResolvedValue(false);
    const onDeleted = vi.fn();
    const onClose = vi.fn();

    renderModal({ onClose, onDeleted });
    fireEvent.click(screen.getByText('header-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(deleteApplicationSpy).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this application?')).toBeInTheDocument();
  });

  it('cancelling the confirmation deletes nothing', () => {
    claims = { roles: { 'co-1': 'company_admin' } };
    renderModal();
    fireEvent.click(screen.getByText('header-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteApplicationSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this application?')).toBeNull();
  });

  it('shows the in-flight label and disables both actions while deleting', () => {
    claims = { roles: { 'co-1': 'company_admin' } };
    deleting = true;
    renderModal();
    fireEvent.click(screen.getByText('header-delete'));

    expect(screen.getByRole('button', { name: /Deleting/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
