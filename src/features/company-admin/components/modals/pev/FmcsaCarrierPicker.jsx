// src/features/company-admin/components/modals/pev/FmcsaCarrierPicker.jsx
//
// Presentational FMCSA company-match suggestions block for the PEV request modal.
// Pure/stateless — receives lookup state + selection and reports row clicks via
// onSelectRow. Extracted from PEVRequestModal (no refs involved, so a safe split).
//
// Presentation migrated to `--ds-*` tokens and the approved `Badge` (2026-07-27).
//
// Frozen contracts: `buildFmcsaRowKey`, the `onSelectRow(row, index)` argument
// pair, the `data-testid="fmcsa-row-N"` hooks, `mapFmcsaRowToPevContact` as the
// only source of displayed values, and every user-facing string.
//
// DOCUMENTED EXCEPTION — feature-owned raw `<button>` per row. Each row is a
// selectable suggestion carrying multi-line structured content (legal name,
// USDOT + city/state, and a contact-availability note). The approved `Button`
// takes inline children and owns its own layout, so it cannot host this; there
// is no Listbox/Combobox or SelectableCard primitive yet (recorded in the
// roadmap, same gap as the public application's FMCSA employer combobox).
// `aria-pressed` carries the selection, and the selected state is also stated in
// text — never by colour alone.
//
// DEFECTS FIXED (2026-07-27):
// - Six separate runs of 10 px interface text (the state note, the usage hint,
//   the per-row contact note, the "Selected" marker, the no-contact banner and
//   the census disclaimer), all below the 12 px floor.
// - The loading state was a bare spinner with no live region, so a screen-reader
//   user was told nothing while the registry was queried; the error and
//   no-results states were equally silent. All three are now announced.
// - The suggestion list was not a labelled region, so there was nothing to tell
//   assistive technology what the group of rows was for.

import React from 'react';
import { Building2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { mapFmcsaRowToPevContact } from '@shared/services/fmcsaEmployerSocrata';

/** Stable key for an FMCSA census row (DOT number + index). Shared with the container. */
export function buildFmcsaRowKey(row, index) {
    const dot = row?.dot_number === undefined || row?.dot_number === null ? 'x' : String(row.dot_number).trim();
    return `${dot}-${index}`;
}

export function FmcsaCarrierPicker({
    fmcsaStateCode,
    fmcsaLoading,
    fmcsaError,
    fmcsaRows,
    selectedFmcsaKey,
    lastFmcsaRowHadContact,
    onSelectRow,
}) {
    return (
        <section
            aria-label="FMCSA company match"
            className="space-y-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4"
        >
            <h5 className="flex items-center gap-ds-2 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                <Building2 size={14} className="text-ds-action-primary" aria-hidden="true" />
                FMCSA company match
            </h5>
            {fmcsaStateCode && (
                <p className="text-ds-xs leading-snug text-ds-content-secondary">
                    Prioritizing carriers in <span className="font-semibold">{fmcsaStateCode}</span> (employment address state). If none match there, results include other states.
                </p>
            )}
            <p className="text-ds-xs leading-snug text-ds-content-secondary">
                Tap a row to use that census record. Email and fax fill in only when FMCSA publishes them; otherwise enter them manually below.
            </p>

            {/*
              One live region covering all three lookup outcomes. Previously the
              search, its failure and "no matches" were all silent.
            */}
            <div role="status">
                {fmcsaLoading && (
                    <p className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                        <Loader2 size={16} className="animate-spin text-ds-action-primary" aria-hidden="true" />
                        Searching Transportation.gov registry…
                    </p>
                )}
                {fmcsaError && (
                    <p className="text-ds-xs text-ds-status-warning-fg">{fmcsaError}</p>
                )}
                {!fmcsaLoading && !fmcsaError && fmcsaRows.length === 0 && (
                    <p className="text-ds-xs text-ds-content-secondary">No matching motor carrier found for this name. Enter contact details manually below.</p>
                )}
            </div>

            {fmcsaRows.length > 0 && (
                <ul className="space-y-ds-2">
                    {fmcsaRows.map((row, idx) => {
                        const m = mapFmcsaRowToPevContact(row);
                        const rowKey = buildFmcsaRowKey(row, idx);
                        const selected = selectedFmcsaKey === rowKey;
                        const sub = [m.phyCity, m.phyState].filter(Boolean).join(', ');
                        const hasContact = !!(m.email || m.fax || m.phone);
                        return (
                            <li key={rowKey}>
                                <button
                                    type="button"
                                    aria-pressed={selected}
                                    data-testid={`fmcsa-row-${idx}`}
                                    onClick={() => onSelectRow(row, idx)}
                                    className={`w-full rounded-ds-md border px-ds-3 py-ds-2 text-left text-ds-sm transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${selected
                                        ? 'border-ds-focus bg-ds-status-info-bg shadow-ds-xs'
                                        : 'border-ds-border-subtle bg-ds-surface hover:border-ds-focus'
                                        }`}
                                >
                                    <span className="flex items-start justify-between gap-ds-2">
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-semibold text-ds-content">{m.legalName || 'Unknown'}</span>
                                            <span className="block text-ds-xs text-ds-content-secondary">
                                                USDOT {m.dotNumber || '—'}
                                                {sub ? ` · ${sub}` : ''}
                                            </span>
                                            <span className="mt-0.5 block text-ds-xs text-ds-content-secondary">
                                                {hasContact
                                                    ? 'Includes email, fax, or phone from FMCSA — merged into the form'
                                                    : 'Identity match — FMCSA did not list email/fax on this record'}
                                            </span>
                                        </span>
                                        {selected && (
                                            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-ds-action-primary" aria-hidden="true" />
                                        )}
                                    </span>
                                    {selected && (
                                        <span className="mt-ds-2 block text-ds-xs font-semibold uppercase tracking-wide text-ds-content-link">
                                            Selected
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {selectedFmcsaKey != null && lastFmcsaRowHadContact === false && (
                <div className="flex gap-ds-2 rounded-ds-md border border-ds-status-warning-border bg-ds-status-warning-bg p-ds-3 text-ds-xs text-ds-status-warning-fg">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <p>
                        <span className="font-semibold">No email or fax from this registry row.</span>
                        {' '}
                        Type the recipient email or fax below, or choose <strong>Download / Print</strong> so you do not need either.
                    </p>
                </div>
            )}

            <p className="text-ds-xs leading-snug text-ds-content-secondary">
                Suggestions are from the public FMCSA company census. Always verify the recipient before sending (49 CFR 391.23).
            </p>
        </section>
    );
}

export default FmcsaCarrierPicker;
