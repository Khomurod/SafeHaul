// Preview as signer: it must reuse the real signer field rendering, stay
// read-only, perform no I/O, and remain perceivable without sight.
// react-pdf is stubbed (jsdom has no PDF renderer); every field is artificial.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseSpies = vi.hoisted(() => ({
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    uploadBytes: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('react-pdf', () => ({
    Document: ({ children }) => <div data-testid="pdf-document">{children}</div>,
    Page: ({ pageNumber }) => <div data-testid="pdf-page" data-page={pageNumber} />,
    pdfjs: { GlobalWorkerOptions: {} },
}));
// Any accidental I/O would show up as a call on one of these.
vi.mock('firebase/firestore', () => firebaseSpies);
vi.mock('firebase/storage', () => firebaseSpies);
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(),
    httpsCallable: firebaseSpies.httpsCallable,
}));
vi.mock('@lib/firebase', () => ({ db: {}, storage: {}, auth: { currentUser: null } }));

import { SignerPreviewDialog } from './SignerPreviewDialog';

const field = (id, overrides = {}) => ({
    id,
    type: 'text',
    label: `Field ${id}`,
    page: 1,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    required: true,
    readOnly: false,
    prefillPolicy: 'editable',
    bindingKey: '',
    defaultValue: '',
    fontSize: 'Auto',
    ...overrides,
});

const renderPreview = (overrides = {}) =>
    render(
        <SignerPreviewDialog
            file={{ name: 'artificial.pdf' }}
            numPages={3}
            fields={[field('a')]}
            companyName="Artificial Freight Co"
            onClose={vi.fn()}
            {...overrides}
        />,
    );

beforeEach(() => vi.clearAllMocks());

describe('SignerPreviewDialog — overlay geometry', () => {
    it('sizes the field layer from the page it rendered, not the editor zoom', () => {
        // The layer used to take an explicit height from the editor's
        // `pageDimensions`, measured at the editor's own zoom. The preview
        // always renders at 560px wide, so any other editor zoom displaced every
        // field vertically. `inset-0` is the only correct sizing here.
        const { container } = renderPreview();
        const layer = container.querySelector('[data-testid="signer-preview-layer"]');
        expect(layer).not.toBeNull();
        expect(layer.style.height).toBe('');
        expect(layer.className).toContain('inset-0');
    });
});

