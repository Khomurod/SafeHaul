/**
 * The regions an address may be in: the US states and territories, Canada's
 * provinces and territories, and Mexico's states.
 *
 * An employer, the driver's own addresses and an accident offer these: a
 * previous employer is often a Canadian or Mexican carrier with a USDOT number
 * (FMCSA's census lists about 67,000 Canadian and 27,000 Mexican ones), and a
 * driver who lives or drove across a border has nowhere else to say so. A
 * licence stays on the US list (`usStates.js`), because SafeHaul hires for US
 * carriers.
 *
 * Every name is unique across the three lists, so a stored name says which
 * country it is in. FMCSA records a region as a two-letter code that is only
 * unique within a country: "NL" is Newfoundland and Labrador in Canada and
 * Nuevo León in Mexico. Mexico's codes are FMCSA's own, not ISO 3166-2:MX;
 * all 32 were checked against the census (2026-10-07), and the cities each one
 * holds.
 */

import { US_STATE_NAMES, toUsStateName } from './usStates';

const CANADA = Object.freeze([
    ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'],
    ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'],
    ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'],
    ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
]);

const MEXICO = Object.freeze([
    ['AG', 'Aguascalientes'], ['BN', 'Baja California'], ['BS', 'Baja California Sur'],
    ['CP', 'Campeche'], ['CS', 'Chiapas'], ['CI', 'Chihuahua'], ['CH', 'Coahuila'], ['CL', 'Colima'],
    ['DG', 'Durango'], ['GJ', 'Guanajuato'], ['GE', 'Guerrero'], ['HD', 'Hidalgo'], ['JA', 'Jalisco'],
    ['DF', 'Mexico City'], ['MC', 'Michoacán'], ['MR', 'Morelos'], ['NA', 'Nayarit'],
    ['NL', 'Nuevo León'], ['OA', 'Oaxaca'], ['PU', 'Puebla'], ['QE', 'Querétaro'],
    ['QI', 'Quintana Roo'], ['SL', 'San Luis Potosí'], ['SI', 'Sinaloa'], ['SO', 'Sonora'],
    ['MX', 'State of Mexico'], ['TB', 'Tabasco'], ['TA', 'Tamaulipas'], ['TL', 'Tlaxcala'],
    ['VC', 'Veracruz'], ['YU', 'Yucatán'], ['ZA', 'Zacatecas'],
]);

/** For a grouped picker (`StateSelectField`'s `groups`). */
export const NORTH_AMERICAN_REGION_GROUPS = Object.freeze([
    Object.freeze({ label: 'United States', options: US_STATE_NAMES }),
    Object.freeze({ label: 'Canada', options: Object.freeze(CANADA.map(([, name]) => name)) }),
    Object.freeze({ label: 'Mexico', options: Object.freeze(MEXICO.map(([, name]) => name)) }),
]);

/** Every region name, for a flat allow-list. */
export const NORTH_AMERICAN_REGION_NAMES = Object.freeze(NORTH_AMERICAN_REGION_GROUPS.flatMap((group) => group.options));

const BY_COUNTRY = Object.freeze({
    CA: new Map(CANADA),
    MX: new Map(MEXICO),
});

const OUTSIDE_US_BY_NAME = new Map([
    ...CANADA.map(([code, name]) => [name, Object.freeze({ country: 'CA', code })]),
    ...MEXICO.map(([code, name]) => [name, Object.freeze({ country: 'MX', code })]),
]);

/**
 * FMCSA's country and code for a Canadian province or territory or a Mexican
 * state, by its listed name; null for a US state or anything else.
 *
 * @param {unknown} name e.g. `'Ontario'`, `'Nuevo León'`
 * @returns {{country: 'CA'|'MX', code: string} | null}
 */
export function fmcsaRegionOutsideUs(name) {
    return OUTSIDE_US_BY_NAME.get(String(name ?? '').trim()) || null;
}

/**
 * The listed name for an FMCSA `phy_country` and `phy_state`; `''` for a
 * country or code not listed. A row without a country is read as a US one, as
 * every row was before the column was asked for.
 *
 * @param {unknown} country e.g. `'CA'`, `'US'`, `null`
 * @param {unknown} code e.g. `'ON'`, `'tx'`
 * @returns {string} e.g. `'Ontario'`, `'Texas'`, or `''`
 */
export function regionNameFromFmcsa(country, code) {
    const countryCode = String(country ?? '').trim().toUpperCase() || 'US';
    const regionCode = String(code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(regionCode)) return '';
    if (countryCode === 'US') return toUsStateName(regionCode);
    return BY_COUNTRY[countryCode]?.get(regionCode) || '';
}
