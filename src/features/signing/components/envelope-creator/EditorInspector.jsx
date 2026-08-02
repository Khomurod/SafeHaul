import React, { useId, useRef } from 'react';
import { MousePointerSquareDashed, Sparkles } from 'lucide-react';
import { Badge, Button } from '@/design-system/components';
import { INSPECTOR_TABS } from '@features/signing/utils/editorSaveState';

/**
 * Right inspector.
 *
 * The rail used to swap between two mutually exclusive panels and collapse to
 * nothing in between, so the canvas resized under the pointer every time a field
 * was selected or deselected. It is now one stable column with two tabs, and the
 * canvas keeps its width whatever you are doing.
 *
 * AI suggestions stay in their own tab and stay suggestions: nothing in here
 * turns one into a placed field. Only the review panel's explicit apply actions
 * do that, and they are unchanged.
 *
 * DOCUMENTED FEATURE-OWNED EXCEPTION — this is a hand-built WAI-ARIA tablist
 * (roving tabindex, arrow/Home/End keys, `aria-selected`, `aria-controls`)
 * because the design system has no approved Tabs primitive. The same exception
 * is already recorded for the Driver Dossier. The tabs themselves are the
 * approved `Button`, so only the ARIA wiring is feature-owned.
 */

const TAB_ORDER = [INSPECTOR_TABS.PROPERTIES, INSPECTOR_TABS.AI];

export function EditorInspector({
    tab = INSPECTOR_TABS.PROPERTIES,
    onTabChange,
    suggestionCount = 0,
    hasSelection = false,
    propertiesPanel = null,
    aiPanel = null,
    onDismiss,
}) {
    const rawId = useId().replace(/:/g, '');
    const tabRefs = useRef({});

    const tabId = (key) => `inspector-tab-${key}-${rawId}`;
    const panelId = (key) => `inspector-panel-${key}-${rawId}`;

    const focusTab = (key) => {
        onTabChange(key);
        // Focus follows selection, which is the automatic-activation pattern.
        window.requestAnimationFrame(() => tabRefs.current[key]?.focus());
    };

    const handleKeyDown = (event) => {
        const index = TAB_ORDER.indexOf(tab);
        if (index < 0) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            focusTab(TAB_ORDER[(index + 1) % TAB_ORDER.length]);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            focusTab(TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
        } else if (event.key === 'Home') {
            event.preventDefault();
            focusTab(TAB_ORDER[0]);
        } else if (event.key === 'End') {
            event.preventDefault();
            focusTab(TAB_ORDER[TAB_ORDER.length - 1]);
        }
    };

    const renderTab = (key, label, icon, badge) => {
        const isActive = tab === key;
        return (
            <Button
                key={key}
                ref={(node) => { tabRefs.current[key] = node; }}
                id={tabId(key)}
                role="tab"
                type="button"
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                justify="start"
                aria-selected={isActive}
                aria-controls={panelId(key)}
                tabIndex={isActive ? 0 : -1}
                className={`min-w-0 flex-1 rounded-none border-b-2 ${
                    isActive ? 'border-ds-action-primary' : 'border-transparent'
                }`}
                onClick={() => onTabChange(key)}
            >
                {icon}
                <span className="truncate">{label}</span>
                {badge}
            </Button>
        );
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-ds-surface">
            <div className="flex shrink-0 items-center border-b border-ds-border-subtle">
                <div
                    role="tablist"
                    aria-label="Inspector"
                    aria-orientation="horizontal"
                    className="flex min-w-0 flex-1"
                    onKeyDown={handleKeyDown}
                >
                    {renderTab(
                        INSPECTOR_TABS.PROPERTIES,
                        'Properties',
                        <MousePointerSquareDashed size={14} aria-hidden="true" />,
                        null,
                    )}
                    {renderTab(
                        INSPECTOR_TABS.AI,
                        'AI Suggestions',
                        <Sparkles size={14} aria-hidden="true" />,
                        suggestionCount > 0 ? <Badge tone="accent">{suggestionCount}</Badge> : null,
                    )}
                </div>
                {onDismiss && (
                    // Below the desktop breakpoint the inspector covers the canvas
                    // that would otherwise be clicked to dismiss it.
                    <div className="shrink-0 pr-ds-2 lg:hidden">
                        <Button variant="ghost" size="sm" onClick={onDismiss}>
                            Close inspector
                        </Button>
                    </div>
                )}
            </div>

            <div
                id={panelId(INSPECTOR_TABS.PROPERTIES)}
                role="tabpanel"
                aria-labelledby={tabId(INSPECTOR_TABS.PROPERTIES)}
                hidden={tab !== INSPECTOR_TABS.PROPERTIES}
                tabIndex={0}
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {hasSelection ? (
                    propertiesPanel
                ) : (
                    <p className="p-ds-4 text-ds-sm text-ds-content-secondary">
                        Select a field on the document to edit its label, type and prefill.
                    </p>
                )}
            </div>

            <div
                id={panelId(INSPECTOR_TABS.AI)}
                role="tabpanel"
                aria-labelledby={tabId(INSPECTOR_TABS.AI)}
                hidden={tab !== INSPECTOR_TABS.AI}
                tabIndex={0}
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {aiPanel || (
                    <p className="p-ds-4 text-ds-sm text-ds-content-secondary">
                        Run the AI Field Assistant from the Add Fields section to see suggestions here.
                        Suggestions never become part of your document until you apply them.
                    </p>
                )}
            </div>
        </div>
    );
}

export default EditorInspector;
