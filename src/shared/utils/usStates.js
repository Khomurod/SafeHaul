/**
 * The US states the driver application offers, and the one way to turn what a
 * document prints into one of them.
 *
 * Every state picker in the application holds a full name ("Texas"). Licences,
 * motor vehicle records and the readers that parse them print a postal code
 * ("TX"), and a carrier typing into a free-text box writes whatever it likes. A
 * picker given a value that is none of its options does not show "nothing":
 * the browser shows the first option it can, so until 2026-10-01 a driver whose
 * CDL auto-fill read an Austin address saw "Alabama" on both state pickers while
 * the form still held "TX" — and the step's validation passed, because the field
 * was not empty. What a driver saw was not what was submitted.
 *
 * So writers normalise through `toUsStateName`, and the pickers render a value
 * they do not list as itself (see `StateSelectField`), never as a neighbour.
 *
 * The District of Columbia is absent, as it always has been from the wizard's list
 * (a known limitation, App Brief §12): `toUsStateName('DC')` is `''`, and a writer
 * leaves the field for the applicant rather than storing a value no picker can show.
 */

export const US_STATE_NAMES = Object.freeze([
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
    'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
    'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
    'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
]);

/** USPS codes, in the same order as the names above. */
const US_STATE_CODES = Object.freeze([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

const NAME_BY_CODE = new Map(US_STATE_CODES.map((code, index) => [code, US_STATE_NAMES[index]]));
const NAME_BY_LOWER_NAME = new Map(US_STATE_NAMES.map((name) => [name.toLowerCase(), name]));

/**
 * The listed name for a full name in any case or a two-letter postal code;
 * `''` for anything else.
 *
 * @param {unknown} value e.g. `'TX'`, `'tx'`, `'Texas'`, `' NEW  YORK '`
 * @returns {string} e.g. `'Texas'`, or `''`
 */
export function toUsStateName(value) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    return NAME_BY_LOWER_NAME.get(text.toLowerCase()) || NAME_BY_CODE.get(text.toUpperCase()) || '';
}
