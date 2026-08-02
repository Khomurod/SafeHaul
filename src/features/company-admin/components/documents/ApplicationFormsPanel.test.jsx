// Application Forms: enabled ids, ordering, the required default, and the
// explicit-save contract. All templates below are artificial.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationFormsPanel } from './ApplicationFormsPanel';

const templates = [
    { id: 'tpl-a', title: 'Drug Policy' },
    { id: 'tpl-b', title: 'Offer Letter' },
    { id: 'tpl-c', title: 'W-9' },
];

const baseProps = () => ({
    templates,
    templatesLoading: false,
    postSubmitTemplateIds: ['tpl-a', 'tpl-b'],
    postSubmitRequiredById: { 'tpl-a': true, 'tpl-b': false },
    togglePostSubmitRequired: vi.fn(),
    savingPostSubmitTemplates: false,
    handleSavePostSubmitTemplates: vi.fn(),
    movePostSubmitTemplate: vi.fn(),
    isTemplateEnabledPostSubmit: (id) => ['tpl-a', 'tpl-b'].includes(id),
    togglePostSubmitTemplate: vi.fn(),
});

const renderPanel = (overrides = {}) => {
    const props = { ...baseProps(), ...overrides };
    return { props, ...render(<ApplicationFormsPanel {...props} />) };
};

beforeEach(() => vi.clearAllMocks());

describe('enabled forms and ordering', () => {
    it('lists the enabled forms in their stored order, numbered', () => {
        renderPanel();
        const items = screen.getAllByRole('listitem').map((li) => li.textContent);
        expect(items[0]).toContain('1. Drug Policy');
        expect(items[1]).toContain('2. Offer Letter');
    });

    it('moves a form up and down through the exact callback contract', () => {
        const { props } = renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Move Offer Letter up' }));
        expect(props.movePostSubmitTemplate).toHaveBeenCalledWith('tpl-b', 'up');

        fireEvent.click(screen.getByRole('button', { name: 'Move Drug Policy down' }));
        expect(props.movePostSubmitTemplate).toHaveBeenCalledWith('tpl-a', 'down');
    });

    it('disables the move that cannot happen and explains why', () => {
        renderPanel();
        const first = screen.getByRole('button', { name: 'Move Drug Policy up' });
        expect(first).toBeDisabled();
        expect(first).toHaveAttribute('title', 'Drug Policy is already first');

        const last = screen.getByRole('button', { name: 'Move Offer Letter down' });
        expect(last).toBeDisabled();
        expect(last).toHaveAttribute('title', 'Offer Letter is already last');
    });

    it('says so when nothing is enabled', () => {
        renderPanel({ postSubmitTemplateIds: [] });
        expect(screen.getByText('No follow-up forms enabled yet.')).toBeInTheDocument();
    });

    it('skips an id whose template no longer exists', () => {
        renderPanel({ postSubmitTemplateIds: ['tpl-a', 'tpl-deleted'] });
        expect(screen.queryByText(/tpl-deleted/)).not.toBeInTheDocument();
    });
});

describe('required state', () => {
    it('reflects the stored required flag per form', () => {
        renderPanel();
        expect(screen.getByRole('checkbox', { name: 'Required for Drug Policy' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Required for Offer Letter' })).not.toBeChecked();
    });

    it('treats a missing flag as required — the backward-compatible default', () => {
        renderPanel({ postSubmitRequiredById: {} });
        expect(screen.getByRole('checkbox', { name: 'Required for Drug Policy' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Required for Offer Letter' })).toBeChecked();
    });

    it('toggles required through the exact callback contract', () => {
        const { props } = renderPanel();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Required for Offer Letter' }));
        expect(props.togglePostSubmitRequired).toHaveBeenCalledWith('tpl-b');
    });
});

describe('choosing templates', () => {
    it('checks the templates that are already enabled', () => {
        renderPanel();
        expect(screen.getByRole('checkbox', { name: 'Drug Policy' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'W-9' })).not.toBeChecked();
    });

    it('toggles a template through the exact callback contract', () => {
        const { props } = renderPanel();
        fireEvent.click(screen.getByRole('checkbox', { name: 'W-9' }));
        expect(props.togglePostSubmitTemplate).toHaveBeenCalledWith('tpl-c');
    });

    it('reports loading and an empty template list', () => {
        const { unmount } = renderPanel({ templatesLoading: true });
        expect(screen.getAllByRole('status').some((n) => n.textContent.includes('Loading templates'))).toBe(true);
        unmount();

        renderPanel({ templates: [], postSubmitTemplateIds: [] });
        expect(screen.getByText(/No templates saved yet/)).toBeInTheDocument();
    });
});

describe('explicit save', () => {
    it('saves only when the operator asks', () => {
        const { props } = renderPanel();
        expect(props.handleSavePostSubmitTemplates).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('checkbox', { name: 'W-9' }));
        fireEvent.click(screen.getByRole('button', { name: 'Move Offer Letter up' }));
        expect(props.handleSavePostSubmitTemplates).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Save forms/ }));
        expect(props.handleSavePostSubmitTemplates).toHaveBeenCalledTimes(1);
    });

    it('says changes are not live until saved', () => {
        renderPanel();
        expect(screen.getByText(/not live until you press/i)).toBeInTheDocument();
    });

    it('announces the in-flight save', () => {
        renderPanel({ savingPostSubmitTemplates: true });
        expect(screen.getByText('Saving post-application forms…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Save forms/ })).toHaveAttribute('aria-busy', 'true');
    });

    it('has no accessibility violations', async () => {
        const { container } = renderPanel();
        expect((await axe(container)).violations).toEqual([]);
    });
});
