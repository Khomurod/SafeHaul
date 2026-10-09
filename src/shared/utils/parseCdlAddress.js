/**
 * Parse a single-line US mailing address from CDL OCR (often ALL CAPS, with or without commas).
 * Strips ZIP+4 and state from the end first, then splits street vs city. A state
 * is a code the pickers' list names (`usStates.js`), so a licence from DC or a
 * territory parses as one from a state does.
 */
import { toUsStateName } from './usStates';

/** Last token is a common street-type suffix — do not treat it as a standalone city name. */
const STREET_TYPE_TOKENS = new Set([
  'ST', 'STE', 'RD', 'AVE', 'BLVD', 'DR', 'LN', 'CT', 'WAY', 'CIR', 'PL', 'HWY', 'PKWY',
  'RT', 'RTE', 'TRL', 'TER', 'LOOP', 'XING', 'FWY', 'TPKE', 'EXPY', 'ROW', 'PATH', 'PIKE',
]);

/**
 * @param {string} fullAddress
 * @returns {{ street: string, city: string, state: string, zip: string }}
 */
export function parseAddressPartsFromCdl(fullAddress) {
  let s = String(fullAddress || '').trim().replace(/\s+/g, ' ');
  if (!s) return { street: '', city: '', state: '', zip: '' };

  let zip = '';
  const zipAtEnd = s.match(/\b(\d{5})(-(\d{4}))?\s*$/);
  if (zipAtEnd) {
    zip = zipAtEnd[3] ? `${zipAtEnd[1]}-${zipAtEnd[3]}` : zipAtEnd[1];
    s = s.slice(0, zipAtEnd.index).trim().replace(/,\s*$/, '');
  }

  let state = '';
  const stateAtEnd = s.match(/,?\s*\b([A-Z]{2})\s*$/);
  if (stateAtEnd && toUsStateName(stateAtEnd[1])) {
    state = stateAtEnd[1];
    s = s.slice(0, stateAtEnd.index).trim().replace(/,\s*$/, '');
  }

  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  let street = '';
  let city = '';

  if (parts.length >= 2) {
    street = parts[0];
    city = parts.slice(1).join(', ');
  } else if (parts.length === 1) {
    const one = parts[0];
    const tokens = one.split(/\s+/).filter(Boolean);
    const lastRaw = tokens[tokens.length - 1] || '';
    const last = lastRaw.replace(/\.$/, '').toUpperCase();

    if (tokens.length >= 2 && last && !STREET_TYPE_TOKENS.has(last)) {
      city = tokens[tokens.length - 1];
      street = tokens.slice(0, -1).join(' ');
    } else {
      street = one;
    }
  }

  return { street, city, state, zip };
}
