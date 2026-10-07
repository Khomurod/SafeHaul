import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  fetchFmcsaEmployerSuggestions,
  mapFmcsaRowToEmployerFields,
} from '@shared/services/fmcsaEmployerSocrata';
import InputField from '@shared/components/form/InputField';
import { FieldMessage, Input, Label } from '@/design-system/components';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';

const DEBOUNCE_MS = 400;

/** The row fields a pick fills, every one of them each time. */
const PICKED_FIELDS = Object.freeze(['companyName', 'dotNumber', 'address', 'city', 'state', 'phone', 'companyEmail']);

const COUNTRY_NAMES = Object.freeze({ CA: 'Canada', MX: 'Mexico' });

export { mapFmcsaRowToEmployerFields };

/**
 * The Socrata app token. A browser test asks for a placeholder with
 * `?e2eSafer=mock` and answers the lookup's requests itself; a production build
 * never takes one.
 */
function lookupToken() {
  const token = import.meta.env.VITE_SOCRATA_APP_TOKEN;
  if (token) return token;
  const mocked = isE2ETestMode && !import.meta.env.PROD && getE2EQueryParam('e2eSafer', '') === 'mock';
  return mocked ? 'e2e-placeholder' : '';
}

/** A suggestion's second line: USDOT number, place, and "Inactive" for a closed carrier. */
function describeCarrier(row) {
  const country = String(row?.phy_country ?? '').trim().toUpperCase();
  const place = [row?.phy_city, row?.phy_state, COUNTRY_NAMES[country] || (country !== 'US' ? country : '')]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ');
  const status = row?.status_code && row.status_code !== 'A' ? 'Inactive' : '';
  return [`USDOT ${row?.dot_number ?? '—'}`, place, status].filter(Boolean).join(' · ');
}

/** The trade name, when it is not the legal name again; FMCSA sometimes writes "DBA" into it. */
function tradeNameOf(row) {
  const trade = String(row?.dba_name ?? '').trim().replace(/^D\/?B\/?A\b[\s:]*/i, '');
  return trade && trade.toUpperCase() !== String(row?.legal_name ?? '').trim().toUpperCase() ? trade : '';
}

/**
 * The employer's name, with FMCSA's census behind it: a driver types part of a
 * legal or trade name, or a USDOT number, and picks the carrier to fill the row.
 *
 * A pick fills every field the carrier's record has. A field it has nothing for is
 * emptied only when the previous pick filled it and the driver has not changed it
 * since, so choosing another carrier leaves nothing of the first one behind and
 * keeps what the driver typed. "Previous pick" lasts while the row is on screen.
 *
 * @param {object} props
 * @param {Record<string, unknown>} [props.row] the employer row as it stands, to
 *   tell a value the last pick filled from one the driver typed
 */
