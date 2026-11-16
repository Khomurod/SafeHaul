// Template library: New template, search, sorting, the shown metadata, the
// five actions (Delete for admins only) and the schema-safety gate on
// Duplicate. All templates below are artificial.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateLibraryPanel } from './TemplateLibraryPanel';

/** A phone, where New template stays beside the heading. */
const isMobileMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@shared/hooks/useIsMobile', () => ({ useIsMobile: () => isMobileMock() }));

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
    onCreate: vi.fn(),
    duplicatingTemplateId: null,
});

const renderPanel = (overrides = {}) => {
    const props = { ...baseProps(), ...overrides };
    return { props, ...render(<TemplateLibraryPanel {...props} />) };
};

beforeEach(() => {
    vi.clearAllMocks();
    isMobileMock.mockImplementation(() => false);
});

describe('library controls', () => {
    it('offers New template beside the library heading, which starts a new template', () => {
        const { props } = renderPanel();
        const library = screen.getByRole('region', { name: 'Template library' });
        fireEvent.click(within(library).getByRole('button', { name: 'New template' }));
        expect(props.onCreate).toHaveBeenCalledTimes(1);
    });

    it('keeps New template beside the heading on a phone, before the search and Sort by (C2)', () => {
        isMobileMock.mockImplementation(() => true);
        renderPanel();
        const heading = screen.getByRole('heading', { level: 2, name: 'Template library' });
        const button = screen.getByRole('button', { name: 'New template' });
        // The heading's own row holds it: the search comes after it, not before.
        expect(heading.parentElement.parentElement).toContainElement(button);
        expect(button.compareDocumentPosition(screen.getByLabelText('Search templates')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('offers search and sorting', () => {
        const { props } = renderPanel();
        fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'offer' } });
        expect(props.setSearch).toHaveBeenCalledWith('offer');

        fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'title' } });
        expect(props.setSort).toHaveBeenCalledWith('title');
    });

    it('names the search without a visible label and puts Sort by beside its list, in one bar (C2)', () => {
        renderPanel();
        const library = screen.getByRole('region', { name: 'Template library' });
        const search = within(library).getByRole('searchbox', { name: 'Search templates' });
        expect(search).toHaveAttribute('placeholder', 'Template title');
        expect(within(library).queryByText('Search templates')).not.toBeInTheDocument();
        const sort = within(library).getByRole('combobox', { name: 'Sort by' });
        expect(within(library).getByText('Sort by').closest('label').parentElement).toContainElement(sort);
        // No framed card around the bar.
        expect(library).not.toHaveClass('border');
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

    it('makes Delete a quiet icon button, not a solid red one on every card', () => {
        renderPanel();
        const remove = screen.getByRole('button', { name: 'Delete Artificial Offer Letter' });
        expect(remove).toHaveAttribute('data-variant', 'ghost');
        expect(remove).toHaveClass('ds-icon-button');
        expect(remove).not.toHaveTextContent('Delete');
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

    it('offers no Delete where deleting is not allowed, and every other action still', () => {
        renderPanel({ onDelete: undefined });
        expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
        for (const action of ['Send', 'Edit', 'Duplicate', 'Configure']) {
            expect(screen.getByRole('button', { name: `${action} Artificial Offer Letter` })).toBeVisible();
        }
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
        // Only the heading's New template: an empty search is not an empty library.
        expect(screen.getAllByRole('button', { name: 'New template' })).toHaveLength(1);
    });

    it('offers New template in an empty library, as New Document promises', () => {
        const { props, container } = renderPanel({ templates: [] });
        const empty = within(container).getByText('No templates saved yet.').parentElement;
        fireEvent.click(within(empty).getByRole('button', { name: 'New template' }));
        expect(props.onCreate).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations when the library is empty', async () => {
        const { container } = renderPanel({ templates: [] });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderPanel({ postSubmitTemplateIds: ['tpl-1'] });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('template card (C2)', () => {
    it('lays the four actions out as an even two-by-two grid, Send first', () => {
        renderPanel();
        const send = screen.getByRole('button', { name: 'Send Artificial Offer Letter' });
        const grid = send.parentElement;
        expect(grid).toHaveClass('grid', 'grid-cols-2');
        expect(within(grid).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
            'Send Artificial Offer Letter',
            'Edit Artificial Offer Letter',
            'Duplicate Artificial Offer Letter',
            'Configure Artificial Offer Letter',
        ]);
        expect(within(grid).getAllByRole('button').every((button) => button.getAttribute('data-full-width') === 'true')).toBe(true);
    });

    it('shows the field count in the accent tone under the title', () => {
        renderPanel();
        expect(screen.getByText('2 fields').closest('.ds-badge')).toHaveAttribute('data-tone', 'accent');
    });
});
