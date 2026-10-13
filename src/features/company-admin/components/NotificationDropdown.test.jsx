/**
 * A notification in the bell opens the record it is about: one naming an
 * application or a lead asks for that record's dossier and closes the panel,
 * and opening one marks it read. One about no record only marks itself read.
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

function openBell(notifications) {
    hook.notifications = notifications;
    const onOpenRecord = vi.fn();
    render(<NotificationDropdown companyId="co-1" onOpenRecord={onOpenRecord} />);
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

    it('only marks itself read when it is about no record', async () => {
        const onOpenRecord = await openBell([PLAIN]);

        await userEvent.click(screen.getByRole('button', { name: /Team update/ }));

        expect(hook.markAsRead).toHaveBeenCalledWith('n-3');
        expect(onOpenRecord).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    });

    it('still opens the record when marking it read fails', async () => {
        hook.markAsRead.mockRejectedValue(new Error('offline'));
        const onOpenRecord = await openBell([STATUS]);

        await userEvent.click(screen.getByRole('button', { name: /Status Updated/ }));

        expect(onOpenRecord).toHaveBeenCalledWith('app-7');
    });
});
