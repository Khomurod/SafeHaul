import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  FMCSA_SELECT_EXTENDED,
  fetchFmcsaEmployerSuggestions,
  mapFmcsaRowToEmployerFields,
} from '@shared/services/fmcsaEmployerSocrata';
import InputField from '@shared/components/form/InputField';
import { FieldMessage, Input, Label } from '@/design-system/components';

const DEBOUNCE_MS = 400;

export { mapFmcsaRowToEmployerFields };

export default function EmployerNameAutocomplete({
  id,
  label = 'Company Name',
  value,
  required = false,
  onChange,
  statesAllowlist = [],
}) {
  const token = import.meta.env.VITE_SOCRATA_APP_TOKEN;
  const listboxId = useId();
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const fetchGenerationRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [fetchError, setFetchError] = useState(null);
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
      try {
        const rows = await fetchFmcsaEmployerSuggestions(prefix, {
          signal: controller.signal,
          appToken: token,
          selectFields: FMCSA_SELECT_EXTENDED,
        });
        if (gen !== fetchGenerationRef.current) return;
        setItems(rows);
        setOpen(rows.length > 0);
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

  const applyRow = useCallback(
    (row) => {
      const m = mapFmcsaRowToEmployerFields(row, statesAllowlist);
      onChange('companyName', m.companyName);
      onChange('dotNumber', m.dotNumber);
      onChange('address', m.address);
      onChange('city', m.city);
      if (m.state) onChange('state', m.state);
      if (m.phone) onChange('phone', m.phone);
      if (m.companyEmail) onChange('companyEmail', m.companyEmail);
      setOpen(false);
      setItems([]);
      setHighlightIndex(-1);
    },
    [onChange, statesAllowlist],
  );

  const handleInputChange = useCallback(
    (name, nextValue) => {
      onChange(name, nextValue);
      setFetchError(null);
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
          autoComplete="organization"
          required={required}
          aria-required={required || undefined}
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && highlightIndex >= 0 ? `${listboxId}-option-${highlightIndex}` : undefined}
          aria-autocomplete="list"
          aria-describedby={fetchError ? `${id}-lookup-error` : undefined}
          role="combobox"
          value={value || ''}
          placeholder="Start typing employer legal name…"
          onChange={(e) => handleInputChange(e.target.name, e.target.value)}
        />
      </div>
      {fetchError && (
        <FieldMessage id={`${id}-lookup-error`} tone="help" className="mt-ds-1 text-ds-status-warning-fg">
          {fetchError}
        </FieldMessage>
      )}
      {open && items.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-[100] mt-ds-1 max-h-60 w-full overflow-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
          {items.map((row, idx) => {
            const name = row?.legal_name ?? 'Unknown';
            const dot = row?.dot_number != null ? String(row.dot_number) : '—';
            const city = row?.phy_city ?? '';
            const st = row?.phy_state ?? '';
            const sub = [city, st].filter(Boolean).join(', ');
            return (
              <li key={`${dot}-${name}-${idx}`} role="presentation">
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
                  role="option"
                  aria-selected={idx === highlightIndex}
                  className={`w-full border-b border-ds-border-subtle px-ds-3 py-ds-2 text-left text-ds-sm last:border-b-0 hover:bg-ds-surface-subtle ${idx === highlightIndex ? 'bg-ds-surface-subtle' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyRow(row)}
                >
                  <span className="block truncate font-medium text-ds-content">{name}</span>
                  <span className="text-ds-xs text-ds-content-muted">
                    USDOT {dot}
                    {sub ? ` · ${sub}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
