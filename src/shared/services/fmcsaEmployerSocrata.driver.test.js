/**
 * The driver's employer lookup: what it asks FMCSA's census, in what order the
 * answers are listed, and what of a carrier's record reaches the employer row.
 *
 * The rows below are shaped like real census rows (2026-10-07). The census
 * holds "NONE", "aol..com" and "aol,com" in its email column, writes a region
 * as a code that is unique only within a country, and lists closed carriers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRIVER_SUGGESTION_LIMIT,
  FMCSA_SELECT_DRIVER,
  FMCSA_SELECT_EXTENDED,
  buildFmcsaDriverSearchUrls,
  buildFmcsaEmployerSearchUrlFromCompanyName,
  fetchFmcsaCarriersByDot,
  fetchFmcsaEmployerSuggestions,
  mapFmcsaRowToEmployerFields,
  mapFmcsaRowToPevContact,
} from './fmcsaEmployerSocrata';
import { NORTH_AMERICAN_REGION_NAMES } from '@shared/utils/northAmericanRegions';
import { US_STATE_NAMES } from '@shared/utils/usStates';

const paramsOf = (url) => new URL(url).searchParams;
const whereOf = (url) => paramsOf(url).get('$where');

const answer = (rows) => Promise.resolve({ ok: true, json: () => Promise.resolve(rows) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the lookup asks', () => {
  it('asks for active carriers by legal or trade name first, then the rest, ten each', () => {
    const urls = buildFmcsaDriverSearchUrls('Swift');

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(paramsOf(url).get('$select')).toBe(FMCSA_SELECT_DRIVER);
      expect(paramsOf(url).get('$limit')).toBe(String(DRIVER_SUGGESTION_LIMIT));
      expect(whereOf(url)).toContain("(starts_with(upper(legal_name), upper('Swift')) OR starts_with(upper(dba_name), upper('Swift')))");
    }
    expect(whereOf(urls[0])).toMatch(/^status_code = 'A' AND /);
    // A closed carrier stays findable: a driver's former employer may have closed.
    expect(whereOf(urls[1])).toMatch(/^\(status_code IS NULL OR status_code != 'A'\) AND /);
  });

  it.each(['54283', 'USDOT 54283', 'dot #54283', '0054283'])('looks up %s as a USDOT number first, as a number', (input) => {
    const urls = buildFmcsaDriverSearchUrls(input);

    expect(urls).toHaveLength(3);
    expect(whereOf(urls[0])).toBe('dot_number = 54283');
  });

  it('asks nothing for one character, and keeps a quote inside its literal', () => {
    expect(buildFmcsaDriverSearchUrls('S')).toEqual([]);
    expect(whereOf(buildFmcsaDriverSearchUrls("O'Brien Haul")[0])).toContain("upper('O''Brien Haul')");
  });

  it('leaves the verification request\'s own query as it was', () => {
    const url = buildFmcsaEmployerSearchUrlFromCompanyName('Swift Transport', FMCSA_SELECT_EXTENDED);

    expect(paramsOf(url).get('$limit')).toBe('5');
    expect(whereOf(url)).toBe("starts_with(upper(legal_name), upper('Swift'))");
    expect(FMCSA_SELECT_EXTENDED).not.toContain('dba_name');
  });
});

describe('what the lookup lists', () => {
  it('lists the USDOT match, then active carriers, then the rest, each carrier once and ten at most', async () => {
    const byDot = [{ dot_number: '54283', legal_name: 'SWIFT TRANSPORTATION CO OF ARIZONA LLC', status_code: 'A' }];
    const active = Array.from({ length: 6 }, (_, i) => ({ dot_number: String(100 + i), legal_name: `ACTIVE ${i}`, status_code: 'A' }));
    const rest = [
      { dot_number: '54283', legal_name: 'SWIFT TRANSPORTATION CO OF ARIZONA LLC', status_code: 'A' },
      ...Array.from({ length: 6 }, (_, i) => ({ dot_number: String(200 + i), legal_name: `CLOSED ${i}`, status_code: 'I' })),
    ];
    const fetchMock = vi.fn((url) => {
      const where = whereOf(url);
      if (where.startsWith('dot_number')) return answer(byDot);
      return answer(where.startsWith("status_code = 'A'") ? active : rest);
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await fetchFmcsaEmployerSuggestions('54283', { appToken: 't' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rows.map((row) => row.dot_number)).toEqual(['54283', '100', '101', '102', '103', '104', '105', '200', '201', '202']);
    expect(rows).toHaveLength(DRIVER_SUGGESTION_LIMIT);
  });

  it('fails the lookup when the census refuses a query, which the page reports', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('no such column') })));

    await expect(fetchFmcsaEmployerSuggestions('Swift', { appToken: 't' })).rejects.toMatchObject({ status: 400 });
  });

  it('asks nothing without an app token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchFmcsaEmployerSuggestions('Swift', {})).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what reaches the employer row', () => {
  const carrier = (fields) => ({
    dot_number: 3215546, legal_name: 'NORTHERN LINE CARRIERS INC', phy_street: '55 KING ST', phy_city: 'TORONTO', ...fields,
  });

  it('returns every field, empty when the census has nothing usable', () => {
    expect(mapFmcsaRowToEmployerFields({ legal_name: 'BARE LLC' }, NORTH_AMERICAN_REGION_NAMES)).toEqual({
      companyName: 'BARE LLC', dotNumber: '', address: '', city: '', state: '', phone: '', companyEmail: '',
    });
  });

  it.each(['NONE', 'none', 'aol..com', 'boblucey@aol..com', 'jrouse247@aol,com', 'bulltsh_1 @msn.com', 'DBTESLA@HOTMAIL', 'mace@mace_usa.com'])(
    'leaves out an email no message could be sent to: %s',
    (email) => {
      expect(mapFmcsaRowToEmployerFields(carrier({ email_address: email }), NORTH_AMERICAN_REGION_NAMES).companyEmail).toBe('');
      expect(mapFmcsaRowToPevContact(carrier({ email_address: email })).email).toBe('');
    },
  );

  it('keeps an email one can be sent to', () => {
    expect(mapFmcsaRowToEmployerFields(carrier({ email_address: ' Dispatch@NorthernLine.ca ' }), NORTH_AMERICAN_REGION_NAMES).companyEmail)
      .toBe('Dispatch@NorthernLine.ca');
  });

  it.each([
    ['CA', 'ON', 'Ontario'],
    ['CA', 'NL', 'Newfoundland and Labrador'],
    ['MX', 'NL', 'Nuevo León'],
    ['MX', 'CI', 'Chihuahua'],
    ['MX', 'CH', 'Coahuila'],
    ['US', 'TX', 'Texas'],
    // Rows asked for without the country column read as US ones, as before.
    [undefined, 'MO', 'Missouri'],
    // A territory is a US region: FMCSA files Puerto Rico's carriers under US PR.
    ['US', 'PR', 'Puerto Rico'],
    ['GT', 'GU', ''],
    ['CA', 'XX', ''],
  ])('reads %s %s as %s', (country, code, expected) => {
    expect(mapFmcsaRowToEmployerFields(carrier({ phy_country: country, phy_state: code }), NORTH_AMERICAN_REGION_NAMES).state).toBe(expected);
  });

  it('leaves out a region the picker does not list', () => {
    expect(mapFmcsaRowToEmployerFields(carrier({ phy_country: 'CA', phy_state: 'ON' }), US_STATE_NAMES).state).toBe('');
  });

  it('takes the cell phone when the main phone is empty', () => {
    expect(mapFmcsaRowToEmployerFields(carrier({ phone: '', cell_phone: ' 4165550100 ' }), NORTH_AMERICAN_REGION_NAMES).phone).toBe('4165550100');
  });
});

describe('the carriers a PSP report named, by USDOT number', () => {
  it('asks once for every distinct number, digits only, at most 25', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([{ dot_number: '42' }]) }));
    vi.stubGlobal('fetch', fetchMock);

    const dots = ['42', ' 42 ', 'MC-9', '', ...Array.from({ length: 30 }, (_, i) => String(1000 + i))];
    const rows = await fetchFmcsaCarriersByDot(dots, { appToken: 't' });

    expect(rows).toEqual([{ dot_number: '42' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    const where = url.searchParams.get('$where');
    expect(where.startsWith('dot_number in (42, 1000, ')).toBe(true);
    expect(where.split(',')).toHaveLength(25);
    expect(where).not.toMatch(/MC/);
    expect(url.searchParams.get('$select')).toContain('phy_street');
    expect(fetchMock.mock.calls[0][1].headers['X-App-Token']).toBe('t');
  });

  it('asks nothing without a token or without a number', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchFmcsaCarriersByDot(['42'], {})).resolves.toEqual([]);
    await expect(fetchFmcsaCarriersByDot(['MC-9', ''], { appToken: 't' })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
