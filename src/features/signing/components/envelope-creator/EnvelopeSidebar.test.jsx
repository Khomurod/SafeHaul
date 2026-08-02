// Focused coverage for the envelope creator's left sidebar. Every fixture is
// artificial — reserved example domains and a fictional 555-01xx number — and no
// real recipient, document or signing information appears or is snapshotted.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvelopeSidebar } from './EnvelopeSidebar';
import { getFieldIcon } from './fieldDefinitions';

const FIELD_A = { id: 'f-a', type: 'signature', label: 'Signature', page: 1 };
const FIELD_B = { id: 'f-b', type: 'text', label: 'Full Name', page: 2 };

let handlers;

function renderSidebar(overrides = {}) {
    const props = {
        creatorMode: 'request',
        isEditingTemplate: false,
        recipientName: '',
        recipientEmail: '',
        recipientPhone: '',
        deliveryMethod: 'email',
        file: null,
        fields: [],
        selectedFieldId: null,
        getIcon: getFieldIcon,
        ...handlers,
        ...overrides,
    };
    return { ...render(<EnvelopeSidebar {...props} />), props };
}

beforeEach(() => {
    handlers = {
        setRecipientName: vi.fn(),
        setRecipientEmail: vi.fn(),
        setRecipientPhone: vi.fn(),
        setDeliveryMethod: vi.fn(),
        handleFileChange: vi.fn(),
        addField: vi.fn(),
        setSelectedFieldId: vi.fn(),
        removeField: vi.fn(),
    };
});

describe('EnvelopeSidebar — rail sections', () => {
    const withFile = { file: { name: 'artificial.pdf' }, fields: [FIELD_A, FIELD_B] };

    it('groups the rail into Setup, Add Fields and Fields, in that order', () => {
        renderSidebar(withFile);
        const names = screen
            .getAllByRole('button', { expanded: true })
            .map((b) => b.textContent.replace(/\s+/g, ' ').trim());
        expect(names).toEqual(['Setup', 'Add Fields', 'Fields22 placed']);
    });

    it('starts every section open so nothing the workflow needs is hidden', () => {
        renderSidebar(withFile);
        expect(screen.queryAllByRole('button', { expanded: false })).toHaveLength(0);
    });

    it('collapses and reopens a section, hiding its panel in between', () => {
        renderSidebar(withFile);
        const header = screen.getByRole('button', { name: /^Add Fields/ });
        const panel = document.getElementById(header.getAttribute('aria-controls'));

        expect(panel).toBeVisible();
        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(panel).not.toBeVisible();
        // `hidden` takes the panel out of the accessibility tree entirely, so a
        // collapsed section is unreachable rather than merely invisible.
        expect(screen.queryByRole('button', { name: 'Add Signature field' })).toBeNull();

        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(panel).toBeVisible();
    });

    it('points each disclosure at the panel it controls', () => {
        renderSidebar(withFile);
        for (const name of [/^Setup/, /^Add Fields/, /^Fields/]) {
            const header = screen.getByRole('button', { name });
            const panel = document.getElementById(header.getAttribute('aria-controls'));
            expect(panel).toBeInTheDocument();
            expect(panel.contains(header)).toBe(false);
        }
    });

    it('states the placed count in text, not only as a badge', () => {
        renderSidebar(withFile);
        expect(screen.getByRole('button', { name: /^Fields/ })).toHaveAccessibleName(/2 placed/);
    });

    it('omits the count entirely when nothing is placed', () => {
        renderSidebar({ file: { name: 'artificial.pdf' }, fields: [] });
        expect(screen.getByRole('button', { name: 'Fields' })).toBeInTheDocument();
        expect(screen.getByText('No fields placed yet.')).toBeInTheDocument();
    });

    it('names the loaded document in Setup instead of the upload prompt', () => {
        renderSidebar({ file: { name: 'artificial.pdf' } });
        expect(screen.getByText('artificial.pdf')).toBeInTheDocument();
        expect(screen.queryByText('Upload a PDF first')).not.toBeInTheDocument();
    });

    it('renders a supplied field-tools slot inside the Fields section', () => {
        renderSidebar({ ...withFile, fieldTools: <p>artificial tools</p> });
        const header = screen.getByRole('button', { name: /^Fields/ });
        const panel = document.getElementById(header.getAttribute('aria-controls'));
        expect(within(panel).getByText('artificial tools')).toBeInTheDocument();
    });
});

