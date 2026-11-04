// The company signature's properties: the image it shows, uploaded here as a
// PNG or JPEG of up to 2 MB, under a random name in the company's originals.
// Storage and the link callable are doubles; every path is artificial.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('uuid', () => ({ v4: () => 'random-name' }));

import { FieldPropertiesPanel } from './FieldPropertiesPanel';
import { resetCompanySignatureUrls } from '@features/signing/hooks/useCompanySignatureUrl';

const PATH = 'secure_documents/co-1/originals/company-signatures/existing.png';
const NEW_PATH = 'secure_documents/co-1/originals/company-signatures/random-name.png';
const IMAGE_URL = 'https://files.example.test/company-signature.png';

const companySignature = (over = {}) => ({
    id: 'cs-1',
    type: 'company_signature',
    label: 'Company Signature',
    required: false,
    readOnly: true,
    prefillPolicy: 'locked',
    defaultValue: '',
    fontSize: 'Auto',
    ...over,
});

const getIcon = vi.fn(() => <svg data-testid="field-icon" />);

function setup({ activeField = companySignature(), isTemplate = false } = {}) {
    const updateActiveField = vi.fn();
    const utils = render(
        <FieldPropertiesPanel
            activeField={activeField}
            updateActiveField={updateActiveField}
            getIcon={getIcon}
            companyId="co-1"
            isTemplate={isTemplate}
        />,
    );
    return { updateActiveField, ...utils };
}

const picker = () => screen.getByLabelText('Company signature image');
const choose = (file) => fireEvent.change(picker(), { target: { files: [file] } });
const png = (name = 'stamp.png', size = 1024) => new File([new Uint8Array(size)], name, { type: 'image/png' });

beforeEach(() => {
    vi.resetAllMocks();
    resetCompanySignatureUrls();
    mocks.uploadBytes.mockResolvedValue(undefined);
    mocks.getSignedDocumentUrl.mockResolvedValue({ data: { success: true, url: IMAGE_URL } });
});

describe('FieldPropertiesPanel — a company signature', () => {
    it('offers the image upload instead of the signer options', () => {
        setup();
        expect(screen.getByText('Company signature Field')).toBeInTheDocument();
        expect(picker()).toHaveAttribute('accept', 'image/png,image/jpeg');
        expect(screen.getByText('PNG or JPEG, up to 2 MB. The signer sees it as it is and cannot change it.')).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Required Field' })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /Read Only/ })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Default value')).not.toBeInTheDocument();
        expect(screen.getByText('No image yet.')).toBeInTheDocument();
    });

    it('says in a template that the image can come with each document', () => {
        setup({ isTemplate: true });
        expect(screen.getByText('Upload the signature here, or for each document.')).toBeInTheDocument();
    });

    it.each([
        ['a GIF', new File(['gif'], 'stamp.gif', { type: 'image/gif' }), 'Choose a PNG or JPEG image.'],
        ['a PDF', new File(['pdf'], 'stamp.pdf', { type: 'application/pdf' }), 'Choose a PNG or JPEG image.'],
        ['an image over 2 MB', png('big.png', 2 * 1024 * 1024 + 1), 'The image is larger than 2 MB. Choose a smaller one.'],
    ])('refuses %s and uploads nothing', async (_label, file, message) => {
        const { updateActiveField } = setup();
        choose(file);

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(mocks.uploadBytes).not.toHaveBeenCalled();
        expect(updateActiveField).not.toHaveBeenCalled();
    });

    it('uploads a PNG under a random name and stores its path on the field', async () => {
        const { updateActiveField } = setup();
        const file = png();
        choose(file);

        await waitFor(() => expect(updateActiveField).toHaveBeenCalledWith('companySignaturePath', NEW_PATH));
        expect(mocks.uploadBytes).toHaveBeenCalledTimes(1);
        expect(mocks.uploadBytes).toHaveBeenCalledWith({ path: NEW_PATH }, file, { contentType: 'image/png' });
    });

    it('stores a JPEG with its own extension', async () => {
        const { updateActiveField } = setup();
        choose(new File(['jpg'], 'stamp.jpeg', { type: 'image/jpeg' }));

        await waitFor(() => expect(updateActiveField).toHaveBeenCalledWith(
            'companySignaturePath',
            'secure_documents/co-1/originals/company-signatures/random-name.jpg',
        ));
    });

    it('says so when the upload fails, and keeps the image it had', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.uploadBytes.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'storage/unauthorized' }));
        const { updateActiveField } = setup({ activeField: companySignature({ companySignaturePath: PATH }) });
        choose(png());

        expect(await screen.findByText('The image could not be uploaded. Try again.')).toBeInTheDocument();
        expect(updateActiveField).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('shows the image it has, through a short-lived link, and offers to replace it', async () => {
        setup({ activeField: companySignature({ companySignaturePath: PATH }) });

        const image = await screen.findByRole('img', { name: 'Company signature' });
        expect(image).toHaveAttribute('src', IMAGE_URL);
        expect(mocks.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: PATH });
        expect(screen.getByText('Replace image')).toBeInTheDocument();
    });

    it('has no axe violations', async () => {
        const { container } = setup({ activeField: companySignature({ companySignaturePath: PATH }) });
        await screen.findByRole('img', { name: 'Company signature' });
        expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
    });
});
