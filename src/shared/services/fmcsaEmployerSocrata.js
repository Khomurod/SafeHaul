/**
 * FMCSA carrier lookup via Transportation.gov Socrata SODA API.
 * @see https://data.transportation.gov/resource/az4n-8mr2
 *
 * Two callers with their own queries: the driver's employer lookup
 * (`fetchFmcsaEmployerSuggestions`) and the company's verification request
 * (`fetchFmcsaCarrierCandidatesForPev`, whose query is unchanged since before
 * 2026-10-07). Both map a row through this file, so a value FMCSA holds but no
 * form should, such as "NONE" in the email column, is dropped in one place.
 */

import { isWellFormedEmail } from '@shared/utils/validation';
import { regionNameFromFmcsa } from '@shared/utils/northAmericanRegions';

export const FMCSA_EMPLOYER_SOCRATA_URL =
  'https://data.transportation.gov/resource/az4n-8mr2.json';

const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 80;

/**
 * Full state names (employment dropdown) → FMCSA phy_state abbreviations.
 * Order matches `useUtils` US_STATES and SearchConfig two-letter lists.
 */
const US_STATE_FULL_NAMES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

const US_STATE_ABBRS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const FULL_STATE_NAME_TO_ABBR = Object.fromEntries(
  US_STATE_FULL_NAMES.map((name, i) => [name, US_STATE_ABBRS[i]]),
);

/**
 * Normalize driver employment `state` (full name or 2-letter) to FMCSA `phy_state` code.
 * @param {unknown} raw — e.g. "Illinois", "IL", or ""
 * @returns {string} two-letter uppercase or ""
 */
export function normalizeEmployerStateToFmcsaPhyState(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^[a-zA-Z]{2}$/.test(s)) return s.toUpperCase();
  return FULL_STATE_NAME_TO_ABBR[s] || '';
}

