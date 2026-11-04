/**
 * Company readiness: what the dashboard says is not set up, from what the
 * dashboard read once. A read that failed is said as such, never as missing.
 * All names and addresses are artificial.
 */
import { describe, expect, it } from 'vitest';
import { READINESS_LINKS, companyReadiness } from './companyReadiness';

const ok = (value) => ({ status: 'ok', value });
const FAILED = { status: 'failed' };

const SIGNATURE = 'secure_documents/co-1/originals/company-signatures/stamp.png';
const READY_COMPANY = {
    contact: { email: 'office@example.test' },
    pevCcEmails: ['safety@example.test'],
    postApplicationTemplates: [{ templateId: 'tpl-w9', title: 'W-9', enabled: true, required: true }],
};
const READY = {
    company: ok(READY_COMPANY),
    email: ok({ smtpHost: 'smtp.example.test', isVerified: true }),
    sms: ok({ isActive: true, inventory: [{ phoneNumber: '+15555550100' }] }),
    formTemplates: ok({ 'tpl-w9': { title: 'W-9 Form', fields: [{ id: 'cs', type: 'company_signature', companySignaturePath: SIGNATURE }] } }),
};
const ids = (result) => result.items.map((item) => item.id);

describe('a company with everything set up', () => {
    it('has nothing to set up and no hint', () => {
        expect(companyReadiness(READY)).toEqual({ items: [], hints: [] });
    });
});

describe('what is not set up', () => {
    it('a company email that is not connected', () => {
        const result = companyReadiness({ ...READY, email: ok({ smtpHost: '', isVerified: false }) });
        expect(result.items).toEqual([expect.objectContaining({
            id: 'email', state: 'todo', title: 'Company email is not connected', href: READINESS_LINKS.email,
        })]);
    });

    it('a company email saved but not verified', () => {
        const [item] = companyReadiness({ ...READY, email: ok({ smtpHost: 'smtp.example.test', isVerified: false }) }).items;
        expect(item).toMatchObject({ id: 'email', state: 'todo', title: 'Company email could not be verified' });
    });

    it.each([
        ['no integration document', null],
        ['one not active', { isActive: false, inventory: [{ phoneNumber: '+15555550100' }] }],
        ['one with no line', { isActive: true, inventory: [] }],
    ])('text messages, with %s', (_label, value) => {
        expect(companyReadiness({ ...READY, sms: ok(value) }).items).toEqual([expect.objectContaining({
            id: 'sms', state: 'todo', href: READINESS_LINKS.sms,
        })]);
    });

    it('the contact email PEV notices go to, read as the server reads it', () => {
        const without = { ...READY_COMPANY, contact: { email: '  ' } };
        expect(ids(companyReadiness({ ...READY, company: ok(without) }))).toEqual(['contact']);
        // An older document's address is still one the notices use.
        expect(ids(companyReadiness({ ...READY, company: ok({ ...without, adminEmail: 'admin@example.test' }) }))).toEqual([]);
        expect(ids(companyReadiness({ ...READY, company: ok({ ...without, email: 'flat@example.test' }) }))).toEqual([]);
    });

    it('no post-application form', () => {
        const company = ok({ ...READY_COMPANY, postApplicationTemplates: [{ templateId: 'tpl-w9', enabled: false }] });
        expect(companyReadiness({ ...READY, company, formTemplates: ok({}) }).items).toEqual([expect.objectContaining({
            id: 'forms', state: 'todo', href: READINESS_LINKS.forms,
        })]);
    });

    it('a form whose company signature has no image, named, since such a form is refused', () => {
        const formTemplates = ok({ 'tpl-w9': { title: 'W-9 Form', fields: [{ id: 'cs', type: 'company_signature', companySignaturePath: '' }] } });
        const [item] = companyReadiness({ ...READY, formTemplates }).items;
        expect(item).toMatchObject({ id: 'signatures', state: 'todo', href: READINESS_LINKS.templates });
        expect(item.text).toContain('W-9');
    });

    it('a form whose template no longer exists', () => {
        const [item] = companyReadiness({ ...READY, formTemplates: ok({ 'tpl-w9': null }) }).items;
        expect(item).toMatchObject({ id: 'missing-templates', state: 'todo', href: READINESS_LINKS.forms });
        expect(item.text).toContain('W-9');
    });

    it('lists them in a fixed order', () => {
        const result = companyReadiness({
            company: ok({ postApplicationTemplates: [] }),
            email: ok({}),
            sms: ok(null),
            formTemplates: ok({}),
        });
        expect(ids(result)).toEqual(['email', 'sms', 'contact', 'forms']);
    });
});

describe('the optional PEV copies', () => {
    it('are a hint, never something to set up', () => {
        const result = companyReadiness({ ...READY, company: ok({ ...READY_COMPANY, pevCcEmails: [] }) });
        expect(result.items).toEqual([]);
        expect(result.hints).toEqual([expect.objectContaining({ id: 'pev-copies', href: READINESS_LINKS.email })]);
    });
});

describe('a read that failed', () => {
    it('is said as not checked, never as missing', () => {
        const result = companyReadiness({ ...READY, email: FAILED, sms: FAILED });
        expect(result.items.map((item) => [item.id, item.state])).toEqual([['email', 'unknown'], ['sms', 'unknown']]);
    });

    it('of the company leaves its items unchecked, and checks the forms of none', () => {
        const result = companyReadiness({ ...READY, company: FAILED, formTemplates: FAILED });
        expect(result.items.map((item) => [item.id, item.state])).toEqual([['company', 'unknown']]);
        expect(result.hints).toEqual([]);
    });

    it('of the forms\' templates says the signatures were not checked', () => {
        const result = companyReadiness({ ...READY, formTemplates: FAILED });
        expect(result.items.map((item) => [item.id, item.state])).toEqual([['signatures', 'unknown']]);
    });
});

describe('a company with a feature switched off', () => {
    it('is not asked about PEV notices or copies without PEV', () => {
        const company = ok({ ...READY_COMPANY, features: { pev: false }, contact: {}, pevCcEmails: [] });
        expect(companyReadiness({ ...READY, company })).toEqual({ items: [], hints: [] });
    });

    it('is not asked about post-application forms without E-Docs', () => {
        const company = ok({ ...READY_COMPANY, features: { eDocs: false }, postApplicationTemplates: [] });
        expect(companyReadiness({ ...READY, company, formTemplates: ok({}) })).toEqual({ items: [], hints: [] });
    });
});
