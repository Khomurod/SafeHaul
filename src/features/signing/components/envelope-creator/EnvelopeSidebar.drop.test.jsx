// A drop the envelope's PDF picker refuses. Every fixture is artificial; no
// real recipient or document information appears.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvelopeSidebar } from './EnvelopeSidebar';
import { getFieldIcon } from './fieldDefinitions';

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
    handlers = { handleFileChange: vi.fn(), addField: vi.fn(), removeField: vi.fn() };
});

/**
 * The picker here renders only while `!file`, so a mixed drop hands
 * `handleFileChange` the PDF, the branch flips, and anything the picker rendered
 * about the file it refused goes with it. Found in review on 2026-08-26.
 */
describe('EnvelopeSidebar — a refused drop', () => {

    const dropOn = (...files) => {
        const transfer = new DataTransfer();
        for (const f of files) transfer.items.add(f);
        fireEvent.drop(document.querySelector('input[type="file"]').closest('label'), {
            dataTransfer: transfer,
        });
    };
    const pdf = (name) => new File(['%PDF'], name, { type: 'application/pdf' });
    const png = (name) => new File(['png'], name, { type: 'image/png' });

    it('reports the refused file and still passes on the accepted one', () => {
        const { props } = renderSidebar();
        dropOn(pdf('contract.pdf'), png('logo.png'));

        expect(props.handleFileChange).toHaveBeenCalledTimes(1);
        const files = props.handleFileChange.mock.calls[0][0].target.files;
        expect(Array.from(files).map((f) => f.name)).toEqual(['contract.pdf']);
        expect(screen.getByRole('alert'))
            .toHaveTextContent('logo.png was not added. It is not an accepted file type.');
    });

    it('shows exactly one message, not one per live region', () => {
        renderSidebar();
        dropOn(png('logo.png'));

        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('keeps the message once the accepted file replaces the picker', () => {
        // The real transition: the parent re-renders with the chosen file, the
        // picker is gone, and the sidebar still says what it refused.
        const { rerender, props } = renderSidebar();
        dropOn(pdf('contract.pdf'), png('logo.png'));
        rerender(<EnvelopeSidebar {...props} file={{ name: 'contract.pdf' }} />);

        expect(document.querySelector('input[type="file"]')).toBeNull();
        expect(screen.getByRole('alert')).toHaveTextContent('logo.png was not added');
    });

    it('says nothing when the dropped file is accepted', () => {
        renderSidebar();
        dropOn(pdf('contract.pdf'));

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
