// The template wizard's company signature: the document starts with the
// template's image and may be given its own, for this document only. Storage
// and the link callable are doubles; every path is artificial.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    uploadBytes: vi.fn(),
    getSignedDocumentUrl: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/storage', () => ({
    ref: (_storage, path) => ({ path }),
    uploadBytes: (...args) => mocks.uploadBytes(...args),
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'getSignedDocumentUrl' ? mocks.getSignedDocumentUrl : undefined),
}));
vi.mock('uuid', () => ({ v4: () => 'own-image' }));

import { SendTemplateWizard } from './SendTemplateWizard';
import { resetCompanySignatureUrls } from '@features/signing/hooks/useCompanySignatureUrl';

const TEMPLATE_IMAGE = 'secure_documents/co-1/originals/company-signatures/template.png';
const noop = () => {};

function renderDetails(companySignature) {
    render(
        <SendTemplateWizard
            selectedTemplate={{ id: 'tpl-1', title: 'Artificial Offer Letter', fields: companySignature.fields }}
            onClose={noop}
            manualName="Artificial Person"
            setManualName={noop}
            manualEmail=""
            setManualEmail={noop}
            manualPhone=""
            setManualPhone={noop}
            deliveryMethod="email"
            setDeliveryMethod={noop}
            editablePrefillPartition={{ groups: [], plainFields: [] }}
            prefillValues={{}}
            setPrefillValues={noop}
            prefillValuesByGroupKey={{}}
            setPrefillValuesByGroupKey={noop}
            companySignature={companySignature}
            sending={false}
            executeTemplateSend={noop}
            filteredDrivers={[]}
            searchQuery=""
            setSearchQuery={noop}
            handleQuickSelect={noop}
        />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
    vi.resetAllMocks();
    resetCompanySignatureUrls();
    mocks.uploadBytes.mockResolvedValue(undefined);
    mocks.getSignedDocumentUrl.mockResolvedValue({ data: { url: 'https://files.example.test/template.png' } });
});

describe('SendTemplateWizard — the company signature', () => {
    it('shows the template\'s image and uploads this document\'s own in its place', async () => {
        const replace = vi.fn();
        renderDetails({
            companyId: 'co-1',
            fields: [{ id: 'cs-1', type: 'company_signature', companySignaturePath: TEMPLATE_IMAGE }],
            replace,
        });

        expect(screen.getByRole('heading', { name: 'Company signature' })).toBeInTheDocument();
        expect(await screen.findByRole('img', { name: 'Company signature' })).toHaveAttribute('src', 'https://files.example.test/template.png');

        fireEvent.change(screen.getByLabelText('Company signature image'), {
            target: { files: [new File(['png'], 'own.png', { type: 'image/png' })] },
        });

        await waitFor(() => expect(replace).toHaveBeenCalledWith('cs-1', 'secure_documents/co-1/originals/company-signatures/own-image.png'));
    });

    it('shows nothing for a template without a company signature', () => {
        renderDetails({ companyId: 'co-1', fields: [], replace: noop });
        expect(screen.queryByRole('heading', { name: 'Company signature' })).not.toBeInTheDocument();
    });
});
