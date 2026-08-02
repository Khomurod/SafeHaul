import React from 'react';
import { PenTool, Fingerprint } from 'lucide-react';
import { isFieldLocked } from '@features/signing/utils/prefillEngine';
import { SignerFieldOverlay } from '@features/signing/components/SignerFieldOverlay';

/**
 * Renders one signer-facing field overlay (text/date/checkbox/signature/initial).
 *
 * Presentation only: the locked-field rule (`isFieldLocked`), every change/focus/
 * Enter-advance handler, the signature-tap flow, the rendered ink `img`, and the
 * `data-signer-input` hooks the E2E specs drive are unchanged. Field tones use the
 * same `--ds-*` status tokens as the creator palette and the placed-field
 * overlays, so the whole E-Doc family shares one colour legend.
 */

const fillClass = 'w-full h-full min-w-0 min-h-0 box-border';

/**
 * Accessible name for a signer control.
 *
 * These inputs are absolutely positioned over the PDF, so there is nowhere to put
 * a visible label — the field's own label is the only thing that identifies it.
 *
 * A bare label is not enough. The palette defaults give every checkbox the label
 * "Checkbox", so an envelope with several of them produced indistinguishable
 * controls: axe's `label` rule passed merely because the string was non-empty
 * while a signer still could not tell which box they were ticking. Raised as P1 in
 * review on PR #112 and fixed here by appending stable contextual information —
 * the field's position in the signing order and its page — so every control is
 * uniquely identifiable even when the author supplied no meaningful label.
 */
function fieldLabel(field, position, total) {
    const label = typeof field.label === 'string' ? field.label.trim() : '';
    const base = label || `${field.type} field`;
    const page = Number(field.pageNumber) || 1;
    if (!position || !total) return `${base}, page ${page}`;
    return `${base}, field ${position} of ${total} on page ${page}`;
}

export function SignerField({
    field,
    signed,
    fieldValues,
    handleFieldChange,
    handleFieldFocus,
    handleEnterAdvance,
    handleSignatureTap,
    fieldPosition,
    fieldTotal,
}) {
    if (signed) return null;

    switch (field.type) {
        case 'text': {
            if (isFieldLocked(field)) {
                return (
                    <SignerFieldOverlay field={field} interactive={false}>
                        <div className={`${fillClass} flex items-center overflow-hidden rounded border-2 border-ds-status-info-border bg-ds-status-info-bg px-2 text-ds-sm font-medium text-ds-content`}>
                            {field.defaultValue || ''}
                        </div>
                    </SignerFieldOverlay>
                );
            }
            return (
                <SignerFieldOverlay field={field}>
                    <input
                        className={`${fillClass} rounded border-2 border-ds-status-info-border bg-ds-status-info-bg px-2 text-base md:text-ds-sm`}
                        placeholder="Type here..."
                        aria-label={fieldLabel(field, fieldPosition, fieldTotal)}
                        value={fieldValues[field.id] || ''}
                        data-signer-input={field.id}
                        enterKeyHint="next"
                        onFocus={handleFieldFocus}
                        onKeyDown={handleEnterAdvance(field)}
                        onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    />
                </SignerFieldOverlay>
            );
        }
        case 'date': {
            if (isFieldLocked(field)) {
                return (
                    <SignerFieldOverlay field={field} interactive={false}>
                        <div className={`${fillClass} flex items-center overflow-hidden rounded border-2 border-ds-status-success-border bg-ds-status-success-bg px-2 text-ds-sm font-medium text-ds-content`}>
                            {field.defaultValue || ''}
                        </div>
                    </SignerFieldOverlay>
                );
            }
            return (
                <SignerFieldOverlay field={field}>
                    <input
                        type="date"
                        className={`${fillClass} rounded border-2 border-ds-status-success-border bg-ds-status-success-bg px-2 text-base md:text-ds-sm`}
                        aria-label={fieldLabel(field, fieldPosition, fieldTotal)}
                        value={fieldValues[field.id] || ''}
                        data-signer-input={field.id}
                        onFocus={handleFieldFocus}
                        onKeyDown={handleEnterAdvance(field)}
                        onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    />
                </SignerFieldOverlay>
            );
        }
        case 'checkbox':
            return (
                <SignerFieldOverlay field={field}>
                    <label className={`${fillClass} flex items-center justify-center cursor-pointer m-0`}>
                        <input
                            type="checkbox"
                            className="m-0 h-full max-h-full w-full min-w-0 min-h-0 max-w-full cursor-pointer accent-ds-status-accent-fg"
                            aria-label={fieldLabel(field, fieldPosition, fieldTotal)}
                            checked={!!fieldValues[field.id]}
                            onChange={(e) => handleFieldChange(field.id, e.target.checked)}
                        />
                    </label>
                </SignerFieldOverlay>
            );
        case 'signature':
        case 'initial': {
            const isInitial = field.type === 'initial';
            const value = fieldValues[field.id];
            const palette = isInitial
                ? { signed: 'bg-ds-status-warning-bg border-ds-status-warning-border', empty: 'bg-ds-status-warning-bg border-ds-status-warning-border motion-safe:animate-pulse', text: 'text-ds-status-warning-fg' }
                : { signed: 'bg-ds-status-warning-bg border-ds-status-warning-border', empty: 'bg-ds-status-warning-bg border-ds-status-warning-border motion-safe:animate-pulse', text: 'text-ds-status-warning-fg' };
            return (
                <SignerFieldOverlay field={field}>
                    {/*
                     * Documented exception (compact icon-button gap in the
                     * roadmap). This control must fill the author-placed field
                     * box exactly — which can be as small as 8 px — while
                     * carrying the dashed placeholder treatment and, once
                     * signed, the stamped ink `img` at the box's own aspect.
                     * The approved `Button` imposes a min-height, inline
                     * padding and its own background, all of which would break
                     * the overlay's alignment with the PDF coordinates. Same
                     * constraint that keeps the creator's corner remove badge a
                     * feature-owned composition. It still carries an explicit
                     * accessible name, a focus-visible ring and `--ds-*` tones.
                     */}
                    <button
                        type="button"
                        onClick={() => handleSignatureTap(field)}
                        aria-label={
                            value
                                ? (isInitial ? 'Initials added — tap to redraw' : 'Signature added — tap to redraw')
                                : (isInitial ? 'Tap to add initials' : 'Tap to sign')
                        }
                        className={`${fillClass} flex cursor-pointer items-center justify-center gap-1 rounded border-2 shadow-ds-xs transition focus-visible:outline-none focus-visible:shadow-ds-focus ${value ? 'border-solid p-0.5' : 'border-dashed'} ${value ? palette.signed : palette.empty}`}
                    >
                        {value ? (
                            // Show the actual ink on the document — the signer
                            // sees exactly what the sealed PDF will contain.
                            <img
                                src={value}
                                alt={isInitial ? 'Your initials' : 'Your signature'}
                                className="w-full h-full object-contain pointer-events-none"
                                draggable={false}
                            />
                        ) : (
                            <span className={`${palette.text} flex items-center gap-1 text-ds-xs font-medium`}>
                                {isInitial ? <Fingerprint size={12} /> : <PenTool size={14} />}
                                {isInitial ? 'Initial' : 'Sign'}
                            </span>
                        )}
                    </button>
                </SignerFieldOverlay>
            );
        }
        default:
            return null;
    }
}

export default SignerField;
