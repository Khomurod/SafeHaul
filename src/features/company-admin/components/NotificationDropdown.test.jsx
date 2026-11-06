/**
 * A notification in the bell opens the record it is about: one naming an
 * application or a lead asks for that record's dossier, on the tab the notice is
 * about (a document, a PEV, a DQ deadline), and closes the panel,
 * one naming a signing request opens E-Docs, an import's Leads Assigned (no
 * record, read by its type) opens the reader's Assigned to me list, and
 * opening one marks it read. One about no record is plain text.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => ({ notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn() }));

vi.mock('../hooks/useCompanyNotifications', () => ({
    useCompanyNotifications: () => ({
        notifications: hook.notifications,
        unreadCount: hook.notifications.filter((n) => !n.read).length,
        loading: false,
        markAsRead: hook.markAsRead,
        markAllAsRead: hook.markAllAsRead,
    }),
}));

import { NotificationDropdown } from './NotificationDropdown';

const at = new Date('2026-10-13T06:00:00Z');
const STATUS = {
    id: 'n-1', type: 'status_change', title: 'Status Updated', message: 'Ann Baker moved from "New" to "Hired"',
    relatedId: 'app-7', relatedType: 'application', read: false, createdAt: at,
};
const LEAD = {
    id: 'n-2', type: 'lead_assigned', title: 'Lead Assigned', message: 'Lee Chen was assigned to Rita Admin',
    relatedId: 'lead-3', relatedType: 'lead', read: true, createdAt: at,
};
const PLAIN = { id: 'n-3', type: 'team_activity', title: 'Team update', message: 'A new member joined', read: false, createdAt: at };
const SIGNED = {
    id: 'seal_req-4', type: 'document_signed', title: 'Document signed', message: 'Ann Baker signed Offer Letter',
    relatedId: 'req-4', relatedType: 'signing_request', recipientId: 'user-1', read: false, createdAt: at,
};

function openBell(notifications, { onOpenDocuments = vi.fn(), onOpenAssignedLeads = vi.fn() } = {}) {
    hook.notifications = notifications;
    const onOpenRecord = vi.fn();
    render(
        <NotificationDropdown
            companyId="co-1"
            onOpenRecord={onOpenRecord}
            onOpenDocuments={onOpenDocuments}
            onOpenAssignedLeads={onOpenAssignedLeads}
        />,
    );
    return userEvent.click(screen.getByRole('button', { name: 'Notifications' })).then(() => onOpenRecord);
}

beforeEach(() => {
    vi.clearAllMocks();
    hook.markAsRead.mockResolvedValue(undefined);
});

describe('a notification in the bell', () => {
    it('opens the application it is about, marks itself read and closes the panel', async () => {
        const onOpenRecord = await openBell([STATUS]);

        await userEvent.click(screen.getByRole('button', { name: /Status Updated/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('app-7', undefined);
        expect(hook.markAsRead).toHaveBeenCalledWith('n-1');
        expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument();
        // Where the dossier will return focus when it closes.
        expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus();
    });

    it('opens the lead it is about, and a read one is not marked again', async () => {
        const onOpenRecord = await openBell([LEAD]);

        await userEvent.click(screen.getByRole('button', { name: /Lead Assigned/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('lead-3', undefined);
        expect(hook.markAsRead).not.toHaveBeenCalled();
    });

    it('opens from the keyboard', async () => {
        const onOpenRecord = await openBell([STATUS]);

        screen.getByRole('button', { name: /Status Updated/ }).focus();
        await userEvent.keyboard('{Enter}');

        expect(onOpenRecord).toHaveBeenCalledWith('app-7', undefined);
    });

    it('is plain text when it is about no record, so no control does nothing', async () => {
        const onOpenRecord = await openBell([PLAIN]);

        expect(screen.getByText(/Team update/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Team update/ })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

        expect(hook.markAllAsRead).toHaveBeenCalledTimes(1);
        expect(onOpenRecord).not.toHaveBeenCalled();
    });

    it('opens E-Docs for a signing request, marks itself read and closes the panel', async () => {
        const onOpenDocuments = vi.fn();
        const onOpenRecord = await openBell([SIGNED], { onOpenDocuments });

        await userEvent.click(screen.getByRole('button', { name: /Document signed.*Open E-Docs/ }));

        expect(onOpenDocuments).toHaveBeenCalledTimes(1);
        expect(onOpenRecord).not.toHaveBeenCalled();
        expect(hook.markAsRead).toHaveBeenCalledWith('seal_req-4');
        expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument();
    });

    it('shows a signing request as plain text where E-Docs cannot be opened', async () => {
        hook.notifications = [SIGNED];
        render(<NotificationDropdown companyId="co-1" onOpenRecord={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));

        expect(screen.getByText(/Ann Baker signed Offer Letter/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Document signed/ })).not.toBeInTheDocument();
        expect(screen.queryByText('Open E-Docs')).not.toBeInTheDocument();
    });

    it('opens an application assigned to the reader', async () => {
        const ASSIGNED = {
            id: 'n-5', type: 'application_assigned', title: 'Application Assigned', message: 'Ann Baker was assigned to you',
            relatedId: 'app-9', relatedType: 'application', recipientId: 'user-1', read: false, createdAt: at,
        };
        const onOpenRecord = await openBell([ASSIGNED]);

        await userEvent.click(screen.getByRole('button', { name: /Application Assigned/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('app-9', undefined);
        expect(hook.markAsRead).toHaveBeenCalledWith('n-5');
    });

    // As the importer's browser writes it (`importAssignmentNotices.js`): a
    // count, no record, so the bell reads where it goes from its type.
    const IMPORTED = {
        id: 'n-6', type: 'leads_assigned', title: 'Leads Assigned', message: '15 leads assigned to you',
        recipientId: 'user-1', count: 15, actorId: 'admin-1', read: false, createdAt: at,
    };

    it("opens the reader's Assigned to me list from an import's Leads Assigned, marks itself read and closes", async () => {
        const onOpenAssignedLeads = vi.fn();
        const onOpenRecord = await openBell([IMPORTED], { onOpenAssignedLeads });

        await userEvent.click(screen.getByRole('button', { name: /Leads Assigned.*15 leads assigned to you/ }));

        expect(onOpenAssignedLeads).toHaveBeenCalledTimes(1);
        expect(onOpenRecord).not.toHaveBeenCalled();
        expect(hook.markAsRead).toHaveBeenCalledWith('n-6');
        expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus();
    });

    it('opens the list from a Leads Assigned already read, from the keyboard, without marking it again', async () => {
        const onOpenAssignedLeads = vi.fn();
        await openBell([{ ...IMPORTED, read: true }], { onOpenAssignedLeads });

        screen.getByRole('button', { name: /Leads Assigned/ }).focus();
        await userEvent.keyboard('{Enter}');

        expect(onOpenAssignedLeads).toHaveBeenCalledTimes(1);
        expect(hook.markAsRead).not.toHaveBeenCalled();
    });

    it('shows a Leads Assigned as plain text where the leads cannot be opened', async () => {
        hook.notifications = [IMPORTED];
        render(<NotificationDropdown companyId="co-1" onOpenRecord={vi.fn()} onOpenDocuments={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));

        expect(screen.getByText('15 leads assigned to you')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Leads Assigned/ })).not.toBeInTheDocument();
    });

    it('opens the driver\'s dossier from a DQ deadline notice, a warning while it expires soon and a danger once expired', async () => {
        const EXPIRING = {
            id: 'dq_expiring_app-8_2026-11-20', type: 'dq_expiring', title: 'DQ document expires soon',
            message: "Ann Baker's medical card is valid until Nov 20, 2026",
            relatedId: 'app-8', relatedType: 'application', recipientId: 'user-1', read: false, createdAt: at,
        };
        const EXPIRED = {
            ...EXPIRING, id: 'dq_expired_app-8_2026-11-20', type: 'dq_expired', title: 'DQ document expired',
            message: "Ann Baker's medical card was valid until Nov 20, 2026",
        };
        const onOpenRecord = await openBell([EXPIRING, EXPIRED]);

        const expiring = screen.getByRole('button', { name: /DQ document expires soon/ });
        const expired = screen.getByRole('button', { name: /DQ document expired/ });
        expect(expiring.querySelector('svg')).toHaveClass('text-ds-status-warning-fg');
        expect(expired.querySelector('svg')).toHaveClass('text-ds-status-danger-fg');
        await userEvent.click(expired);

        // On the DQ File tab, where the date is.
        expect(onOpenRecord).toHaveBeenCalledWith('app-8', 'dq');
        expect(hook.markAsRead).toHaveBeenCalledWith('dq_expired_app-8_2026-11-20');
    });

    // By the notice's type, so those already sent open the tab too; any other
    // opens the dossier on its first tab (`undefined` above).
    it.each([
        ['a document signed', { type: 'document_signed', title: 'Document signed', message: 'Ann Baker signed Offer Letter' }, 'documents'],
        ['a seal that failed', { type: 'document_seal_failed', title: 'Seal failed', message: 'Offer Letter, signed by Ann Baker, could not be sealed' }, 'documents'],
        ['a PEV answer', { type: 'pev_completed', title: 'Verification answered', message: 'Prairie Line Freight answered the employment verification for Ann Baker' }, 'pev'],
        ['a PEV with no answer', { type: 'pev_no_response', title: 'Verification not answered', message: 'Prairie Line Freight did not answer the employment verification for Ann Baker within 30 days' }, 'pev'],
        ['a DQ document expiring', { type: 'dq_expiring', title: 'DQ document expires soon', message: "Ann Baker's medical card is valid until Nov 20, 2026" }, 'dq'],
    ])('opens %s on the dossier tab it is about', async (_name, notice, tab) => {
        const onOpenRecord = await openBell([{
            id: 'n-9', relatedId: 'app-4', relatedType: 'application', read: false, createdAt: at, ...notice,
        }]);

        await userEvent.click(screen.getByRole('button', { name: new RegExp(notice.title) }));

        expect(onOpenRecord).toHaveBeenCalledWith('app-4', tab);
    });

    it("opens a lead's PEV answer on its Previous Employment tab", async () => {
        const onOpenRecord = await openBell([{
            id: 'n-10', type: 'pev_completed', title: 'Verification answered', message: 'Prairie Line Freight answered',
            relatedId: 'lead-4', relatedType: 'lead', read: true, createdAt: at,
        }]);

        await userEvent.click(screen.getByRole('button', { name: /Verification answered/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('lead-4', 'pev');
    });

    it('still opens the record when marking it read fails', async () => {
        hook.markAsRead.mockRejectedValue(new Error('offline'));
        const onOpenRecord = await openBell([STATUS]);

        await userEvent.click(screen.getByRole('button', { name: /Status Updated/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('app-7', undefined);
    });
});
