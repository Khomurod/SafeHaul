/**
 * What an imported PSP report or MVR may SUGGEST, and how a suggestion becomes
 * part of the application — only when the applicant says so, and never over
 * something already entered.
 *
 * Pure functions, shared by the import panel and its tests. The panel owns the
 * screen; this module owns the three promises the feature makes:
 *
 * 1. **Nothing is silently overwritten.** A licence field fills only when it is
 *    empty; a field that already holds an answer is reported as kept.
 * 2. **Nothing is added twice.** A carrier already in the employer list (same
 *    USDOT number, or the same name) and a violation already listed (same charge
 *    on the same date) are offered as "already listed", not as new rows.
 * 3. **A PSP report is not employment history.** A carrier suggestion becomes an
 *    employer row holding only the carrier's name and USDOT number. The months
 *    the report saw the driver are shown to the applicant as context; the start
 *    and end dates stay theirs to enter.
 */
import { ENDORSEMENT_OPTIONS, LICENSE_CLASS_OPTIONS } from '@/config/form-options';
import { EMPTY_EMPLOYER } from './steps/components/employmentRowShapes';

export const REPORT_KINDS = Object.freeze({
    psp: Object.freeze({
        title: 'Import from your PSP report',
        documentName: 'PSP report',
        uploadLabel: 'Upload your PSP report (PDF or photo)',
        intro: 'Optional. If you have your FMCSA Pre-Employment Screening Program report, upload it and we will suggest carriers and violations it mentions. Nothing is added until you accept it, and nothing you have already entered is changed.',
    }),
    mvr: Object.freeze({
        title: 'Import from your motor vehicle record',
        documentName: 'motor vehicle record',
        uploadLabel: 'Upload your motor vehicle record (PDF or photo)',
        intro: 'Optional. If you have a copy of your driving record, upload it and we will suggest licence details and violations from it. Only empty fields are filled, and nothing is added until you accept it.',
    }),
});

/** The company's switch, read from the public profile the page was rendered from. */
export function integrationEnabled(profile, kind) {
    return profile?.applicationIntegrations?.[kind]?.enabled === true;
}

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (value) => String(value || '').replace(/\D/g, '');

export function carrierAlreadyListed(employers, carrier) {
    const list = Array.isArray(employers) ? employers : [];
    const dot = digits(carrier?.dotNumber);
    const name = normalizeText(carrier?.name);
    return list.some((row) => (dot && digits(row?.dotNumber) === dot) || (name && normalizeText(row?.companyName) === name));
}

/** An employer row from a carrier sighting: name and USDOT only, dates left blank. */
export function employerFromCarrier(carrier, id) {
    return { ...EMPTY_EMPLOYER, id, companyName: carrier?.name || '', dotNumber: digits(carrier?.dotNumber) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2024-03` → "Mar 2024"; anything else is returned as it came, or ''. */
export function formatMonth(value) {
    const match = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    if (!match) return String(value || '');
    const month = MONTHS[Number(match[2]) - 1];
    return month ? `${month} ${match[1]}` : String(value);
}

/** The context shown beside a carrier — what the report proves, in plain words. */
export function describeSighting(carrier) {
    const kind = carrier?.recordType === 'crash' ? 'crash records'
        : carrier?.recordType === 'both' ? 'inspection and crash records'
            : carrier?.recordType === 'inspection' ? 'inspection records' : 'records';
    const first = formatMonth(carrier?.firstSeen);
    const last = formatMonth(carrier?.lastSeen);
    if (first && last && first !== last) return `On ${kind} from ${first} to ${last}`;
    if (first || last) return `On ${kind} in ${first || last}`;
    return `On ${kind}`;
}

export function violationAlreadyListed(violations, suggestion) {
    const list = Array.isArray(violations) ? violations : [];
    const charge = normalizeText(suggestion?.charge);
    if (!charge) return true;
    const date = String(suggestion?.date || '');
    return list.some((row) => normalizeText(row?.charge) === charge
        && (!date || !row?.date || String(row.date) === date));
}

export function violationFromSuggestion(suggestion, id) {
    return {
        id,
        date: suggestion?.date || '',
        charge: suggestion?.charge || '',
        location: suggestion?.location || '',
        penalty: '',
    };
}

export const LICENSE_FIELDS = Object.freeze([
    { id: 'cdlNumber', label: 'License number' },
    { id: 'cdlState', label: 'License state' },
    { id: 'cdlClass', label: 'License class' },
    { id: 'cdlExpiration', label: 'Expiration date' },
    { id: 'endorsements', label: 'Endorsements' },
]);

/** Map what a record prints to one of the form's own class options, or ''. */
export function normalizeLicenseClass(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    const exact = LICENSE_CLASS_OPTIONS.find((option) => option.value.toLowerCase() === value.toLowerCase());
    if (exact) return exact.value;
    const letter = /^(?:class\s*)?([a-d])$/i.exec(value);
    if (letter) return `Class ${letter[1].toUpperCase()}`;
    if (/non[\s-]?cdl/i.test(value)) return 'Non-CDL';
    return '';
}

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Field by field: what the record offers, what the form already holds, and
 * therefore what accepting would do — `fill` an empty field, `keep` the
 * applicant's own entry, or `none` when the record had nothing usable.
 */
export function licenseFillPlan(formData, license) {
    const offered = {
        cdlNumber: String(license?.cdlNumber || '').trim(),
        cdlState: String(license?.cdlState || '').trim().toUpperCase(),
        cdlClass: normalizeLicenseClass(license?.cdlClass),
        cdlExpiration: FULL_DATE.test(String(license?.cdlExpiration || '')) ? license.cdlExpiration : '',
        endorsements: (Array.isArray(license?.endorsements) ? license.endorsements : [])
            .filter((code) => ENDORSEMENT_OPTIONS.some((option) => option.value === code))
            .join(','),
    };
    return LICENSE_FIELDS.map(({ id, label }) => {
        const current = String(formData?.[id] || '').trim();
        const found = offered[id];
        const action = !found ? 'none' : current ? 'keep' : 'fill';
        return { id, label, found, current, action };
    });
}

/** The patch accepting a plan applies: only the `fill` rows. */
export function licensePatch(plan) {
    return plan.filter((row) => row.action === 'fill').reduce((patch, row) => ({ ...patch, [row.id]: row.found }), {});
}
