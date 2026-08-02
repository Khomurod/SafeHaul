/**
 * FMCSA carrier lookup via Transportation.gov Socrata SODA API.
 * @see https://data.transportation.gov/resource/az4n-8mr2
 */

export const FMCSA_EMPLOYER_SOCRATA_URL =
  'https://data.transportation.gov/resource/az4n-8mr2.json';

const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 80;

/**
 * Full state names (employment dropdown) → FMCSA phy_state abbreviations.
 * Order matches `useUtils` US_STATES and SearchConfig two-letter lists.
 */
const US_STATE_FULL_NAMES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

const US_STATE_ABBRS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const FULL_STATE_NAME_TO_ABBR = Object.fromEntries(
  US_STATE_FULL_NAMES.map((name, i) => [name, US_STATE_ABBRS[i]]),
);

/** FMCSA `phy_state` is usually a 2-letter code; employment `<select>` values use full state names. */
const FMCSA_ABBR_TO_FULL_STATE_NAME = Object.fromEntries(
  US_STATE_ABBRS.map((abbr, i) => [abbr, US_STATE_FULL_NAMES[i]]),
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

/**
 * Map a Socrata row to employer step field values.
 * @param {object} row
 * @param {string[]} [statesAllowlist] - e.g. two-letter codes from useUtils().states
 */
export function mapFmcsaRowToEmployerFields(row, statesAllowlist = []) {
  const companyName = String(row?.legal_name ?? '').trim();
  const dotNumber =
    row?.dot_number === undefined || row?.dot_number === null
      ? ''
      : String(row.dot_number).trim();
  const address = String(row?.phy_street ?? '').trim();
  const city = String(row?.phy_city ?? '').trim();
  const rawState = String(row?.phy_state ?? '').trim().toUpperCase();
  let state = '';
  const allow = Array.isArray(statesAllowlist) ? statesAllowlist : [];

  if (/^[A-Z]{2}$/.test(rawState)) {
    const fullName = FMCSA_ABBR_TO_FULL_STATE_NAME[rawState] || '';
    if (fullName && (allow.length === 0 || allow.includes(fullName))) {
      state = fullName;
    } else if (allow.includes(rawState)) {
      state = rawState;
    } else if (allow.length === 0) {
      state = rawState;
    }
  } else if (allow.includes(rawState)) {
    state = rawState;
  }

  const pickStr = (v) =>
    v === undefined || v === null ? '' : String(v).trim();
  const phoneRaw = row?.phone ?? row?.telephone ?? row?.cell_phone ?? '';
  const phone = pickStr(phoneRaw);
  const companyEmail = pickStr(row?.email_address ?? row?.email ?? '');

  return { companyName, dotNumber, address, city, state, phone, companyEmail };
}

/**
 * Map census row to PEV / verification contact fields (best-effort — many carriers lack public email in FMCSA).
 */
export function mapFmcsaRowToPevContact(row) {
  const pick = (v) =>
    v === undefined || v === null ? '' : String(v).trim();
  const phoneRaw =
    row?.phone ?? row?.telephone ?? row?.cell_phone ?? '';
  return {
    email: pick(row.email_address || row.email),
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

/**
 * @param {string} prefix
 * @param {{ signal?: AbortSignal, appToken?: string, selectFields?: string }} [options]
 */
export async function fetchFmcsaEmployerSuggestions(prefix, options = {}) {
  const { signal, appToken, selectFields = FMCSA_SELECT_MINIMAL } = options;
  let url = buildFmcsaEmployerSearchUrl(prefix, selectFields);
  if (!url || !appToken) {
    return [];
  }

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
      url = buildFmcsaEmployerSearchUrl(prefix, FMCSA_SELECT_MINIMAL);
      if (!url) return [];
      return await fetchJson(url, headers, signal);
    }
    throw e;
  }
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
