import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DossierHeader } from './DossierHeader';

afterEach(cleanup);

const baseProps = {
    activeTab: 'application',
    appData: { id: 'app12345678' },
    companyProfile: {},
    currentStatus: 'New',
    onClose: () => {},
    onStatusUpdate: () => {},
    canEdit: true,
    teamMembers: [],
    assignedTo: '',
    onAssignChange: () => {},
};

describe('DossierHeader delete action', () => {
    it('hides the Delete button when canDelete is false', () => {
        render(<DossierHeader {...baseProps} canDelete={false} onDelete={() => {}} />);
        expect(screen.queryByRole('button', { name: /delete application/i })).toBeNull();
    });

    it('shows the Delete button and calls onDelete when canDelete is true', () => {
        const onDelete = vi.fn();
        render(<DossierHeader {...baseProps} canDelete onDelete={onDelete} />);
        const btn = screen.getByRole('button', { name: /delete application/i });
        fireEvent.click(btn);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});
