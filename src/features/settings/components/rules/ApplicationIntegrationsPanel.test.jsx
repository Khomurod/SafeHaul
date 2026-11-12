import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationIntegrationsPanel } from './ApplicationIntegrationsPanel';

describe('ApplicationIntegrationsPanel', () => {
    it('is a section headed Report uploads, a switch for each report, both off for a company that never chose', () => {
        render(<ApplicationIntegrationsPanel onChange={vi.fn()} />);
        const section = screen.getByRole('region', { name: 'Report uploads' });
        expect(section).toHaveTextContent(/A company that leaves these off is not affected in any way/);
        expect(screen.getByRole('switch', { name: 'Enable FMCSA PSP report import' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('switch', { name: 'Enable Motor vehicle record (MVR) import' })).toHaveAttribute('aria-checked', 'false');
    });

    it('turns one report on and keeps the other as it was', () => {
        const onChange = vi.fn();
        render(
            <ApplicationIntegrationsPanel
                integrations={{ mvr: { enabled: true, note: 'kept' } }}
                onChange={onChange}
            />,
        );
        expect(screen.getByRole('switch', { name: 'Enable Motor vehicle record (MVR) import' })).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('switch', { name: 'Enable FMCSA PSP report import' }));
        expect(onChange).toHaveBeenCalledWith({
            mvr: { enabled: true, note: 'kept' },
            psp: { enabled: true },
        });
    });

    it('lets a company user look without changing anything', () => {
        render(<ApplicationIntegrationsPanel onChange={vi.fn()} readOnly />);
        for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled();
    });

    it('keeps each switch on its row, after the help that explains it', () => {
        render(<ApplicationIntegrationsPanel onChange={vi.fn()} />);
        const row = document.querySelector('[data-integration="psp"]');
        expect(row).toHaveTextContent(/^FMCSA PSP report importApplicants can upload their PSP report/);
        expect(row.lastElementChild).toContainElement(screen.getByRole('switch', { name: 'Enable FMCSA PSP report import' }));
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<ApplicationIntegrationsPanel onChange={vi.fn()} />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