export default function EmployerNameAutocomplete({
  id,
  label = 'Company Name',
  value,
  required = false,
  onChange,
  statesAllowlist = [],
  row,
  // Why the name is needed, shown under it as `InputField` shows its own.
  error,
}) {
  const token = lookupToken();
  const listboxId = useId();
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const fetchGenerationRef = useRef(0);
  const lastPickRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [noMatch, setNoMatch] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const runFetch = useCallback(
    async (prefix) => {
      if (!token) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const gen = ++fetchGenerationRef.current;
      setLoading(true);
      setFetchError(null);
      setNoMatch(false);
      try {
        const rows = await fetchFmcsaEmployerSuggestions(prefix, {
          signal: controller.signal,
          appToken: token,
        });
        if (gen !== fetchGenerationRef.current) return;
        setItems(rows);
        setOpen(rows.length > 0);
        setNoMatch(rows.length === 0);
        setHighlightIndex(rows.length > 0 ? 0 : -1);
      } catch (e) {
        if (e?.name === 'AbortError') return;
        if (gen !== fetchGenerationRef.current) return;
        console.warn('[EmployerNameAutocomplete]', e);
        setFetchError('Lookup temporarily unavailable.');
        setItems([]);
        setOpen(false);
      } finally {
        if (gen === fetchGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [token],
  );

  useEffect(() => {
    return () => {
      debounceRef.current && clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Keeps the highlighted suggestion in view as the arrow keys move it down the list.
  useEffect(() => {
    if (!open || highlightIndex < 0) return;
    listRef.current?.querySelector(`[data-option-index="${highlightIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightIndex, open]);

  const applyRow = useCallback(
    (picked) => {
      const next = mapFmcsaRowToEmployerFields(picked, statesAllowlist);
      const previous = lastPickRef.current;
      for (const field of PICKED_FIELDS) {
        if (next[field]) {
          onChange(field, next[field]);
        } else if (previous?.[field] && String(row?.[field] ?? '') === previous[field]) {
          onChange(field, '');
        }
      }
      lastPickRef.current = next;
      setOpen(false);
      setItems([]);
      setHighlightIndex(-1);
    },
    [onChange, row, statesAllowlist],
  );

  const handleInputChange = useCallback(
    (name, nextValue) => {
      onChange(name, nextValue);
      setFetchError(null);
      setNoMatch(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!token) return;

      abortRef.current?.abort();

      const trimmed = String(nextValue ?? '').trim();
      if (trimmed.length < 2) {
        fetchGenerationRef.current += 1;
        setItems([]);
        setOpen(false);
        setLoading(false);
        return;
      }

      debounceRef.current = setTimeout(() => {
        void runFetch(trimmed);
      }, DEBOUNCE_MS);
    },
    [onChange, runFetch, token],
  );

  const onKeyDown = useCallback(
    (e) => {
      if (!open || items.length === 0) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(items.length - 1, i + 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === 'Enter' && highlightIndex >= 0 && items[highlightIndex]) {
        e.preventDefault();
        applyRow(items[highlightIndex]);
      }
    },
    [applyRow, highlightIndex, items, open],
  );

  if (!token) {
    return (
      <InputField
        label={label}
        id={id}
        name="companyName"
        value={value}
        onChange={handleInputChange}
        required={required}
        placeholder="Employer legal name"
        autoComplete="off"
        error={error}
      />
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div onKeyDown={onKeyDown}>
        <div className="mb-ds-1 flex flex-wrap items-baseline justify-between gap-x-ds-2">
          <Label htmlFor={id} required={required}>{label}</Label>
          <span className="text-ds-xs text-ds-content-muted">FMCSA carrier lookup</span>
          {/* Announced so a screen-reader user knows the lookup is running
              rather than that nothing happened. */}
          {loading && <span role="status" className="text-ds-xs text-ds-content-muted">Searching…</span>}
        </div>
        <Input
          type="text"
          id={id}
          name="companyName"
          // The lookup has its own listbox; the browser's list would cover it.
          autoComplete="off"
          required={required}
          aria-required={required || undefined}
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && highlightIndex >= 0 ? `${listboxId}-option-${highlightIndex}` : undefined}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          aria-describedby={[fetchError ? `${id}-lookup-error` : null, noMatch ? `${id}-no-match` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined}
          role="combobox"
          value={value || ''}
          placeholder="Company name or USDOT number…"
          onChange={(e) => handleInputChange(e.target.name, e.target.value)}
        />
      </div>
      {error && <FieldMessage id={`${id}-error`} tone="error" className="mt-ds-1">{error}</FieldMessage>}
      {fetchError && (
        <FieldMessage id={`${id}-lookup-error`} tone="help" className="mt-ds-1 text-ds-status-warning-fg">
          {fetchError}
        </FieldMessage>
      )}
      {noMatch && (
        <FieldMessage id={`${id}-no-match`} tone="help" role="status" className="mt-ds-1">
          No carrier found under that name or USDOT number. You can type the company in yourself.
        </FieldMessage>
      )}
      {open && items.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-ds-dropdown mt-ds-1 max-h-60 w-full overflow-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
          {items.map((carrier, idx) => {
            const name = carrier?.legal_name ?? 'Unknown';
            const trade = tradeNameOf(carrier);
            return (
              <li key={`${carrier?.dot_number ?? '—'}-${name}-${idx}`} role="presentation">
                {/* DOCUMENTED EXCEPTION — raw button.
                    An ARIA combobox option must carry `role="option"` inside the
                    listbox. The approved `Button` renders `role="button"`, which
                    would break the combobox's accessibility contract, and the
                    design system has no Combobox/Listbox primitive yet (recorded
                    as an open family in the roadmap). Presentation uses `--ds-*`
                    tokens only; the focus/selection model is unchanged. */}
                <button
                  type="button"
                  id={`${listboxId}-option-${idx}`}
                  data-option-index={idx}
                  role="option"
                  aria-selected={idx === highlightIndex}
                  className={`w-full border-b border-ds-border-subtle px-ds-3 py-ds-2 text-left text-ds-sm last:border-b-0 hover:bg-ds-surface-subtle ${idx === highlightIndex ? 'bg-ds-surface-subtle' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyRow(carrier)}
                >
                  <span className="block truncate font-medium text-ds-content">{name}</span>
                  {trade && <span className="block truncate text-ds-xs text-ds-content">d/b/a {trade}</span>}
                  <span className="text-ds-xs text-ds-content-muted">{describeCarrier(carrier)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
