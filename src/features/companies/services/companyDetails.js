/**
 * A company's contact and registration details, in the one shape every screen saves.
 *
 * A company document holds them in one of two shapes. Edit Company and Settings
 * save `legal`, `contact` and an `address` object, and the application PDF reads
 * those. A company the Super Admin's older Create screen made holds flat fields
 * instead, with `address` the street line.
 *
 * `companyDetailsOf` reads either shape (a saved nested value wins, a flat one
 * fills it when it is blank) into the flat form the screens edit, and
 * `companyDetailsFields` turns that form back into the fields to save.
 * The server reads the same way (`snapshotCompanyDetails`).
 */
import { FLAT_DETAIL_KEYS } from './companyDetailKeys';

const text = (value) => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

const nested = (value) => (value && typeof value === 'object' ? value : {});

/**
 * @param {object} company a `companies/{companyId}` document's data
 * @returns {{ phone: string, email: string, street: string, city: string, state: string,
 *   zip: string, mcNumber: string, dotNumber: string }}
 */
export function companyDetailsOf(company) {
    const raw = nested(company);
    const legal = nested(raw.legal);
    const contact = nested(raw.contact);
    const address = nested(raw.address);
    return {
        phone: text(contact.phone) || text(raw.phone),
        email: text(contact.email) || text(raw.email),
        street: text(address.street) || (typeof raw.address === 'string' ? text(raw.address) : ''),
        city: text(address.city) || text(raw.city),
        state: text(address.state) || text(raw.state),
        zip: text(address.zip) || text(raw.zip),
        mcNumber: text(legal.mcNumber) || text(raw.mcNumber),
        dotNumber: text(legal.dotNumber) || text(raw.dotNumber),
    };
}

/**
 * The fields to save for the details a screen edited.
 *
 * The flat fields `company` already holds are saved too, with the same values,
 * so a detail cleared on the screen is not read back from its old flat copy.
 *
 * @param {{ phone?: string, email?: string, street?: string, city?: string, state?: string,
 *   zip?: string, mcNumber?: string, dotNumber?: string }} details
 * @param {object} [company] the document the details were read from; omitted for a new company
 */
export function companyDetailsFields(details, company) {
    const form = nested(details);
    const saved = nested(company);
    const fields = {
        contact: { phone: form.phone ?? '', email: form.email ?? '' },
        address: {
            street: form.street ?? '',
            city: form.city ?? '',
            state: form.state ?? '',
            zip: form.zip ?? '',
        },
        legal: { mcNumber: form.mcNumber ?? '', dotNumber: form.dotNumber ?? '' },
    };
    FLAT_DETAIL_KEYS.forEach((key) => {
        if (saved[key] !== undefined) fields[key] = form[key] ?? '';
    });
    return fields;
}
