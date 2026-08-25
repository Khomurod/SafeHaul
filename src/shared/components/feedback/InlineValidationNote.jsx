import React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

/**
 * A soft inline note beside a field or a section — an inconsistency worth
 * mentioning, not an error that blocks.
 *
 * Migrated to `--ds-*` status roles on 2026-08-21. Same three types, same icons,
 * same message; the nine raw palette classes are gone and the tones now match
 * every other status surface in the product.
 *
 * Two things changed beyond the colours:
 *
 * - **An error note is announced.** `type="error"` renders `role="alert"`, so a
 *   note that appears in response to what the user just typed is spoken. It
 *   previously appeared in silence. `warning` and `info` stay quiet on purpose:
 *   they are commentary, and interrupting someone mid-form to observe that a
 *   date looks unusual is worse than letting them find it.
 * - **The icon is decorative.** It was unlabelled and not hidden, so assistive
 *   technology announced an anonymous graphic before the message.
 *
 * This is not `FieldMessage`. That is the design system's contract for a
 * message *owned by a form field*, wired through `FormField`'s
 * `aria-describedby`. This is a standalone note that can sit beside a group, a
 * row or a section, and is not part of any field's description.
 */
/*
 * Literal class strings, not `bg-ds-status-${tone}-bg`. Tailwind's extractor
 * reads source text, so a class name assembled at runtime is never compiled and
 * the note renders unstyled — a mistake that looks correct in the editor and
 * fails only in the built bundle.
 */
const TYPES = {
    warning: {
        Icon: AlertTriangle,
        className: 'border-ds-status-warning-border bg-ds-status-warning-bg text-ds-status-warning-fg',
    },
    info: {
        Icon: Info,
        className: 'border-ds-status-info-border bg-ds-status-info-bg text-ds-status-info-fg',
    },
    error: {
        Icon: AlertCircle,
        className: 'border-ds-status-danger-border bg-ds-status-danger-bg text-ds-status-danger-fg',
    },
};

export function InlineValidationNote({
    type = 'warning',
    message,
    className = '',
}) {
    const config = TYPES[type];
    if (!config) {
        throw new TypeError(`Unsupported InlineValidationNote type: ${type}`);
    }
    const { Icon } = config;

    return (
        <div
            role={type === 'error' ? 'alert' : undefined}
            className={`flex items-start gap-ds-2 rounded-ds-md border px-ds-3 py-ds-2 ${config.className} ${className}`.trim()}
        >
            <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="text-ds-sm">{message}</span>
        </div>
    );
}

export default InlineValidationNote;