describe('EnvelopeSidebar — recipient section visibility', () => {
    it('shows the recipient section in request mode', () => {
        renderSidebar();
        expect(screen.getByRole('heading', { name: 'Recipient' })).toBeInTheDocument();
    });

    it('hides the recipient section in template mode', () => {
        renderSidebar({ creatorMode: 'template' });
        expect(screen.queryByRole('heading', { name: 'Recipient' })).not.toBeInTheDocument();
    });

    it('hides the recipient section while editing a template', () => {
        renderSidebar({ creatorMode: 'request', isEditingTemplate: true });
        expect(screen.queryByRole('heading', { name: 'Recipient' })).not.toBeInTheDocument();
    });
});

describe('EnvelopeSidebar — recipient inputs', () => {
    it('labels all three inputs and keeps their types', () => {
        renderSidebar();
        expect(screen.getByLabelText(/^Name/)).toHaveAttribute('type', 'text');
        expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
        expect(screen.getByLabelText('Phone')).toHaveAttribute('type', 'tel');
    });

    it('marks the name as required and the others as not required', () => {
        renderSidebar();
        expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-required', 'true');
        expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-required');
        expect(screen.getByLabelText('Phone')).not.toHaveAttribute('aria-required');
    });

    it('renders the supplied values', () => {
        renderSidebar({
            recipientName: 'Pat Example',
            recipientEmail: 'pat@example.test',
            recipientPhone: '555-0142',
        });
        expect(screen.getByLabelText(/^Name/)).toHaveValue('Pat Example');
        expect(screen.getByLabelText('Email')).toHaveValue('pat@example.test');
        expect(screen.getByLabelText('Phone')).toHaveValue('555-0142');
    });

    it('reports each edit with the raw input value', () => {
        renderSidebar();
        fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Alex Example' } });
        expect(handlers.setRecipientName).toHaveBeenCalledWith('Alex Example');

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alex@example.test' } });
        expect(handlers.setRecipientEmail).toHaveBeenCalledWith('alex@example.test');

        fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555-0175' } });
        expect(handlers.setRecipientPhone).toHaveBeenCalledWith('555-0175');
    });
});

