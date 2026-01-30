import { render, screen, fireEvent } from '@testing-library/react';
import { LaunchPad } from './LaunchPad';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

// Mock dependencies
vi.mock('@lib/firebase', () => ({
    functions: {},
    db: {}
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => vi.fn().mockResolvedValue({ data: { success: true } })
}));

// Mock useToast
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({
        showSuccess: vi.fn(),
        showError: vi.fn()
    })
}));

describe('LaunchPad', () => {
    const mockCampaign = {
        name: 'Test Campaign',
        matchCount: 10,
        filters: { status: ['new'] },
        messageConfig: { message: 'Hi' }
    };

    it('renders launch immediately button', () => {
        render(
            <BrowserRouter>
                <LaunchPad companyId="123" campaign={mockCampaign} />
            </BrowserRouter>
        );

        expect(screen.getByText('Launch Immediately')).toBeInTheDocument();
        // Ensure schedule input is NOT present
        expect(screen.queryByLabelText(/Schedule/i)).not.toBeInTheDocument();
    });
});