function normalizeFmcsaPhyStateFilter(phyStateCode) {
  const code = String(phyStateCode ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function appendPhyStateToWhere(baseWhere, phyStateCode) {
  const code = normalizeFmcsaPhyStateFilter(phyStateCode);
  if (!code) return baseWhere;
  const esc = escapeSoqlStringLiteral(code);
  return `${baseWhere} and upper(trim(phy_state)) = upper('${esc}')`;
}

/** Columns always available on company census export (used in driver employment step). */
export const FMCSA_SELECT_MINIMAL =
  'dot_number,legal_name,phy_street,phy_city,phy_state';

/**
 * Extended census fields for phone / fax / email when supported by the dataset.
 * Dataset column is `phone` (not `telephone`) — see Transportation.gov az4n-8mr2 schema.
 * If the API rejects unknown columns, callers retry with {@link FMCSA_SELECT_MINIMAL}.
 */
export const FMCSA_SELECT_EXTENDED =
  `${FMCSA_SELECT_MINIMAL},phy_zip,phone,fax,email_address,cell_phone`;

/**
 * Escape a value for use inside a SoQL single-quoted string literal.
 */
export function escapeSoqlStringLiteral(raw) {
  if (raw == null) return '';
  return String(raw).replace(/'/g, "''");
}

/**
 * Strip characters that are risky or useless inside SoQL string literals.
 */
export function sanitizeEmployerSearchPrefix(input) {
  const trimmed = String(input ?? '').trim().slice(0, MAX_PREFIX_LENGTH);
  return trimmed.replace(/[^\p{L}\p{N}\s\-'&.(),]/gu, '').trim();
}

/**
 * First significant word (min 2 chars) for starts_with — helps match "Intercontinental carriers"
 * to legal names beginning with "INTERCONTINENTAL…".
 */
export function fmcsaPrefixTokenFromCompanyName(name) {
  const safe = sanitizeEmployerSearchPrefix(name);
  if (safe.length < MIN_PREFIX_LENGTH) return '';
  const parts = safe.split(/\s+/).filter(Boolean);
  const first = parts[0] || safe;
  return first.length >= MIN_PREFIX_LENGTH ? first : safe.slice(0, MIN_PREFIX_LENGTH);
}

/**
 * Build request URL with SoQL query params (properly URL-encoded).
 */
export function buildFmcsaEmployerSearchUrl(
  prefix,
  selectFields = FMCSA_SELECT_MINIMAL,
  phyStateCode = '',
) {
  const safe = escapeSoqlStringLiteral(sanitizeEmployerSearchPrefix(prefix));
  if (safe.length < MIN_PREFIX_LENGTH) {
    return null;
  }
  let where = `starts_with(upper(legal_name), upper('${safe}'))`;
  where = appendPhyStateToWhere(where, phyStateCode);
  const params = new URLSearchParams();
  params.set('$select', selectFields);
  params.set('$where', where);
  params.set('$limit', '5');
  return `${FMCSA_EMPLOYER_SOCRATA_URL}?${params.toString()}`;
}

/**
 * Prefix search using first word of company name (stronger match for informal driver-entered names).
 */
export function buildFmcsaEmployerSearchUrlFromCompanyName(
  companyName,
  selectFields = FMCSA_SELECT_MINIMAL,
  phyStateCode = '',
) {
  const token = fmcsaPrefixTokenFromCompanyName(companyName);
  if (!token) return null;
  return buildFmcsaEmployerSearchUrl(token, selectFields, phyStateCode);
}

/**
 * Broader match: LIKE on full sanitized company string (bounded length).
 */
export function buildFmcsaEmployerLikeSearchUrl(
  companyName,
  selectFields = FMCSA_SELECT_MINIMAL,
  phyStateCode = '',
) {
  const safe = escapeSoqlStringLiteral(sanitizeEmployerSearchPrefix(companyName));
  if (safe.length < MIN_PREFIX_LENGTH) return null;
  let where = `like(upper(legal_name), '%' || upper('${safe}') || '%')`;
  where = appendPhyStateToWhere(where, phyStateCode);
  const params = new URLSearchParams();
  params.set('$select', selectFields);
  params.set('$where', where);
  params.set('$limit', '5');
  return `${FMCSA_EMPLOYER_SOCRATA_URL}?${params.toString()}`;
}

/** A census value as trimmed text; `''` for none. */
const pickText = (value) => (value === undefined || value === null ? '' : String(value).trim());

/**
 * Map a Socrata row to employer step field values.
 *
 * Every field is always returned, `''` when FMCSA has nothing usable, so a pick
 * can tell "this carrier has no email" from "not asked" (`EmployerNameAutocomplete`).
 * - `state` is the region's listed name, read with its country (`phy_country`):
 *   "NL" is a Canadian province and a Mexican state. A region the picker does not
 *   list is left out, since it would show as a value no option holds.
 * - `companyEmail` is kept only when it is one an email can be sent to.
 *
 * @param {Record<string, unknown>} row
 * @param {string[]} [statesAllowlist] - the region names the picker lists; none means any
 */
export function mapFmcsaRowToEmployerFields(row, statesAllowlist = []) {
  const allow = Array.isArray(statesAllowlist) ? statesAllowlist : [];
  const region = regionNameFromFmcsa(row?.phy_country, row?.phy_state);
  const email = pickText(row?.email_address ?? row?.email);
  return {
    companyName: pickText(row?.legal_name),
    dotNumber: pickText(row?.dot_number),
    address: pickText(row?.phy_street),
    city: pickText(row?.phy_city),
    state: region && (allow.length === 0 || allow.includes(region)) ? region : '',
    phone: pickText(row?.phone) || pickText(row?.telephone) || pickText(row?.cell_phone),
    companyEmail: isWellFormedEmail(email) ? email : '',
  };
}

/**
 * Map census row to PEV / verification contact fields (best-effort — many carriers lack public email in FMCSA).
 */
export function mapFmcsaRowToPevContact(row) {
  const pick = (v) =>
    v === undefined || v === null ? '' : String(v).trim();
  const phoneRaw =
    row?.phone ?? row?.telephone ?? row?.cell_phone ?? '';
  const email = pick(row.email_address || row.email);
  return {
    email: isWellFormedEmail(email) ? email : '',
    fax: pick(row.fax),
    phone: pick(phoneRaw),
    legalName: pick(row.legal_name),
    dotNumber: pick(row.dot_number),
    phyStreet: pick(row.phy_street),
    phyCity: pick(row.phy_city),
    phyState: pick(row.phy_state),
    phyZip: pick(row.phy_zip),
  };
}

async function fetchJson(url, headers, signal) {
  const res = await fetch(url, { method: 'GET', headers, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = /** @type {Error & { status?: number, body?: string }} */ (
      new Error(`FMCSA lookup failed (${res.status}): ${text.slice(0, 200)}`)
    );
    err.status = res.status;
    err.body = text;
    throw err;
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** What the driver's lookup reads: the employer row's fields, the trade name, the country and the status. */
export const FMCSA_SELECT_DRIVER =
  'dot_number,legal_name,dba_name,phy_street,phy_city,phy_state,phy_country,phone,cell_phone,email_address,status_code';

export const DRIVER_SUGGESTION_LIMIT = 10;

/** "54283", "USDOT 54283", "DOT #54283": a USDOT number. */
const USDOT_INPUT = /^(?:US\s*)?(?:DOT\s*)?#?\s*(\d{1,9})$/i;

/**
 * The driver's lookup, as the queries to send, in the order their rows are listed:
 * the carrier with that USDOT number when only a number was typed, then carriers
 * whose legal or trade (`dba_name`) name starts with the text, active ones
 * (`status_code` A) before the rest. A closed carrier stays listed: a driver's
 * former employer may have closed.
 *
 * Separate queries rather than `$order` on the status, which would have Socrata
 * sort every match; each of these answered in about 0.3 s (2026-10-07).
 *
 * @param {string} input what the driver typed
 * @returns {string[]} none when it is too short to search
 */
export function buildFmcsaDriverSearchUrls(input) {
  const safe = escapeSoqlStringLiteral(sanitizeEmployerSearchPrefix(input));
  if (safe.length < MIN_PREFIX_LENGTH) return [];
  const named = `(starts_with(upper(legal_name), upper('${safe}')) OR starts_with(upper(dba_name), upper('${safe}')))`;
  const usdot = USDOT_INPUT.exec(safe);
  const wheres = [
    ...(usdot ? [`dot_number = ${Number(usdot[1])}`] : []),
    `status_code = 'A' AND ${named}`,
    `(status_code IS NULL OR status_code != 'A') AND ${named}`,
  ];
  return wheres.map((where) => {
    const params = new URLSearchParams();
    params.set('$select', FMCSA_SELECT_DRIVER);
    params.set('$where', where);
    params.set('$limit', String(DRIVER_SUGGESTION_LIMIT));
    return `${FMCSA_EMPLOYER_SOCRATA_URL}?${params.toString()}`;
  });
}

/**
 * Up to ten carriers for what the driver typed, in `buildFmcsaDriverSearchUrls`'
 * order, each once.
 * @param {string} input
 * @param {{ signal?: AbortSignal, appToken?: string }} [options]
 */
export async function fetchFmcsaEmployerSuggestions(input, options = {}) {
  const { signal, appToken } = options;
  const urls = buildFmcsaDriverSearchUrls(input);
  if (urls.length === 0 || !appToken) return [];

  const headers = { Accept: 'application/json', 'X-App-Token': appToken };
  const answers = await Promise.all(urls.map((url) => fetchJson(url, headers, signal)));
  const listed = new Set();
  const rows = [];
  for (const row of answers.flat()) {
    const dot = pickText(row?.dot_number);
    if (dot && listed.has(dot)) continue;
    listed.add(dot);
    rows.push(row);
    if (rows.length === DRIVER_SUGGESTION_LIMIT) break;
  }
  return rows;
}

/**
 * For PEV modal: optional employer state first (matches application phy_state), then nationwide.
 * Prefix by first word → LIKE; extended select with minimal fallback per request.
 * @param {string} companyName
 * @param {{ signal?: AbortSignal, appToken?: string, employerState?: string }} options — employerState = employment row state (full name or 2-letter)
 */
export async function fetchFmcsaCarrierCandidatesForPev(companyName, options = {}) {
  const { signal, appToken, employerState } = options;
  if (!appToken) return [];

  const stateCode = normalizeEmployerStateToFmcsaPhyState(employerState);

  const tryFetch = async (buildUrlFn, selectFields, phyState = '') => {
    const url = buildUrlFn(companyName, selectFields, phyState);
    if (!url) return [];
    const headers = {
      Accept: 'application/json',
      'X-App-Token': appToken,
    };
    try {
      return await fetchJson(url, headers, signal);
    } catch (e) {
      if (
        selectFields !== FMCSA_SELECT_MINIMAL &&
        (e.status === 400 || /unknown column|invalid/i.test(String(e.body || e.message)))
      ) {
        const fallbackUrl = buildUrlFn(companyName, FMCSA_SELECT_MINIMAL, phyState);
        if (!fallbackUrl) return [];
        return await fetchJson(fallbackUrl, headers, signal);
      }
      throw e;
    }
  };

  const runNationalPipeline = async () => {
    let rows = await tryFetch(
      buildFmcsaEmployerSearchUrlFromCompanyName,
      FMCSA_SELECT_EXTENDED,
      '',
    );
    if (rows.length > 0) return rows;
    rows = await tryFetch(buildFmcsaEmployerLikeSearchUrl, FMCSA_SELECT_EXTENDED, '');
    return rows;
  };

  if (stateCode) {
    let rows = await tryFetch(
      buildFmcsaEmployerSearchUrlFromCompanyName,
      FMCSA_SELECT_EXTENDED,
      stateCode,
    );
    if (rows.length > 0) return rows;

    rows = await tryFetch(buildFmcsaEmployerLikeSearchUrl, FMCSA_SELECT_EXTENDED, stateCode);
    if (rows.length > 0) return rows;
  }

  return runNationalPipeline();
}