describe('EnvelopeSidebar — delivery method', () => {
    it('offers the four options in order inside a labelled group', () => {
        renderSidebar();
        const group = screen.getByRole('group', { name: 'Delivery' });
        const labels = within(group).getAllByRole('button').map((b) => b.textContent.trim());
        expect(labels).toEqual(['Email', 'SMS', 'Both', 'Link']);
    });

    it.each([
        ['Email', 'email'],
        ['SMS', 'sms'],
        ['Both', 'both'],
        ['Link', 'copy'],
    ])('sends the exact %s key', (label, key) => {
        renderSidebar({ deliveryMethod: 'email' });
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(handlers.setDeliveryMethod).toHaveBeenCalledWith(key);
    });

    it('states the selection with aria-pressed, not colour alone', () => {
        renderSidebar({ deliveryMethod: 'sms' });
        expect(screen.getByRole('button', { name: 'SMS' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Both' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Link' })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('EnvelopeSidebar — upload state', () => {
    it('prompts for a PDF and exposes a reachable file input before upload', () => {
        const { container } = renderSidebar({ file: null });
        expect(screen.getByText('Upload a PDF first')).toBeInTheDocument();

        const input = container.querySelector('input[type="file"]');
        expect(input).toHaveAttribute('accept', 'application/pdf');
        expect(input).toHaveAccessibleName('Choose a PDF file');
        // Visually hidden, not display:none, so it is not removed from the page.
        expect(input.className).toContain('ds-visually-hidden');
        expect(input.className).not.toContain('hidden ');
    });

    it('opens the file picker from the approved button', () => {
        const { container } = renderSidebar({ file: null });
        const input = container.querySelector('input[type="file"]');
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});

        fireEvent.click(screen.getByRole('button', { name: 'Choose File' }));
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('forwards the change event to handleFileChange', () => {
        const { container } = renderSidebar({ file: null });
        fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [] } });
        expect(handlers.handleFileChange).toHaveBeenCalledTimes(1);
    });

    it('hides the palette and the shortcut hint until a file exists', () => {
        renderSidebar({ file: null });
        expect(screen.queryByRole('button', { name: /Add Signature field/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/Duplicate a placed field/)).not.toBeInTheDocument();
    });

    it('shows the shortcut hint once a file exists', () => {
        renderSidebar({ file: { name: 'artificial.pdf' } });
        expect(screen.getByText(/Duplicate a placed field/)).toBeInTheDocument();
        expect(screen.queryByText('Upload a PDF first')).not.toBeInTheDocument();
    });
});

describe('EnvelopeSidebar — field palette', () => {
    const withFile = { file: { name: 'artificial.pdf' } };

    it('names the palette section the same way in every mode', () => {
        // The mode used to be restated here as "Fields" vs "Setup Fields". The
        // top bar now carries the mode, so the rail section is simply what it
        // does — one label, in both modes.
        const view = renderSidebar({ ...withFile, creatorMode: 'request' });
        expect(screen.getByRole('heading', { name: /^Add Fields/ })).toBeInTheDocument();
        view.unmount();

        renderSidebar({ ...withFile, creatorMode: 'template' });
        expect(screen.getByRole('heading', { name: /^Add Fields/ })).toBeInTheDocument();
    });

    it('renders every category and item in order', () => {
        renderSidebar(withFile);
        for (const title of ['Standard Fields', 'Signer Info', 'Data Fields']) {
            expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
        }
        const items = screen.getAllByRole('button', { name: /^Add .* field$/ })
            .map((b) => b.getAttribute('aria-label'));
        expect(items).toEqual([
            'Add Signature field',
            'Add Initial field',
            'Add Date Signed field',
            'Add Name field',
            'Add Email field',
            'Add Company field',
            'Add Text field',
            'Add Checkbox field',
        ]);
    });

    it.each([
        ['Add Signature field', 'signature'],
        ['Add Date Signed field', 'date_signed'],
        ['Add Email field', 'email_field'],
        ['Add Checkbox field', 'checkbox'],
    ])('%s calls addField with the exact template id', (name, templateId) => {
        renderSidebar(withFile);
        fireEvent.click(screen.getByRole('button', { name }));
        expect(handlers.addField).toHaveBeenCalledTimes(1);
        expect(handlers.addField).toHaveBeenCalledWith(templateId);
    });

    it('uses semantic tone tokens rather than the legacy palette', () => {
        const { container } = renderSidebar(withFile);
        expect(container.innerHTML).not.toMatch(/bg-(yellow|orange|green|blue|indigo|purple)-\d{2,3}/);
        expect(screen.getByRole('button', { name: 'Add Signature field' }).className)
            .toContain('bg-ds-status-warning-bg');
    });
});

describe('EnvelopeSidebar — placed fields', () => {
    const placed = { file: { name: 'artificial.pdf' }, fields: [FIELD_A, FIELD_B] };

    it('is absent when nothing is placed', () => {
        renderSidebar({ file: { name: 'artificial.pdf' }, fields: [] });
        expect(screen.queryByRole('heading', { name: /^Placed/ })).not.toBeInTheDocument();
    });

    it('counts the placed fields in its heading', () => {
        renderSidebar(placed);
        expect(screen.getByRole('heading', { name: 'Placed (2)' })).toBeInTheDocument();
    });

    it('lists each field with its label and page', () => {
        renderSidebar(placed);
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Signature');
        expect(rows[0]).toHaveTextContent('P1');
        expect(rows[1]).toHaveTextContent('Full Name');
        expect(rows[1]).toHaveTextContent('P2');
    });

    it('selects a field by its exact id from the keyboard-reachable row', () => {
        renderSidebar(placed);
        const row = screen.getAllByRole('button', { name: /Full Name/ })[0];
        row.focus();
        expect(row).toHaveFocus();
        fireEvent.click(row);
        expect(handlers.setSelectedFieldId).toHaveBeenCalledTimes(1);
        expect(handlers.setSelectedFieldId).toHaveBeenCalledWith('f-b');
    });

    it('marks the selected row with aria-pressed', () => {
        renderSidebar({ ...placed, selectedFieldId: 'f-a' });
        const listItems = screen.getAllByRole('listitem');
        const rows = listItems.map((li) => within(li).getAllByRole('button')[0]);
        expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
        expect(rows[1]).toHaveAttribute('aria-pressed', 'false');
    });

    it('removes a field by its exact id without also selecting it', () => {
        renderSidebar(placed);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Full Name on page 2' }));
        expect(handlers.removeField).toHaveBeenCalledTimes(1);
        expect(handlers.removeField).toHaveBeenCalledWith('f-b');
        expect(handlers.setSelectedFieldId).not.toHaveBeenCalled();
    });

    it('gives every remove control a unique name', () => {
        renderSidebar(placed);
        expect(screen.getByRole('button', { name: 'Remove Signature on page 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove Full Name on page 2' })).toBeInTheDocument();
    });

    it('does not nest one interactive control inside another', () => {
        const { container } = renderSidebar(placed);
        for (const button of container.querySelectorAll('button')) {
            expect(button.querySelector('button')).toBeNull();
        }
    });
});

describe('EnvelopeSidebar — presentation and accessibility', () => {
    it('uses the approved Button for the delivery toggle group', () => {
        renderSidebar({ deliveryMethod: 'sms' });
        const group = screen.getByRole('group', { name: 'Delivery' });
        for (const button of within(group).getAllByRole('button')) {
            expect(button).toHaveClass('ds-button');
        }
        expect(screen.getByRole('button', { name: 'SMS' })).toHaveAttribute('data-variant', 'primary');
        expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute('data-variant', 'secondary');
    });

    it('uses the approved Button for each placed-field row and its remove control', () => {
        renderSidebar({ file: { name: 'artificial.pdf' }, fields: [FIELD_A, FIELD_B] });
        for (const row of screen.getAllByRole('listitem')) {
            const [rowButton, removeButton] = within(row).getAllByRole('button');
            expect(rowButton).toHaveClass('ds-button');
            expect(rowButton).toHaveAttribute('data-variant', 'ghost');
            expect(rowButton).toHaveAttribute('data-justify', 'start');
            expect(removeButton).toHaveClass('ds-icon-button');
        }
    });

    it('keeps the palette buttons as the one documented non-Button exception', () => {
        // The approved Button has no semantic status tone, and the tone here is the
        // legend for the PDF overlay colours. Recorded in-code and in the roadmap.
        renderSidebar({ file: { name: 'artificial.pdf' } });
        const palette = screen.getAllByRole('button', { name: /^Add .* field$/ });
        expect(palette).toHaveLength(8);
        for (const button of palette) {
            expect(button).not.toHaveClass('ds-button');
            expect(button.className).toContain('min-h-11');
            expect(button.className).toContain('focus-visible:shadow-ds-focus');
            expect(button.className).toMatch(/bg-ds-status-(warning|success|info|accent)-bg/);
        }
    });

    it('leaves no other raw button in the sidebar', () => {
        const { container } = renderSidebar({
            file: { name: 'artificial.pdf' },
            fields: [FIELD_A, FIELD_B],
        });
        const raw = Array.from(container.querySelectorAll('button'))
            .filter((b) => !b.classList.contains('ds-button'))
            .map((b) => b.getAttribute('aria-label') || b.textContent.trim());
        // The three rail-section disclosures and the eight documented palette
        // buttons. Both exceptions are recorded in the component.
        expect(raw).toEqual([
            'Setup',
            'Add Fields',
            'Add Signature field',
            'Add Initial field',
            'Add Date Signed field',
            'Add Name field',
            'Add Email field',
            'Add Company field',
            'Add Text field',
            'Add Checkbox field',
            'Fields22 placed',
        ]);
    });

    it('uses no unsupported 9px or 10px interface text and no raw hex colours', () => {
        const { container } = renderSidebar({ file: { name: 'artificial.pdf' }, fields: [FIELD_A, FIELD_B] });
        expect(container.innerHTML).not.toMatch(/text-\[9px\]|text-\[10px\]/);
        expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    it('keeps the sidebar width and scroll behaviour', () => {
        const { container } = renderSidebar();
        const aside = container.querySelector('aside');
        expect(aside.className).toContain('w-64');
        expect(aside.className).toContain('overflow-y-auto');
        expect(aside).toHaveAccessibleName('Envelope setup');
    });

    it('has no accessibility violations before upload', async () => {
        const { container } = renderSidebar({ file: null });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations with a file and placed fields', async () => {
        const { container } = renderSidebar({
            file: { name: 'artificial.pdf' },
            fields: [FIELD_A, FIELD_B],
            selectedFieldId: 'f-a',
            deliveryMethod: 'both',
        });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations in template mode', async () => {
        const { container } = renderSidebar({ creatorMode: 'template', file: { name: 'artificial.pdf' } });
        expect((await axe(container)).violations).toEqual([]);
    });
});
