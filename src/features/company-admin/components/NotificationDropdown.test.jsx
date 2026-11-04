/**
 * A notification in the bell opens the record it is about: one naming an
 * application or a lead asks for that record's dossier and closes the panel,
 * one naming a signing request opens E-Docs, and opening one marks it read.
 * One about no record is plain text.
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

function openBell(notifications, { onOpenDocuments = vi.fn() } = {}) {
    hook.notifications = notifications;
    const onOpenRecord = vi.fn();
    render(<NotificationDropdown companyId="co-1" onOpenRecord={onOpenRecord} onOpenDocuments={onOpenDocuments} />);
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

        expect(onOpenRecord).toHaveBeenCalledWith('app-7');
        expect(hook.markAsRead).toHaveBeenCalledWith('n-1');
        expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument();
        // Where the dossier will return focus when it closes.
        expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus();
    });

    it('opens the lead it is about, and a read one is not marked again', async () => {
        const onOpenRecord = await openBell([LEAD]);

        await userEvent.click(screen.getByRole('button', { name: /Lead Assigned/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('lead-3');
        expect(hook.markAsRead).not.toHaveBeenCalled();
    });

    it('opens from the keyboard', async () => {
        const onOpenRecord = await openBell([STATUS]);

        screen.getByRole('button', { name: /Status Updated/ }).focus();
        await userEvent.keyboard('{Enter}');

        expect(onOpenRecord).toHaveBeenCalledWith('app-7');
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

    it('opens an application assigned to the reader, and shows an import summary as plain text', async () => {
        const ASSIGNED = {
            id: 'n-5', type: 'application_assigned', title: 'Application Assigned', message: 'Ann Baker was assigned to you',
            relatedId: 'app-9', relatedType: 'application', recipientId: 'user-1', read: false, createdAt: at,
        };
        const IMPORTED = {
            id: 'n-6', type: 'leads_assigned', title: 'Leads Assigned', message: '15 leads assigned to you',
            recipientId: 'user-1', count: 15, read: false, createdAt: at,
        };
        const onOpenRecord = await openBell([ASSIGNED, IMPORTED]);

        expect(screen.getByText('15 leads assigned to you')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Leads Assigned/ })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Application Assigned/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('app-9');
        expect(hook.markAsRead).toHaveBeenCalledWith('n-5');
    });

    it('still opens the record when marking it read fails', async () => {
        hook.markAsRead.mockRejectedValue(new Error('offline'));
        const onOpenRecord = await openBell([STATUS]);

        await userEvent.click(screen.getByRole('button', { name: /Status Updated/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('app-7');
    });
});
