import React from 'react';
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react';
import { IconButton } from '@/design-system/components';
import { credentialSlotId } from '../../hooks/useRevealedCredential';
import { MASKED_PLACEHOLDER } from './aiProviderPresentation';

/**
 * The masked credential cell and its eye control.
 *
 * The mask is a literal `********` with no relationship to the real value — not
 * its length, not its shape. A revealed value is rendered as ordinary text
 * content with the remaining seconds announced beside it; nothing about it is
 * written to a `data-` attribute, a `title`, the URL or any storage.
 *
 * The eye's accessible name names the provider and the field it acts on, because
 * a page of identical "Reveal" buttons is unusable with a screen reader, and
 * because a provider can have more than one credential field.
 */

export function AiCredentialCell({
    providerId,
    providerName,
    field,
    revealedSlot,
    pendingSlot,
    revealedValue,
    unavailableReason,
    secondsRemaining,
    canReveal,
    onToggle,
}) {
    const slot = credentialSlotId(providerId, field.name);
    const isRevealed = revealedSlot === slot;
    const isPending = pendingSlot === slot;
    const label = `${isRevealed ? 'Hide' : 'Reveal'} ${providerName} ${field.label}`;

    return (
        <div className="flex min-w-0 items-start gap-ds-2">
            <div className="min-w-0 flex-1">
                <span className="block text-ds-xs text-ds-content-secondary">{field.label}</span>

                {!isRevealed && (
                    <span className="font-mono text-ds-sm text-ds-content-secondary">
                        {field.configured ? MASKED_PLACEHOLDER : 'Not configured'}
                    </span>
                )}

                {isRevealed && revealedValue !== null && (
                    <>
                        <span className="block break-all font-mono text-ds-sm text-ds-content-primary">
                            {revealedValue}
                        </span>
                        <span role="status" className="block text-ds-xs text-ds-content-secondary">
                            Hides automatically in {secondsRemaining}s
                        </span>
                    </>
                )}

                {isRevealed && revealedValue === null && (
                    <span className="flex items-center gap-ds-1 text-ds-sm text-ds-content-secondary">
                        <ShieldAlert size={14} aria-hidden="true" />
                        {unavailableReason}
                    </span>
                )}
            </div>

            <IconButton
                label={label}
                variant="ghost"
                size="sm"
                aria-pressed={isRevealed}
                disabled={isPending || !canReveal || !field.configured}
                onClick={() => onToggle(providerId, field.name)}
            >
                {isPending
                    ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    : (isRevealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />)}
            </IconButton>
        </div>
    );
}

export default AiCredentialCell;
