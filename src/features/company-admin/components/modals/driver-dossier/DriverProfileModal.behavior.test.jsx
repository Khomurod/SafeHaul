/**
 * Dialog-behaviour freeze for the Driver Dossier shell.
 *
 * `DriverProfileModal.contract.test.jsx` freezes the *data* contracts (hook
 * arguments, delete payload, permissions, copy). This file freezes the
 * *dialog* behaviour the migration is responsible for and that nothing
 * previously covered: where focus goes on open, that focus is contained, where
 * it is restored to on close, how the two nested dialogs (delete confirmation
 * and document preview) interact with the dossier's own Escape/focus handling,
 * and the meaningful empty state.
 *
 * The real `DossierSidebar` and `DossierHeader` are used here on purpose —
 * focus order is a property of the actual DOM, so mocking them would test
 * nothing.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const deleteApplicationSpy = vi.fn();
let claims = {};
let viewState = {};
let deleting = false;

vi.mock('@features/company-admin/hooks/useApplicationView', () => ({
  useApplicationView: () => viewState,
}));

vi.mock('@features/applications/hooks/useApplicationDelete', () => ({
  useApplicationDelete: () => ({ deleting, deleteApplication: deleteApplicationSpy }),
}));

vi.mock('@/context/DataContext', () => ({
  useData: () => ({ currentUserClaims: claims }),
}));

// The tab bodies are exercised by their own contract tests; the shell's
// dialog behaviour is what is under test here.
vi.mock('./DossierContent', () => ({
  DossierContent: ({ activeTab }) => (
    <div data-testid="content" data-active-tab={activeTab}>
      <button type="button">content-control</button>
    </div>
  ),
}));

import { DriverProfileModal } from './DriverProfileModal';

const baseView = () => ({
  loading: false,
  error: '',
  appData: {
    id: 'app-12345678',
    firstName: 'Maria',
    lastName: 'Garcia',
    email: 'maria@example.com',
    phone: '5125551234',
  },
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

/**
 * Renders a trigger button, focuses it, and only then opens the dossier — the
 * real sequence, and the only way focus restoration can be asserted.
 */
function renderFromTrigger(props = {}) {
  const onClose = props.onClose || vi.fn();
  const onDeleted = props.onDeleted || vi.fn();

  function Harness() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open driver dossier for Maria Garcia
        </button>
        <DriverProfileModal
          companyId="co-1"
          driverId="app-12345678"
          isOpen={open}
          onClose={() => { setOpen(false); onClose(); }}
          onDeleted={onDeleted}
        />
      </>
    );
  }

  const utils = render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Open driver dossier for Maria Garcia' });
  trigger.focus();
  fireEvent.click(trigger);
  return { ...utils, trigger, onClose, onDeleted };
}

beforeEach(() => {
  vi.clearAllMocks();
  claims = { roles: { 'co-1': 'company_admin' } };
  viewState = baseView();
  deleting = false;
});

afterEach(cleanup);

describe('DriverProfileModal focus management', () => {
  it('moves focus into the dialog on open', () => {
    renderFromTrigger();
    const dialog = screen.getByRole('dialog', { name: 'Driver dossier' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('does not open with focus on the tel: link', () => {
    // A dialog must not open with focus on a control that places a phone call
    // the moment the user presses Enter. `Modal` focuses the first focusable
    // child by default, and in DOM order that is the sidebar's "Call" link.
    renderFromTrigger();
    const call = screen.getByRole('link', { name: /call/i });
    expect(document.activeElement).not.toBe(call);
  });

  it('restores focus to the invoking control when the dossier closes', async () => {
    const { trigger } = renderFromTrigger();
    fireEvent.click(screen.getByRole('button', { name: 'Close driver dossier' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Driver dossier' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the invoking control after Escape', async () => {
    const { trigger } = renderFromTrigger();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Driver dossier' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Driver dossier' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe('DriverProfileModal nested delete confirmation', () => {
  it('opens the confirmation with focus on the non-destructive action', () => {
    renderFromTrigger();
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('Escape in the confirmation dismisses only the confirmation', () => {
    const { onClose } = renderFromTrigger();
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }));

    const confirm = screen.getByRole('dialog', { name: /Delete this application/ });
    fireEvent.keyDown(confirm, { key: 'Escape' });

    expect(screen.queryByText('Delete this application?')).toBeNull();
    // The dossier itself must survive — the topmost dialog is the one Escape owns.
    expect(screen.getByRole('dialog', { name: 'Driver dossier' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape is inert while a delete is in flight', () => {
    deleting = true;
    const { onClose } = renderFromTrigger();
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }));

    const confirm = screen.getByRole('dialog', { name: /Delete this application/ });
    fireEvent.keyDown(confirm, { key: 'Escape' });

    // Neither dialog may be torn down mid-delete.
    expect(screen.getByText('Delete this application?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns focus to the delete action when the confirmation is cancelled', () => {
    renderFromTrigger();
    const deleteAction = screen.getByRole('button', { name: 'Delete application' });
    // `fireEvent.click` does not move focus the way a real pointer or keyboard
    // activation does, so the invoking control is focused explicitly here —
    // otherwise the test would assert against a state no user can reach.
    deleteAction.focus();
    fireEvent.click(deleteAction);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(document.activeElement).toBe(deleteAction);
  });

  it('leaves focus on a real element after a successful delete', async () => {
    deleteApplicationSpy.mockResolvedValue(true);
    const { trigger } = renderFromTrigger();

    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Driver dossier' })).toBeNull());
    // Both dialogs unmount together. The confirmation's own "restore" target
    // (the header delete button) is destroyed in the same commit, so a naive
    // restore drops focus onto <body> and the keyboard user is stranded at the
    // top of the document.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('DriverProfileModal page states', () => {
  it('announces the loading state', () => {
    viewState = { ...baseView(), loading: true };
    renderFromTrigger();
    expect(screen.getByRole('status')).toHaveTextContent(/Loading driver dossier/);
  });

  it('announces the error state as an alert', () => {
    viewState = { ...baseView(), loading: false, error: 'permission-denied' };
    renderFromTrigger();
    expect(screen.getByRole('alert')).toHaveTextContent('Error loading application details.');
  });

  it('still routes to the tab body when the application resolves to nothing', () => {
    // The shell must NOT swallow this case itself: DQ File, Previous
    // Employment, Activity and Notes are driven by companyId/applicationId, not
    // by appData, and they have to stay reachable. Each tab owns its own empty
    // state (see ApplicationTab.contract.test.jsx).
    viewState = { ...baseView(), loading: false, error: '', appData: null };
    renderFromTrigger();

    expect(screen.getByTestId('content')).toBeInTheDocument();
  });
});
