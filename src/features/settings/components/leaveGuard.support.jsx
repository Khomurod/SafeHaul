import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { useUnsavedChangesGuard } from '@/design-system/patterns';
import { UnsavedChangesBoundary } from '@features/company-admin/layout/UnsavedChangesBoundary';

/**
 * Renders a settings page inside the company shell's own leave guard, with a
 * stand-in for any move the shell makes (its menu, the section rail, log out):
 * "Leave this page" asks the guard, and `leave` records the move it allowed.
 */
export function renderWithLeaveGuard(ui) {
    const leave = vi.fn();
    function LeaveButton() {
        const guard = useUnsavedChangesGuard();
        return <button type="button" onClick={() => guard.request(leave)}>Leave this page</button>;
    }
    const result = render(
        <UnsavedChangesBoundary>
            {ui}
            <LeaveButton />
        </UnsavedChangesBoundary>,
    );
    return { ...result, leave };
}

/** Whether closing or reloading the tab would ask the browser's own question. */
export function browserWouldAsk() {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
}
