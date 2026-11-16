// A placed company signature shows its image where the signer will see it, or
// says it has none yet. The link callable is a double; all fixtures are
// artificial.
import React from 'react';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSignedDocumentUrl: vi.fn() }));

vi.mock('react-draggable', async () => (await import('./ResizableDraggableField.support')).reactDraggableMock());
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'getSignedDocumentUrl' ? mocks.getSignedDocumentUrl : undefined),
}));

import { ResizableDraggableField } from './ResizableDraggableField';
import { makeRenderField, resetHarness } from './ResizableDraggableField.support';
import { resetCompanySignatureUrls } from '@features/signing/hooks/useCompanySignatureUrl';

const renderField = makeRenderField(ResizableDraggableField);
const PATH = 'secure_documents/co-1/originals/company-signatures/a1b2.png';
const companySignature = (overrides = {}) => ({ type: 'company_signature', label: 'Company Signature', ...overrides });

beforeEach(() => {
    resetHarness();
    mocks.getSignedDocumentUrl.mockReset();
    mocks.getSignedDocumentUrl.mockResolvedValue({ data: { url: 'https://files.example.test/stamp.png' } });
    resetCompanySignatureUrls();
});

describe('ResizableDraggableField — a company signature', () => {
    it('says it has no image yet, in its own neutral tone', () => {
        const { container } = renderField(companySignature());
        expect(screen.getByText('No image yet')).toBeInTheDocument();
        expect(container.querySelector('[data-draggable]').className).toContain('border-ds-status-neutral-border');
        expect(container.querySelector('[data-draggable]')).toHaveAccessibleName('Company Signature, company signature field on page 1');
        expect(mocks.getSignedDocumentUrl).not.toHaveBeenCalled();
    });

    it('shows its image on the page', async () => {
        renderField(companySignature({ companySignaturePath: PATH }));
        expect(await screen.findByRole('img', { name: 'Company signature' })).toHaveAttribute('src', 'https://files.example.test/stamp.png');
        expect(mocks.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: PATH });
        expect(screen.queryByText('No image yet')).not.toBeInTheDocument();
    });
});
