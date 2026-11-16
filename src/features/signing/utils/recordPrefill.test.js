/**
 * What a document sent from a template takes from the applicant or lead it is
 * sent to: the listed fields only (`functions/shared/applicationTokenFields.json`,
 * the server's list for post-application documents too; the server's use of it
 * is held by `functions/test/unit/applicationTokenFields.parity.test.js`), and
 * the record it is filed under. Every name and value is artificial.
 */
import { describe, expect, it } from 'vitest';
import { buildPrefillContext, resolveTemplateText } from './prefillEngine';
import { linkedRecordFor, pickedRecord, recordKind, recordLink, recordPrefill } from './recordPrefill';

const APPLICATION = {
    id: 'app-1',
    collectionName: 'applications',
    firstName: 'Jane',
    middleName: 'Q',
    lastName: 'Driver',
    email: 'jane.driver@example.test',
    phone: '555-0100',
    street: '1 Artificial Way',
    city: 'Testville',
    state: 'TX',
    zip: '75001',
    dob: '1990-02-03',
    cdlNumber: 'D1234567',
    cdlState: 'TX',
    cdlClass: 'A',
    cdlExpiration: '2028-01-01',
    medCardExpiration: '2027-06-30',
    // Never on a document: a sealed copy is read by the whole team.
    ssn: '123-45-6789',
    signature: 'TEXT_SIGNATURE:Jane Driver',
    signatureType: 'typed',
    'agree-electronic': true,
    consentToContact: 'yes',
    confirmationNumber: 'CONF-1',
    applicantId: 'uid-1',
    driverId: 'uid-1',
    userId: 'uid-1',
    companyId: 'co-1',
    'cdl-front': { name: 'cdl.jpg', storagePath: 'companies/co-1/applications/guest_uploads/cdl.jpg' },
};

describe('recordPrefill', () => {
    it('takes the listed fields of the record, and nothing else', () => {
        expect(recordPrefill(APPLICATION)).toEqual({
            first_name: 'Jane',
            middle_name: 'Q',
            last_name: 'Driver',
            address: '1 Artificial Way',
            street: '1 Artificial Way',
            city: 'Testville',
            state: 'TX',
            zip: '75001',
            dob: '1990-02-03',
            cdl_number: 'D1234567',
            cdl_state: 'TX',
            cdl_class: 'A',
            cdl_expiration: '2028-01-01',
            med_card_expiration: '2027-06-30',
        });
    });

    it('never fills the SSN, a signature, a consent or an id, however a template names them', () => {
        const picked = pickedRecord(APPLICATION);
        const context = buildPrefillContext({ recipientName: 'Jane Driver', extra: picked.prefill });
        const template = '{{ssn}} {{signature}} {{signatureType}} {{consentToContact}} '
            + '{{confirmationNumber}} {{applicantId}} {{driverId}} {{userId}} {{companyId}} {{id}}';
        const { value, unresolvedTokens } = resolveTemplateText(template, context);

        expect(value.trim()).toBe('');
        expect(unresolvedTokens).toEqual(expect.arrayContaining(['ssn', 'signature', 'applicantid', 'confirmationnumber']));
        expect(JSON.stringify(picked)).not.toMatch(/123-45-6789|TEXT_SIGNATURE|CONF-1|uid-1/);
    });

    it('leaves the email to the recipient field, which the recruiter may correct', () => {
        expect(recordPrefill(APPLICATION)).not.toHaveProperty('email');
    });

    it('takes text and numbers only, trimmed', () => {
        expect(recordPrefill({ firstName: '  Jane ', zip: 75001, city: { name: 'Testville' }, state: ['TX'], dob: null })).toEqual({
            first_name: 'Jane',
            zip: '75001',
        });
        expect(recordPrefill(null)).toEqual({});
    });
});

describe('pickedRecord and the request it links', () => {
    it('keeps an applicant as its collection and id, with its name and prefill', () => {
        expect(pickedRecord(APPLICATION)).toEqual({
            collectionName: 'applications',
            id: 'app-1',
            name: 'Jane Driver',
            prefill: recordPrefill(APPLICATION),
        });
        expect(recordKind('applications')).toBe('Applicant');
        expect(recordLink(pickedRecord(APPLICATION))).toEqual({ sourceApplicationId: 'app-1' });
    });

    it('links a lead by its own field', () => {
        const lead = pickedRecord({ id: 'lead-1', collectionName: 'leads', firstName: 'Dana', lastName: 'Alvarez' });
        expect(recordKind('leads')).toBe('Lead');
        expect(recordLink(lead)).toEqual({ sourceLeadId: 'lead-1' });
    });

    it('links nothing without a record, or for a record of another kind', () => {
        expect(pickedRecord({ id: 'x-1', collectionName: 'drivers', firstName: 'Jo' })).toBeNull();
        expect(pickedRecord({ collectionName: 'leads', firstName: 'Jo' })).toBeNull();
        expect(recordLink(null)).toEqual({});
    });

    it('holds while the recipient is still the picked record, case and spacing aside', () => {
        const picked = pickedRecord(APPLICATION);
        expect(linkedRecordFor(picked, 'Jane Driver')).toBe(picked);
        expect(linkedRecordFor(picked, '  jane   DRIVER ')).toBe(picked);
        // Another name is another person: the document is not filed in Jane's record.
        expect(linkedRecordFor(picked, 'John Driver')).toBeNull();
        expect(linkedRecordFor(null, 'Jane Driver')).toBeNull();
    });
});
