import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CampaignCard } from './CampaignCard';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

function draft(overrides = {}) {
    return { id: '1', name: 'Draft Campaign', status: 'draft', matchCount: 50, messageConfig: { method: 'Email' }, ...overrides };
}

describe('CampaignCard', () => {
    it('renders the progress bar, counts, failed, and method for a live campaign', () => {
        render(
            <CampaignCard
                campaign={{
                    id: '1', name: 'Test Campaign', status: 'active',
                    progress: { processedCount: 25, totalCount: 100, failedCount: 2 },
                    messageConfig: { method: 'SMS' },
                }}
            />,
        );
        expect(screen.getByText('Progress')).toBeInTheDocument();
        expect(screen.getByText('25 / 100')).toBeInTheDocument();
        expect(screen.getByText('2 Failed')).toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Send progress' });
        expect(bar).toHaveAttribute('aria-valuenow', '25');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
    });

    it('hides the failed count when there are no failures', () => {
        render(
            <CampaignCard
                campaign={{ id: '1', name: 'C', status: 'active', progress: { processedCount: 10, totalCount: 10, failedCount: 0 }, messageConfig: { method: 'SMS' } }}
            />,
        );
        expect(screen.queryByText(/Failed/)).not.toBeInTheDocument();
    });

    it('renders the leads/method layout for drafts (no progress)', () => {
        render(<CampaignCard campaign={draft()} />);
        expect(screen.getByText('50 leads')).toBeInTheDocument();
        expect(screen.getByText('Email')).toBeInTheDocument();
        expect(screen.queryByText('Progress')).not.toBeInTheDocument();
    });

    it('defaults method to SMS and leads to 0 when missing', () => {
        render(<CampaignCard campaign={{ id: '1', name: 'C', status: 'draft' }} />);
        expect(screen.getByText('0 leads')).toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
    });

    it.each([
        ['active', 'Active', 'success'],
        ['draft', 'Draft', 'neutral'],
        ['completed', 'Completed', 'info'],
        ['scheduled', 'Scheduled', 'warning'],
        ['queued', 'Queued', 'neutral'],
        ['cancelled', 'Cancelled', 'neutral'],
        ['failed', 'Failed', 'neutral'],
    ])('presents %s as label "%s" with tone %s', (status, label, tone) => {
        render(<CampaignCard campaign={{ id: '1', name: 'C', status }} />);
        const badge = screen.getByText(label);
        expect(badge.closest('.ds-badge')).toHaveAttribute('data-tone', tone);
    });

    it('opens the menu from an accessible trigger and triggers delete for a draft', () => {
        const onDelete = vi.fn();
        const campaign = draft({ id: '3', name: 'Delete Me' });
        render(<CampaignCard campaign={campaign} onDelete={onDelete} />);

        const trigger = screen.getByRole('button', { name: 'Campaign options' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Campaign' }));
        expect(onDelete).toHaveBeenCalledWith(campaign);
    });

    it.each(['active', 'queued', 'scheduled', 'paused'])(
        'offers Cancel (not Delete) for a live %s session',
        (status) => {
            const onCancel = vi.fn();
            const onDelete = vi.fn();
            const campaign = { id: '4', name: 'Live', status };
            render(<CampaignCard campaign={campaign} onCancel={onCancel} onDelete={onDelete} />);
            fireEvent.click(screen.getByRole('button', { name: 'Campaign options' }));

            expect(screen.queryByRole('menuitem', { name: 'Delete Campaign' })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel Campaign' }));
            expect(onCancel).toHaveBeenCalledWith(campaign);
            expect(onDelete).not.toHaveBeenCalled();
        },
    );

    it('offers Delete for a terminal session even when onCancel is wired', () => {
        const onCancel = vi.fn();
        const onDelete = vi.fn();
        const campaign = { id: '5', name: 'Done', status: 'completed' };
        render(<CampaignCard campaign={campaign} onCancel={onCancel} onDelete={onDelete} />);
        fireEvent.click(screen.getByRole('button', { name: 'Campaign options' }));

        expect(screen.queryByRole('menuitem', { name: 'Cancel Campaign' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Campaign' }));
        expect(onDelete).toHaveBeenCalledWith(campaign);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('falls back to Delete for a live session when onCancel is not wired (drafts tab)', () => {
        const onDelete = vi.fn();
        const campaign = { id: '6', name: 'Live draft-tab', status: 'active' };
        render(<CampaignCard campaign={campaign} onDelete={onDelete} />);
        fireEvent.click(screen.getByRole('button', { name: 'Campaign options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Campaign' }));
        expect(onDelete).toHaveBeenCalledWith(campaign);
    });

    it('closes the menu on Escape', () => {
        render(<CampaignCard campaign={draft()} onDelete={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Campaign options' }));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('shows View Report for non-draft statuses only, and calls the handler', () => {
        const onViewReport = vi.fn();
        const { rerender } = render(<CampaignCard campaign={draft()} onViewReport={onViewReport} />);
        expect(screen.queryByRole('button', { name: 'View Report' })).not.toBeInTheDocument();

        rerender(<CampaignCard campaign={{ id: '1', name: 'C', status: 'completed' }} onViewReport={onViewReport} />);
        fireEvent.click(screen.getByRole('button', { name: 'View Report' }));
        expect(onViewReport).toHaveBeenCalledTimes(1);
    });

    it('opens the campaign from the keyboard-accessible Details button and from a card body click', () => {
        const onClick = vi.fn();
        render(<CampaignCard campaign={draft()} onClick={onClick} onDelete={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /Details/ }));
        expect(onClick).toHaveBeenCalledTimes(1);

        // A click on non-interactive card body content also opens it.
        fireEvent.click(screen.getByText('Draft Campaign'));
        expect(onClick).toHaveBeenCalledTimes(2);
    });

    it('has no accessibility violations (menu closed and open)', async () => {
        const { container } = render(
            <CampaignCard
                campaign={{ id: '1', name: 'Live', status: 'active', progress: { processedCount: 5, totalCount: 10, failedCount: 1 }, messageConfig: { method: 'SMS' } }}
                onCancel={vi.fn()}
                onViewReport={vi.fn()}
            />,
        );
        expect((await axe(container)).violations).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: 'Campaign options' }));
        expect((await axe(container)).violations).toEqual([]);
    });
});
