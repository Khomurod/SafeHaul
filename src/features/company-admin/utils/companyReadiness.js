/**
 * Company readiness: the settings a company has not set up, for the admin's
 * dashboard card (`CompanyReadinessCard`). Pure: the reads are
 * `useCompanyReadiness`, each `{ status: 'ok', value }` or `{ status: 'failed' }`.
 *
 * - `email`: `getEmailSettingsMeta`'s settings. Without a verified company email
 *   no email goes out (`emailService.js` sends only through it).
 * - `sms`: `integrations/sms_provider`. Texting works once it is active with a
 *   line, as Settings → Text messages decides.
 * - `company`: the company document. `contact.email` is where PEV results and
 *   no-response notices go (`carrierEmail` in
 *   `functions/employmentVerification/notifications.js`, which also takes an
 *   older `adminEmail` or flat `email`); `pevCcEmails` is optional, so only a
 *   hint; `postApplicationTemplates` are the forms offered after applying.
 * - `formTemplates`: each enabled form's template by id (`null`: deleted). A
 *   form whose company signature has no image is refused after an application.
 *
 * A read that failed says "Could not check", never "missing". PEV items are
 * left out where PEV is off, form items where E-Docs is.
 */
import { normalizePostApplicationTemplates } from '@features/driver-app/components/application/publicApplyHelpers';
import { fieldsMissingCompanySignature } from '@features/signing/utils/companySignature';

export const READINESS_LINKS = Object.freeze({
    email: '/company/settings?section=email',
    sms: '/company/settings?section=sms',
    company: '/company/settings?section=company',
    forms: '/company/e-docs?view=forms',
    templates: '/company/e-docs?view=templates',
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const ok = (read) => read?.status === 'ok';

/** Where the carrier's PEV notices go, read as the server reads it. */
function noticeEmail(company) {
    return text(company?.contact?.email) || text(company?.adminEmail) || text(company?.email);
}

/** Whether texting works: an active provider with a line, as Settings → Text messages decides. */
export function smsConfigured(config) {
    return Boolean(config?.isActive) && Array.isArray(config?.inventory) && config.inventory.length > 0;
}

const unknown = (id, title, href, linkLabel) => ({
    id,
    state: 'unknown',
    title,
    text: 'This could not be checked just now. Open the page to see it.',
    href,
    linkLabel,
});

function emailItem(read) {
    const linkLabel = 'Open email settings';
    if (!ok(read)) return unknown('email', 'Company email', READINESS_LINKS.email, linkLabel);
    const settings = read.value || {};
    if (settings.isVerified) return null;
    return text(settings.smtpHost)
        ? {
            id: 'email',
            state: 'todo',
            title: 'Company email could not be verified',
            text: 'The saved settings did not connect, so signing links, PEV requests and other emails may not go out.',
            href: READINESS_LINKS.email,
            linkLabel,
        }
        : {
            id: 'email',
            state: 'todo',
            title: 'Company email is not connected',
            text: 'Signing links, PEV requests and other emails go out from the company’s own email. None are sent until it is connected.',
            href: READINESS_LINKS.email,
            linkLabel,
        };
}

function smsItem(read) {
    const linkLabel = 'Open text message settings';
    if (!ok(read)) return unknown('sms', 'Text messages', READINESS_LINKS.sms, linkLabel);
    if (smsConfigured(read.value)) return null;
    return {
        id: 'sms',
        state: 'todo',
        title: 'Text messages are not set up',
        text: 'No phone line is connected, so signing links, campaigns and automated texts are not texted.',
        href: READINESS_LINKS.sms,
        linkLabel,
    };
}

/** Each enabled form's problem, if any: a deleted template or a company signature without an image. */
function formProblems(forms, templates) {
    const missing = [];
    const unsigned = [];
    for (const form of forms) {
        const template = templates[form.templateId];
        if (template === null || template === undefined) missing.push(form.title);
        else if (fieldsMissingCompanySignature(template.fields).length > 0) unsigned.push(form.title);
    }
    return { missing, unsigned };
}

function formItems(forms, read) {
    if (forms.length === 0) {
        return [{
            id: 'forms',
            state: 'todo',
            title: 'No post-application forms',
            text: 'Drivers are offered no forms to sign after they apply.',
            href: READINESS_LINKS.forms,
            linkLabel: 'Open application forms',
        }];
    }
    if (!ok(read)) return [unknown('signatures', 'Post-application forms', READINESS_LINKS.templates, 'Open templates')];
    const { missing, unsigned } = formProblems(forms, read.value || {});
    return [
        unsigned.length > 0 && {
            id: 'signatures',
            state: 'todo',
            title: 'A company signature has no image',
            text: `Refused after an application until its template has the image: ${unsigned.join(', ')}.`,
            href: READINESS_LINKS.templates,
            linkLabel: 'Open templates',
        },
        missing.length > 0 && {
            id: 'missing-templates',
            state: 'todo',
            title: 'A form’s template was deleted',
            text: `Not offered to drivers until it is removed or replaced: ${missing.join(', ')}.`,
            href: READINESS_LINKS.forms,
            linkLabel: 'Open application forms',
        },
    ].filter(Boolean);
}

/**
 * The items still to set up (`state: 'todo'`) or not checked (`'unknown'`), in
 * a fixed order, and the optional hints. Both empty: the company is ready.
 */
export function companyReadiness({ company, email, sms, formTemplates }) {
    const items = [emailItem(email), smsItem(sms)];
    const hints = [];

    if (!ok(company)) {
        items.push(unknown('company', 'Company profile and forms', READINESS_LINKS.company, 'Open company profile'));
        return { items: items.filter(Boolean), hints };
    }

    const profile = company.value || {};
    if (profile.features?.pev !== false) {
        if (!noticeEmail(profile)) {
            items.push({
                id: 'contact',
                state: 'todo',
                title: 'No company contact email',
                text: 'PEV results and no-response notices are emailed to it.',
                href: READINESS_LINKS.company,
                linkLabel: 'Open company profile',
            });
        }
        const copies = Array.isArray(profile.pevCcEmails) ? profile.pevCcEmails.filter((value) => text(value)) : [];
        if (copies.length === 0) {
            hints.push({
                id: 'pev-copies',
                title: 'PEV copies',
                text: 'Optional: send copies of each PEV request to up to five addresses.',
                href: READINESS_LINKS.email,
                linkLabel: 'Add PEV copies',
            });
        }
    }
    if (profile.features?.eDocs !== false) {
        items.push(...formItems(normalizePostApplicationTemplates(profile.postApplicationTemplates), formTemplates));
    }
    return { items: items.filter(Boolean), hints };
}
