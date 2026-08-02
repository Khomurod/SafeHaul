// Template library: search, sorting, the shown metadata, the five actions and
// the schema-safety gate on Duplicate. All templates below are artificial.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateLibraryPanel } from './TemplateLibraryPanel';

const template = (overrides = {}) => ({
    id: 'tpl-1',
    title: 'Artificial Offer Letter',
    storagePath: 'secure_documents/co/templates/1.pdf',
    fields: [{ type: 'signature' }, { type: 'text' }],
    updatedAt: { seconds: 1_700_000_000 },
    ...overrides,
});

const baseProps = () => ({
    templates: [template()],
    templatesLoading: false,
    postSubmitTemplateIds: [],
    search: '',
    setSearch: vi.fn(),
    sort: 'updated',
    setSort: vi.fn(),
    onSend: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onConfigure: vi.fn(),
    onDelete: vi.fn(),
    duplicatingTemplateId: null,
});

const renderPanel = (overrides = {}) => {
    const props = { ...baseProps(), ...overrides };
    return { props, ...render(<TemplateLibraryPanel {...props} />) };
};

beforeEach(() => vi.clearAllMocks());

describe('library controls', () => {
    it('offers search and sorting', () => {
        const { props } = renderPanel();
        fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'offer' } });
        expect(props.setSearch).toHaveBeenCalledWith('offer');

        fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'title' } });
        expect(props.setSort).toHaveBeenCalledWith('title');
    });

    it('reports how many templates are visible', () => {
        renderPanel({ templates: [template({ id: 'a' }), template({ id: 'b', title: 'W-9' })] });
        expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 2 templates');
    });

    it('filters by the search term', () => {
        renderPanel({
            templates: [template({ id: 'a', title: 'Offer Letter' }), template({ id: 'b', title: 'W-9' })],
            search: 'w-9',
        });
        expect(screen.getByRole('heading', { name: 'W-9' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Offer Letter' })).not.toBeInTheDocument();
    });

    it('sorts by title when asked', () => {
        renderPanel({
            templates: [template({ id: 'a', title: 'Zeta' }), template({ id: 'b', title: 'Alpha' })],
            sort: 'title',
        });
        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings).toEqual(['Alpha', 'Zeta']);
    });
});

describe('template card', () => {
    it('shows the title, field count, last-updated date and post-application usage', () => {
        renderPanel({ postSubmitTemplateIds: ['tpl-1'] });
        expect(screen.getByRole('heading', { name: 'Artificial Offer Letter' })).toBeInTheDocument();
        expect(screen.getByText('2 fields')).toBeInTheDocument();
        expect(screen.getByText(/^Updated /)).toBeInTheDocument();
        expect(screen.getByText('Sent after application')).toBeInTheDocument();
    });

    it('omits the updated badge when the template has no timestamp', () => {
        renderPanel({ templates: [template({ updatedAt: null })] });
        expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
    });

    it('exposes every action as a visible, distinctly named button', () => {
        renderPanel();
        for (const name of [
            'Send Artificial Offer Letter',
            'Edit Artificial Offer Letter',
            'Duplicate Artificial Offer Letter',
            'Configure Artificial Offer Letter',
            'Delete Artificial Offer Letter',
        ]) {
            expect(screen.getByRole('button', { name })).toBeVisible();
        }
    });

    it('makes Send the primary action', () => {
        renderPanel();
        expect(screen.getByRole('button', { name: 'Send Artificial Offer Letter' })).toHaveAttribute(
            'data-variant',
            'primary',
        );
    });

    it('calls each action with the exact expected argument', () => {
        const { props } = renderPanel();
        const item = props.templates[0];

        fireEvent.click(screen.getByRole('button', { name: 'Send Artificial Offer Letter' }));
        expect(props.onSend).toHaveBeenCalledWith(item);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Artificial Offer Letter' }));
        expect(props.onEdit).toHaveBeenCalledWith(item);

        fireEvent.click(screen.getByRole('button', { name: 'Duplicate Artificial Offer Letter' }));
        expect(props.onDuplicate).toHaveBeenCalledWith(item);

        fireEvent.click(screen.getByRole('button', { name: 'Configure Artificial Offer Letter' }));
        expect(props.onConfigure).toHaveBeenCalledWith(item);

        // Delete takes the id — that callback shape is a frozen contract.
        fireEvent.click(screen.getByRole('button', { name: 'Delete Artificial Offer Letter' }));
        expect(props.onDelete).toHaveBeenCalledWith('tpl-1');
    });

    it('names an untitled template distinguishably in its actions', () => {
        renderPanel({ templates: [template({ title: '' })] });
        expect(screen.getByRole('button', { name: 'Send Untitled' })).toBeInTheDocument();
    });
});

describe('duplicate safety', () => {
    it('disables Duplicate when the template has no stored PDF', () => {
        renderPanel({ templates: [template({ storagePath: '' })] });
        const button = screen.getByRole('button', { name: 'Duplicate Artificial Offer Letter' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', expect.stringMatching(/cannot be duplicated safely/i));
    });

    it('disables Duplicate when a field type is not one the editor persists', () => {
        renderPanel({ templates: [template({ fields: [{ type: 'radio_group' }] })] });
        expect(screen.getByRole('button', { name: 'Duplicate Artificial Offer Letter' })).toBeDisabled();
    });

    it('shows the in-flight duplicate on the right card only', () => {
        renderPanel({
            templates: [template({ id: 'tpl-1' }), template({ id: 'tpl-2', title: 'Second' })],
            duplicatingTemplateId: 'tpl-2',
        });
        expect(screen.getByRole('button', { name: 'Duplicate Second' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: 'Duplicate Artificial Offer Letter' })).not.toHaveAttribute(
            'aria-busy',
            'true',
        );
    });
});

describe('states', () => {
    it('reports loading', () => {
        renderPanel({ templatesLoading: true });
        expect(screen.getAllByRole('status').some((n) => n.textContent.includes('Loading templates'))).toBe(true);
    });

    it('distinguishes an empty library from an empty search', () => {
        const { unmount } = renderPanel({ templates: [] });
        expect(screen.getByText('No templates saved yet.')).toBeInTheDocument();
        unmount();

        renderPanel({ search: 'nothing matches this' });
        expect(screen.getByText('No templates match this search.')).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderPanel({ postSubmitTemplateIds: ['tpl-1'] });
        expect((await axe(container)).violations).toEqual([]);
    });
});
