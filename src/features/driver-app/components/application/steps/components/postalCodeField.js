import { fmcsaRegionOutsideUs } from '@shared/utils/northAmericanRegions';

/**
 * How an address asks for its postal code, by the region picked beside it.
 *
 * An address may be in Canada or Mexico (`northAmericanRegions.js`). A Canadian
 * postal code has letters ("M5V 2T6"), which a phone's number pad cannot type, and
 * neither country's code is a "ZIP"; a US one stays a five-digit ZIP Code. The
 * answer is stored under `zip` wherever the address is.
 *
 * @param {unknown} region the address's `state`, e.g. `'Ontario'`, `'Texas'`, `''`
 * @returns {{ label: string, inputMode: 'numeric'|'text', placeholder: string, isZip: boolean }}
 */
export function postalCodeField(region) {
    const country = fmcsaRegionOutsideUs(region)?.country;
    if (country === 'CA') return { label: 'Postal Code', inputMode: 'text', placeholder: 'A1A 1A1', isZip: false };
    if (country === 'MX') return { label: 'Postal Code', inputMode: 'numeric', placeholder: '12345', isZip: false };
    return { label: 'ZIP Code', inputMode: 'numeric', placeholder: '12345', isZip: true };
}
