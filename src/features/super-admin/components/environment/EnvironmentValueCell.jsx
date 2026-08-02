import React from 'react';
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react';
import { IconButton } from '@/design-system/components';

/**
 * The masked value cell and its eye control.
 *
 * The masked string is a literal `********` with no relationship to the real
 * value — not its length, not its shape. When a value is revealed it is rendered
 * as ordinary text content, with the remaining seconds announced beside it, and
 * nothing about it is written to a `data-` attribute, a `title`, the URL or any
 * storage.
 *
 * The eye's accessible name says which key it acts on ("Reveal SMS_ENCRYPTION_KEY"
 * / "Hide SMS_ENCRYPTION_KEY"), because a table of thirty identical "Reveal"
 * buttons is unusable with a screen reader.
 */

export const MASKED_PLACEHOLDER = '********';

export function EnvironmentValueCell({
    entry,
    isRevealed,
    isPending,
    revealedValue,
    unavailableReason,
    secondsRemaining,
    onToggle,
}) {
    const label = `${isRevealed ? 'Hide' : 'Reveal'} ${entry.key}`;

    return (
        <div className="flex min-w-0 items-start gap-ds-2">
            <div className="min-w-0 flex-1">
                {!isRevealed && (
                    <span className="font-mono text-ds-sm text-ds-content-secondary" aria-label={`${entry.key} value hidden`}>
                        {MASKED_PLACEHOLDER}
                    </span>
                )}

                {isRevealed && revealedValue !== null && (
                    <>
                        <span className="block break-all font-mono text-ds-sm text-ds-content">
                            {revealedValue}
                        </span>
                        <span className="mt-1 block text-ds-sm text-ds-content-muted" role="status">
                            Hides automatically in {secondsRemaining}s
                        </span>
                    </>
                )}

                {isRevealed && revealedValue === null && (
                    <span className="flex items-start gap-ds-1 text-ds-sm text-ds-content-secondary" role="status">
                        <ShieldAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                        <span>{unavailableReason}</span>
                    </span>
                )}
            </div>

            <IconButton
                size="sm"
                variant="ghost"
                label={label}
                aria-pressed={isRevealed}
                disabled={isPending || !entry.permissions.revealable}
                onClick={() => onToggle(entry)}
            >
                {isPending
                    ? <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                    : (isRevealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />)}
            </IconButton>
        </div>
    );
}
