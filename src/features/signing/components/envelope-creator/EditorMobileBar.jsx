import React from 'react';
import { Files, LayoutGrid, PlusSquare, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';

/**
 * Bottom toolbar for the compact editor.
 *
 * The desktop rails are not squeezed onto a phone — they are replaced. This bar
 * is the way into each of them, and the PDF keeps the rest of the screen.
 *
 * DOCUMENTED FEATURE-OWNED EXCEPTION — these are raw `<button>`s rather than the
 * approved `Button`. Each is a full-height stacked icon-over-label cell in an
 * equal-width row, which the approved primitive's inline layout and padding
 * cannot express. They use only semantic `--ds-*` tokens, a 56 px activation
 * height (comfortably past the 44 px target minimum), a focus-visible ring, and
 * `aria-expanded` so the open sheet is stated rather than only shown. The
 * missing capability is a stacked/toolbar Button variant, recorded in the
 * roadmap alongside the palette-tone and Tabs gaps.
 */

const ITEMS = [
    { key: 'setup', label: 'Setup', icon: Settings2 },
    { key: 'add', label: 'Add Field', icon: PlusSquare },
    { key: 'fields', label: 'Fields', icon: Files },
    { key: 'inspector', label: 'Properties', icon: SlidersHorizontal },
    { key: 'ai', label: 'AI', icon: Sparkles },
    { key: 'pages', label: 'Pages', icon: LayoutGrid },
];

export function EditorMobileBar({ openSheet = null, onOpenSheet, fieldCount = 0, suggestionCount = 0 }) {
    const countFor = (key) => {
        if (key === 'fields') return fieldCount;
        if (key === 'ai') return suggestionCount;
        return 0;
    };

    return (
        <nav
            aria-label="Editor sections"
            className="z-30 flex shrink-0 items-stretch border-t border-ds-border bg-ds-surface lg:hidden"
        >
            {ITEMS.map(({ key, label, icon: Icon }) => {
                const count = countFor(key);
                return (
                    <button
                        key={key}
                        type="button"
                        aria-expanded={openSheet === key}
                        // "Open …" rather than the bare section name: the sheet it
                        // opens contains a heading with that name, and two controls
                        // with the same accessible name is a genuine ambiguity.
                        aria-label={count > 0 ? `Open ${label}, ${count}` : `Open ${label}`}
                        onClick={() => onOpenSheet(key)}
                        className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-ds-1 py-ds-1 transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                            openSheet === key
                                // `--ds-color-status-info-fg` rather than the
                                // primary action colour: on the info surface the
                                // latter measures 4.23:1, under the 4.5:1 minimum.
                                ? 'bg-ds-status-info-bg text-ds-status-info-fg'
                                : 'text-ds-content-secondary hover:bg-ds-surface-subtle'
                        }`}
                    >
                        <Icon size={18} aria-hidden="true" />
                        <span aria-hidden="true" className="text-ds-xs font-medium">
                            {label}
                            {count > 0 ? ` ${count}` : ''}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}

export default EditorMobileBar;