describe('dialog semantics', () => {
    it('names itself and says it changes nothing', () => {
        renderPreview();
        expect(screen.getByRole('dialog', { name: 'Preview as signer' })).toBeInTheDocument();
        expect(screen.getByText(/Nothing is saved or sent, and no signing link is created/i)).toBeInTheDocument();
    });

    it('closes through the supplied callback', () => {
        const onClose = vi.fn();
        renderPreview({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('performs no I/O', () => {
    it('never reads or writes Firestore, Storage or a callable', () => {
        renderPreview({
            fields: [field('a', { bindingKey: 'full_name', defaultValue: '{{full_name}}' }), field('b', { page: 2 })],
            recipientName: 'Artificial Person',
        });

        for (const spy of Object.values(firebaseSpies)) {
            expect(spy).not.toHaveBeenCalled();
        }
    });
});

describe('read-only field layer', () => {
    it('renders the real signer field overlays', () => {
        renderPreview({ fields: [field('a'), field('b', { type: 'signature' })] });
        const layer = screen.getByTestId('signer-preview-layer');
        // `data-testid="field-overlay"` comes from the shared SignerFieldOverlay.
        expect(within(layer).getAllByTestId('field-overlay')).toHaveLength(2);
    });

    it('marks the field layer inert so nothing can be typed into it', () => {
        renderPreview();
        expect(screen.getByTestId('signer-preview-layer')).toHaveAttribute('inert');
    });

    it('positions overlays with the signer geometry, not the editor geometry', () => {
        renderPreview({ fields: [field('a', { x: 30, y: 40, width: 20, height: 6 })] });
        const overlay = within(screen.getByTestId('signer-preview-layer')).getByTestId('field-overlay');
        expect(overlay).toHaveStyle({ left: '30%', top: '40%' });
    });

    it('shows only the current page and follows page navigation', () => {
        renderPreview({ fields: [field('a', { page: 1 }), field('b', { page: 2 })] });
        const layer = () => screen.getByTestId('signer-preview-layer');
        expect(within(layer()).getAllByTestId('field-overlay')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
        expect(within(layer()).getAllByTestId('field-overlay')).toHaveLength(1);
        expect(within(layer()).getByTestId('field-overlay')).toHaveAttribute('data-field-id', 'b');
    });

    it('disables paging at both ends', () => {
        renderPreview({ numPages: 2 });
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });

    it('opens on the page the editor was showing', () => {
        renderPreview({ initialPage: 3 });
        expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    });
});

describe('accessible field summary', () => {
    it('lists every field with its type, page and state', () => {
        renderPreview({
            fields: [
                field('a', { label: 'Driver name', bindingKey: 'full_name', defaultValue: '{{full_name}}' }),
                field('b', { label: 'Sign here', type: 'signature', page: 2 }),
            ],
            recipientName: 'Artificial Person',
        });

        const summary = screen.getByRole('complementary', { name: 'What the recipient sees' });
        expect(within(summary).getByText('Driver name')).toBeInTheDocument();
        expect(within(summary).getByText('Sign here')).toBeInTheDocument();
        expect(within(summary).getByText('Page 2')).toBeInTheDocument();
        expect(within(summary).getByText('Shows: Artificial Person')).toBeInTheDocument();
    });

    it('marks the fields the recipient still has to complete', () => {
        renderPreview({ fields: [field('sig', { type: 'signature', label: 'Signature' })] });
        const summary = screen.getByRole('complementary', { name: 'What the recipient sees' });
        expect(within(summary).getByText('Recipient completes')).toBeInTheDocument();
        expect(within(summary).getByText('The recipient must complete 1 field.')).toBeInTheDocument();
    });

    it('says when the recipient has nothing left to do', () => {
        renderPreview({
            fields: [field('a', { required: false })],
        });
        expect(screen.getByText('The recipient has nothing left to complete.')).toBeInTheDocument();
    });

    it('warns that sample values are standing in for a missing recipient', () => {
        renderPreview({ fields: [field('a', { bindingKey: 'full_name', defaultValue: '{{full_name}}' })] });
        expect(screen.getByText(/sample values/i)).toBeInTheDocument();
    });

    it('does not warn once a real recipient exists', () => {
        renderPreview({
            fields: [field('a', { bindingKey: 'full_name', defaultValue: '{{full_name}}' })],
            recipientName: 'Artificial Person',
        });
        expect(screen.queryByText(/sample values/i)).not.toBeInTheDocument();
    });

    it('raises locked required fields that would block the send', () => {
        renderPreview({
            fields: [
                field('blocked', {
                    label: 'Policy number',
                    required: true,
                    readOnly: true,
                    prefillPolicy: 'locked',
                    bindingKey: 'policy_number',
                    defaultValue: '{{policy_number}}',
                }),
            ],
            recipientName: 'Artificial Person',
        });
        expect(screen.getByRole('alert')).toHaveTextContent(/cannot be sent yet: Policy number/i);
    });

    it('handles an empty document', () => {
        renderPreview({ fields: [] });
        expect(screen.getByText('No fields placed yet.')).toBeInTheDocument();
    });

    it('prompts for a PDF when none is loaded', () => {
        renderPreview({ file: null });
        expect(screen.getByText('Upload a PDF to preview it.')).toBeInTheDocument();
    });
});

describe('accessibility', () => {
    it('has no serious or critical violations', async () => {
        const { container } = renderPreview({
            fields: [field('a'), field('b', { type: 'signature', label: 'Sign' })],
            recipientName: 'Artificial Person',
        });
        const results = await axe(container);
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    });
});
