import React, { useId } from 'react';
import { MousePointerSquareDashed, Sparkles } from 'lucide-react';
import { Badge, Button, TabList, TabPanel } from '@/design-system/components';
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
 * The strip is `TabList` from the design system. It used to be a hand-built
 * WAI-ARIA tablist — roving tabindex, arrow/Home/End arithmetic, `aria-selected`,
 * `aria-controls` — recorded as a feature-owned exception "because the design
 * system has no approved Tabs primitive". It has had one since 2026-08-21; the
 * exception outlived its reason by four days and the whole keyboard model with
 * it. `fitted` is what reproduces the two half-width tabs.
 *
 * The panels stay mounted and `hidden`, which is deliberate: the properties panel
 * holds an in-progress field edit, and unmounting it would discard what the user
 * had typed when they glanced at the suggestions tab.
 */

export function EditorInspector({
    tab = INSPECTOR_TABS.PROPERTIES,
    onTabChange,
    suggestionCount = 0,
    hasSelection = false,
    propertiesPanel = null,
    aiPanel = null,
    onDismiss,
}) {
    const idBase = `inspector-${useId().replace(/:/g, '')}`;

    const tabs = [
        {
            id: INSPECTOR_TABS.PROPERTIES,
            label: 'Properties',
            icon: MousePointerSquareDashed,
        },
        {
            id: INSPECTOR_TABS.AI,
            label: 'AI Suggestions',
            icon: Sparkles,
            badge: suggestionCount > 0 ? <Badge tone="accent">{suggestionCount}</Badge> : null,
        },
    ];

    return (
        <div className="flex h-full min-h-0 flex-col bg-ds-surface">
            <div className="flex shrink-0 items-center border-b border-ds-border-subtle">
                <TabList
                    ariaLabel="Inspector"
                    idBase={idBase}
                    tabs={tabs}
                    activeTab={tab}
                    onChange={onTabChange}
                    fitted
                    className="min-w-0 flex-1 border-b-0"
                />
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

            <TabPanel
                idBase={idBase}
                tabId={INSPECTOR_TABS.PROPERTIES}
                hidden={tab !== INSPECTOR_TABS.PROPERTIES}
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {hasSelection ? (
                    propertiesPanel
                ) : (
                    <p className="p-ds-4 text-ds-sm text-ds-content-secondary">
                        Select a field on the document to edit its label, type and prefill.
                    </p>
                )}
            </TabPanel>

            <TabPanel
                idBase={idBase}
                tabId={INSPECTOR_TABS.AI}
                hidden={tab !== INSPECTOR_TABS.AI}
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {aiPanel || (
                    <p className="p-ds-4 text-ds-sm text-ds-content-secondary">
                        Run the AI Field Assistant from the Add Fields section to see suggestions here.
                        Suggestions never become part of your document until you apply them.
                    </p>
                )}
            </TabPanel>
        </div>
    );
}

export default EditorInspector;
