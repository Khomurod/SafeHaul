import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useNavigate: () => mocks.navigate };
});

import { SandboxTransferSuccess } from './SandboxTransferSuccess';

function renderScreen(state) {
    const entry = state
        ? { pathname: '/sandbox/transfer-success', state }
        : { pathname: '/sandbox/transfer-success' };
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <SandboxTransferSuccess />
        </MemoryRouter>,
    );
}

describe('SandboxTransferSuccess', () => {
    beforeEach(() => {
        mocks.navigate.mockReset();
    });

    it('shows the company name from location state', () => {
        renderScreen({ companyName: 'Acme Freight' });
        expect(screen.getByText('Acme Freight')).toBeInTheDocument();
    });

    it('falls back to the company id when no name is present', () => {
        renderScreen({ companyId: 'cmp-12345' });
        expect(screen.getByText('cmp-12345')).toBeInTheDocument();
    });

    it('falls back to the selected-company text when there is no state', () => {
        renderScreen();
        expect(screen.getByText('the selected company')).toBeInTheDocument();
    });

    it('preserves the New Application status wording', () => {
        renderScreen({ companyName: 'Acme Freight' });
        expect(screen.getByText('New Application')).toBeInTheDocument();
    });

    it('navigates to the Super Admin console', () => {
        renderScreen({ companyName: 'Acme Freight' });
        fireEvent.click(screen.getByRole('button', { name: 'Super Admin' }));
        expect(mocks.navigate).toHaveBeenCalledWith('/super-admin');
    });

    it('navigates home', () => {
        renderScreen({ companyName: 'Acme Freight' });
        fireEvent.click(screen.getByRole('button', { name: 'Home' }));
        expect(mocks.navigate).toHaveBeenCalledWith('/');
    });

    it('exposes a single level-1 heading', () => {
        renderScreen({ companyName: 'Acme Freight' });
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('Transfer complete');
    });

    it('renders both actions as keyboard-operable buttons', () => {
        renderScreen({ companyName: 'Acme Freight' });
        const superAdmin = screen.getByRole('button', { name: 'Super Admin' });
        const home = screen.getByRole('button', { name: 'Home' });
        expect(superAdmin).toBeEnabled();
        expect(home).toBeEnabled();
        expect(superAdmin).toHaveAttribute('type', 'button');
        expect(home).toHaveAttribute('type', 'button');

        superAdmin.focus();
        expect(superAdmin).toHaveFocus();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderScreen({ companyName: 'Acme Freight' });
        expect((await axe(container)).violations).toEqual([]);
    });
});
