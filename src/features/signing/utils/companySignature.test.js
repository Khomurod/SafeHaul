// The company signature: the image a company places on a template or a
// document, which the signer sees fixed and never fills. All data artificial.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
    COMPANY_SIGNATURE_MAX_BYTES,
    companySignatureImageError,
    companySignatureStoragePath,
    fieldsMissingCompanySignature,
    isCompanySignatureField,
    withCompanySignaturePaths,
    withoutCompanySignatureValues,
} from './companySignature';

const image = (type, size = 1024) => ({ type, size, name: 'stamp' });

describe('companySignatureImageError', () => {
    it('accepts a PNG or a JPEG of up to 2 MB', () => {
        expect(companySignatureImageError(image('image/png'))).toBeNull();
        expect(companySignatureImageError(image('image/jpeg', COMPANY_SIGNATURE_MAX_BYTES))).toBeNull();
    });

    it('refuses any other kind of file', () => {
        for (const type of ['image/gif', 'image/svg+xml', 'image/webp', 'application/pdf', '']) {
            expect(companySignatureImageError(image(type))).toBe('Choose a PNG or JPEG image.');
        }
    });

    it('refuses an image over 2 MB', () => {
        expect(companySignatureImageError(image('image/png', COMPANY_SIGNATURE_MAX_BYTES + 1)))
            .toBe('The image is larger than 2 MB. Choose a smaller one.');
    });

    it('refuses nothing chosen', () => {
        expect(companySignatureImageError(undefined)).toBe('Choose a PNG or JPEG image.');
    });
});

describe('companySignatureStoragePath', () => {
    it('stores the image with the company originals, under its own random name', () => {
        expect(companySignatureStoragePath('co-1', image('image/png'), 'a1b2'))
            .toBe('secure_documents/co-1/originals/company-signatures/a1b2.png');
        expect(companySignatureStoragePath('co-1', image('image/jpeg'), 'c3d4'))
            .toBe('secure_documents/co-1/originals/company-signatures/c3d4.jpg');
    });

    it("is a path the server draws from: its folder is the server's, for this company only", () => {
        // `functions/shared/companySignature.js` is pure; the sealed PDF and the
        // signing room use only an image in the folder it names.
        const server = createRequire(import.meta.url)('../../../../functions/shared/companySignature.js');
        for (const type of ['image/png', 'image/jpeg']) {
            const path = companySignatureStoragePath('co-1', image(type), 'a1b2');
            expect(server.companySignatureImagePath('co-1', { companySignaturePath: path })).toBe(path);
            expect(server.companySignatureImagePath('co-2', { companySignaturePath: path })).toBeNull();
        }
    });
});

describe('fields', () => {
    const fields = [
        { id: 'sig', type: 'signature' },
        { id: 'cs-1', type: 'company_signature', companySignaturePath: 'secure_documents/co-1/originals/company-signatures/a.png' },
        { id: 'cs-2', type: 'company_signature', companySignaturePath: '  ' },
        { id: 'cs-3', type: 'company_signature' },
    ];

    it('knows a company signature by its type', () => {
        expect(fields.map(isCompanySignatureField)).toEqual([false, true, true, true]);
        expect(isCompanySignatureField(null)).toBe(false);
    });

    it('lists the company signatures that have no image', () => {
        expect(fieldsMissingCompanySignature(fields).map((field) => field.id)).toEqual(['cs-2', 'cs-3']);
        expect(fieldsMissingCompanySignature(undefined)).toEqual([]);
    });

    it('gives this document its own image without touching the fields it was given', () => {
        const next = withCompanySignaturePaths(fields, { 'cs-3': 'secure_documents/co-1/originals/company-signatures/b.png', sig: 'ignored' });
        expect(next.map((field) => field.companySignaturePath)).toEqual([
            undefined,
            'secure_documents/co-1/originals/company-signatures/a.png',
            '  ',
            'secure_documents/co-1/originals/company-signatures/b.png',
        ]);
        expect(fields[3].companySignaturePath).toBeUndefined();
        expect(withCompanySignaturePaths(fields, {})).toEqual(fields);
    });

    it('never submits a value for a company signature', () => {
        expect(withoutCompanySignatureValues(fields, { sig: 'ink', 'cs-1': '', 'cs-3': 'x', other: 'kept' }))
            .toEqual({ sig: 'ink', other: 'kept' });
    });
});
