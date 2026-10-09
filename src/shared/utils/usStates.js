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
 * The District of Columbia is listed too, since 2026-10-02, in its alphabetical
 * place: it issues its own licences and is a real address. Until then the list had
 * the fifty states only, so a DC address or licence could not be selected at all
 * and `toUsStateName('DC')` was `''`. The five inhabited territories followed on
 * 2026-10-09, in theirs: each issues its own licences, and FMCSA's census holds
 * carriers in all five under the same codes (about 7,200 in Puerto Rico).
 */

/** USPS code and name, in the order the pickers list them. */
const US_STATES = Object.freeze([
    ['AL', 'Alabama'], ['AK', 'Alaska'], ['AS', 'American Samoa'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
    ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
    ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['GU', 'Guam'], ['HI', 'Hawaii'],
    ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'],
    ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'],
    ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
    ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
    ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['MP', 'Northern Mariana Islands'], ['OH', 'Ohio'],
    ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'], ['RI', 'Rhode Island'],
    ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
    ['VI', 'U.S. Virgin Islands'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
    ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]);

export const US_STATE_NAMES = Object.freeze(US_STATES.map(([, name]) => name));

const NAME_BY_CODE = new Map(US_STATES);
const CODE_BY_NAME = new Map(US_STATES.map(([code, name]) => [name, code]));
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

/**
 * The USPS code for anything `toUsStateName` reads; `''` for anything else.
 *
 * @param {unknown} value e.g. `'Puerto Rico'`, `'pr'`
 * @returns {string} e.g. `'PR'`, or `''`
 */
export function toUsStateCode(value) {
    return CODE_BY_NAME.get(toUsStateName(value)) || '';
}
