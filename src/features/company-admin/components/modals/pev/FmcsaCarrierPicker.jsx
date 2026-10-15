// src/features/company-admin/components/modals/pev/FmcsaCarrierPicker.jsx
//
// Presentational FMCSA company-match suggestions block for the PEV request modal.
// Pure/stateless — receives lookup state + selection and reports row clicks via
// onSelectRow. Extracted from PEVRequestModal (no refs involved, so a safe split).
//
// Presentation uses `--ds-*` tokens and approved design-system components.
//
// Frozen contracts: `buildFmcsaRowKey`, the `onSelectRow(row, index)` argument
// pair, the `data-testid="fmcsa-row-N"` hooks, `mapFmcsaRowToPevContact` as the
// only source of displayed values, and every user-facing string. The contact
// notes speak of the email alone: the dialog has no fax delivery, and nothing
// in it uses a phone.
//
// Each row is a `SelectableCard`: a selectable suggestion carrying multi-line
// structured content (legal name, USDOT + city/state, and a contact-availability
// note), which the approved `Button` cannot host — `Button` takes inline
// children and owns its own layout. `selected` carries the ARIA; the selected
// state is also stated in text below, never by colour alone.
//
// Rules this block keeps:
// - No interface text below the 12 px floor: the state note, the usage hint,
//   the per-row contact note, the "Selected" marker, the no-contact banner and
//   the census disclaimer included.
// - The loading, error and no-results states are announced, so a screen-reader
//   user hears what the registry query is doing.
// - The suggestion list is a labelled region, so assistive technology knows
//   what the group of rows is for.

import React from 'react';
import { Icon, Building2, Loader2, CheckCircle2 } from '@design-system/icons';
import { Notice, SelectableCard } from '@/design-system/components';
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
    lastFmcsaRowHadEmail,
    onSelectRow,
}) {
    return (
        <section
            aria-label="FMCSA company match"
            className="space-y-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4"
        >
            <h5 className="flex items-center gap-ds-2 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                <Icon icon={Building2} size="sm" className="text-ds-action-primary" />
                FMCSA company match
            </h5>
            {fmcsaStateCode && (
                <p className="text-ds-xs leading-snug text-ds-content-secondary">
                    Prioritizing carriers in <span className="font-semibold">{fmcsaStateCode}</span> (employment address state). If none match there, results include other states.
                </p>
            )}
            <p className="text-ds-xs leading-snug text-ds-content-secondary">
                Tap a row to use that census record. The email fills in only when FMCSA publishes one; otherwise enter it below.
            </p>

            {/*
              One live region covering all three lookup outcomes. Previously the
              search, its failure and "no matches" were all silent.
            */}
            <div role="status">
                {fmcsaLoading && (
                    <p className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                        <Icon icon={Loader2} className="animate-spin text-ds-action-primary" />
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
                        const hasEmail = !!m.email;
                        return (
                            <li key={rowKey}>
                                <SelectableCard
                                    selected={selected}
                                    padding="sm"
                                    data-testid={`fmcsa-row-${idx}`}
                                    onSelect={() => onSelectRow(row, idx)}
                                >
                                    <span className="flex w-full items-start justify-between gap-ds-2">
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-semibold text-ds-content">{m.legalName || 'Unknown'}</span>
                                            <span className="block text-ds-xs text-ds-content-secondary">
                                                USDOT {m.dotNumber || '—'}
                                                {sub ? ` · ${sub}` : ''}
                                            </span>
                                            <span className="mt-0.5 block text-ds-xs text-ds-content-secondary">
                                                {hasEmail
                                                    ? 'Includes an email from FMCSA — filled into the form'
                                                    : 'Identity match — FMCSA did not list an email on this record'}
                                            </span>
                                        </span>
                                        {selected && (
                                            <Icon icon={CheckCircle2} size="xl" className="mt-0.5 shrink-0 text-ds-action-primary" />
                                        )}
                                    </span>
                                    {selected && (
                                        <span className="mt-ds-2 block text-ds-xs font-semibold uppercase tracking-wide text-ds-content-link">
                                            Selected
                                        </span>
                                    )}
                                </SelectableCard>
                            </li>
                        );
                    })}
                </ul>
            )}

            {selectedFmcsaKey != null && lastFmcsaRowHadEmail === false && (
                /* The bold lead sentence becomes the `title`, which is the job
                   it was already doing by hand. The glyph normalises from
                   `AlertCircle` to the warning tone's own `AlertTriangle`: a
                   registry row with no contact details is a warning, and the
                   circle is what this application uses for danger. */
                <Notice tone="warning" size="sm" title="No email from this registry row.">
                    Type the recipient email below, or choose <strong>Download / Print</strong> so you do not need one.
                </Notice>
            )}

            <p className="text-ds-xs leading-snug text-ds-content-secondary">
                Suggestions are from the public FMCSA company census. Always verify the recipient before sending (49 CFR 391.23).
            </p>
        </section>
    );
}

export default FmcsaCarrierPicker;
