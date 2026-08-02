/**
 * Helpers for segmented date inputs (YYYY-MM-DD and YYYY-MM) used across the driver application.
 */

/** @param {number} year @param {number} month 1-12 */
export function daysInMonth(year, month) {
    if (!year || !month) return 31;
    return new Date(year, month, 0).getDate();
}

/**
 * @param {string} iso — YYYY-MM-DD
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function parseIsoDateParts(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (day > daysInMonth(year, month)) return null;
    return { year, month, day };
}

/**
 * @param {string} iso
 * @returns {string} M/D/YYYY for display (no zero-padding on month/day for readability)
 */
export function formatIsoDateUs(iso) {
    const p = parseIsoDateParts(iso);
    if (!p) return iso || '';
    return `${p.month}/${p.day}/${p.year}`;
}

/**
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} d
 * @returns {string} YYYY-MM-DD
 */
export function buildIsoDate(y, m, d) {
    if (!y || !m || !d) return '';
    const dim = daysInMonth(y, m);
    const dd = Math.min(d, dim);
    return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** @param {string} value — YYYY-MM or legacy mm/yyyy, MM/YYYY */
export function parseMonthYear(value) {
    if (!value || typeof value !== 'string') return { year: '', month: '' };
    const t = value.trim();
    const iso = t.match(/^(\d{4})-(\d{2})$/);
    if (iso) {
        const year = Number(iso[1]);
        const month = Number(iso[2]);
        if (month >= 1 && month <= 12) return { year, month };
    }
    const legacy = t.match(/^(\d{1,2})\s*[-/]\s*(\d{4})$/);
    if (legacy) {
        const month = Number(legacy[1]);
        const year = Number(legacy[2]);
        if (month >= 1 && month <= 12 && year >= 1900) return { year, month };
    }
    return { year: '', month: '' };
}

export function formatMonthYearIso(year, month) {
    if (!year || !month) return '';
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** Display MM/YYYY */
export function formatMonthYearUs(isoOrLegacy) {
    const { year, month } = parseMonthYear(isoOrLegacy);
    if (!year || !month) return isoOrLegacy || '';
    return `${String(month).padStart(2, '0')}/${year}`;
}

/** Age in full years from YYYY-MM-DD */
export function ageFromIsoDate(iso, refDate = new Date()) {
    const p = parseIsoDateParts(iso);
    if (!p) return null;
    let age = refDate.getFullYear() - p.year;
    const m = refDate.getMonth() + 1 - p.month;
    if (m < 0 || (m === 0 && refDate.getDate() < p.day)) age--;
    return age;
}
