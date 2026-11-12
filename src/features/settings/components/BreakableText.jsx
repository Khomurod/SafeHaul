import React from 'react';

/**
 * Text that breaks only where a reader expects it, never at a hyphen inside a
 * part ("Delacroix-Whitfield" stays whole): a name at its spaces, an email
 * after its "@" and, when the part before it is longer than a line, after a
 * dot in that part — the domain stays whole. A part with no hyphen stays
 * plain text.
 */
export function BreakableText({ text, email = false }) {
    if (!email && !text.includes('-')) return text;
    const at = text.lastIndexOf('@');
    const parts = email
        ? [...(at > 0 ? text.slice(0, at + 1) : text).split(/(?<=\.)/), ...(at > 0 ? [text.slice(at + 1)] : [])]
        : text.split(' ');
    return parts.map((part, index) => (
        // The parts are positions in one string, so their index is their identity.
        <React.Fragment key={index}>
            {index > 0 && (email ? <wbr /> : ' ')}
            {part.includes('-') ? <span className="whitespace-nowrap">{part}</span> : part}
        </React.Fragment>
    ));
}
