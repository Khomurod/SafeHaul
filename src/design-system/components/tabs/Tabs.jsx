import React, { forwardRef, useCallback, useRef } from 'react';
import { Icon as DsIcon } from '../../icons';
import './Tabs.css';

/**
 * The WAI-ARIA tab pattern.
 *
 * Nine screens had hand-rolled this — `DocumentsManager`, `AnalyticsView`,
 * `CreateView`, `AiIntegrationsView`, `CampaignsDashboard`, `AudienceBuilder`
 * (twice), `DossierSidebar`, `EditorInspector` and `NotificationBell` — and
 * seven of them had written the same `handleTabKeyDown` with the same
 * arrow/Home/End arithmetic. Each copy is a chance to get roving `tabIndex`
 * wrong, and two earlier copies did: they had `role="tab"` with no
 * `aria-selected` and no arrow-key movement, which is a tablist that announces
 * itself as one and then does not behave like one.
 *
 * `TabList` and `TabPanel` are separate exports rather than one component
 * because two consumers render the strip and the panel in different components
 * (the dossier's sidebar owns the strip; the profile modal owns the panel).
 * They agree on ids through `tabIds`, which both call — so the
 * `aria-controls` / `aria-labelledby` pair cannot drift apart by hand.
 */

/**
 * The id pair that wires a tab to its panel. Exported so a consumer splitting
 * `TabList` and `TabPanel` across components derives both from one `idBase`
 * instead of writing the strings twice.
 */
export function tabIds(idBase, tabId) {
  if (typeof idBase !== 'string' || idBase.trim() === '') {
    throw new TypeError('tabIds requires a non-empty idBase.');
  }
  return {
    tabId: `${idBase}-tab-${tabId}`,
    panelId: `${idBase}-panel-${tabId}`,
  };
}

const ORIENTATIONS = new Set(['horizontal', 'vertical']);

/**
 * The two strip shapes the product actually uses.
 *
 * `underline` is the page-level strip. `pill` is the secondary strip that sits
 * *inside* a panel — the campaign audience builder's import-method chooser is
 * one — where an underline would compete with the page strip above it for the
 * same meaning. Both are the same control: same roving `tabIndex`, same keyboard
 * model, same height, same icon size. Only the selected treatment differs.
 *
 * This exists because the alternative was worse. Eleven hand-rolled strips
 * carried at least three treatments between them, and a primitive that could
 * express only one of them would have left the others hand-rolled — which is
 * how a primitive ends up with no consumers.
 */
const VARIANTS = new Set(['underline', 'pill']);

/** Arrow keys follow the strip's orientation; Home/End always work. */
const KEYS_BY_ORIENTATION = {
  horizontal: { previous: 'ArrowLeft', next: 'ArrowRight' },
  vertical: { previous: 'ArrowUp', next: 'ArrowDown' },
};

/**
 * @param {object} props
 * @param {string} props.ariaLabel Names the strip. Required — "tab list" is not a name.
 * @param {string} props.idBase Shared with the matching `TabPanel`.
 * @param {Array<{id: string, label: string, icon?: React.ElementType, badge?: React.ReactNode}>} props.tabs
 * @param {string} props.activeTab
 * @param {(id: string) => void} props.onChange
 * @param {'horizontal'|'vertical'} [props.orientation='horizontal']
 * @param {'underline'|'pill'} [props.variant='underline']
 * @param {boolean} [props.fitted] Tabs share the strip's width equally. For a
 *   strip that spans a narrow panel — a notification popover — where tabs
 *   hugging their labels leaves a ragged gap.
 */
export function TabList({
  ariaLabel,
  idBase,
  tabs,
  activeTab,
  onChange,
  orientation = 'horizontal',
  variant = 'underline',
  fitted = false,
  className = '',
  ...props
}) {
  if (typeof ariaLabel !== 'string' || ariaLabel.trim() === '') {
    throw new TypeError('TabList requires an ariaLabel naming what the tabs switch between.');
  }
  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new TypeError('TabList requires at least one tab.');
  }
  if (!ORIENTATIONS.has(orientation)) {
    throw new TypeError(`Unsupported TabList orientation: ${orientation}`);
  }
  if (!VARIANTS.has(variant)) {
    throw new TypeError(`Unsupported TabList variant: ${variant}`);
  }
  if (variant === 'pill' && orientation === 'vertical') {
    // Not a limitation worth designing around: nothing in the product wants it,
    // and a silently-ignored combination is how a component starts lying about
    // what it supports.
    throw new TypeError('TabList does not support variant="pill" with orientation="vertical".');
  }

  const buttonRefs = useRef({});

  const handleKeyDown = useCallback((event) => {
    const { previous, next } = KEYS_BY_ORIENTATION[orientation];
    const handled = [previous, next, 'Home', 'End'];
    if (!handled.includes(event.key)) return;
    event.preventDefault();

    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    const from = currentIndex === -1 ? 0 : currentIndex;
    let nextIndex = from;
    if (event.key === previous) nextIndex = (from - 1 + tabs.length) % tabs.length;
    if (event.key === next) nextIndex = (from + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;

    const target = tabs[nextIndex];
    onChange?.(target.id);
    // Focus follows selection — automatic activation, which is the correct
    // choice when switching a tab is cheap and reversible. It is also what all
    // nine hand-rolled copies did, so migrating them changes no behaviour.
    buttonRefs.current[target.id]?.focus();
  }, [activeTab, onChange, orientation, tabs]);

  return (
    <div
      {...props}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
      onKeyDown={handleKeyDown}
      className={`ds-tab-list ${className}`.trim()}
      data-orientation={orientation}
      data-variant={variant}
      data-fitted={fitted || undefined}
    >
      {tabs.map((tab) => {
        const isSelected = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(node) => { buttonRefs.current[tab.id] = node; }}
            type="button"
            role="tab"
            id={tabIds(idBase, tab.id).tabId}
            aria-selected={isSelected}
            /*
              Only the selected tab points at a panel.
              The ARIA tab pattern makes `aria-controls` optional exactly when the
              unselected panels are not in the DOM, which is this design system's
              convention — `TabPanel` renders the active panel and features render
              one at a time. Setting it on every tab produced a dangling reference
              for every unselected one, and it also made the primitive unusable for
              the consumers that share a single panel between tabs (the
              notification popover is one), which is a real shape and not a mistake.
            */
            aria-controls={isSelected ? tabIds(idBase, tab.id).panelId : undefined}
            /* Roving tabIndex: one stop for the whole strip, then arrow keys. */
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange?.(tab.id)}
            className="ds-tab"
            data-selected={isSelected || undefined}
          >
            {Icon && <DsIcon icon={Icon} size="md" />}
            <span className="ds-tab__label">{tab.label}</span>
            {tab.badge}
            {/*
              Selection is carried by `aria-selected`, which is what the ARIA tab
              pattern specifies and what every screen reader announces.

              It used to ALSO append a visually-hidden " (selected)", to keep
              selection from being colour alone. That was the wrong fix for a real
              concern. It made the selected tab announce its state twice — "Documents
              (selected), selected, tab" — and it put a state string inside the
              accessible NAME, which is the one thing a name must not contain,
              since every exact-match query for the tab then has to know about it.

              The concern it was aimed at is handled where it belongs, in
              `Tabs.css`: the selected tab is distinguished by a border that is
              *visible* against one that is not, and a `forced-colors` rule keeps
              that true when the user's system replaces every colour.
            */}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The region a tab controls.
 *
 * `tabIndex={0}` is deliberate and required by the pattern: the panel itself is
 * focusable so that a keyboard user moving off the strip lands in the content
 * it just switched to, rather than being dropped at the next focusable control
 * somewhere below it.
 *
 * It forwards its ref because the panel is a real focus target and callers need
 * to reach it: the driver dossier hands it to `Modal`'s `initialFocusRef`, so
 * opening the dialog lands the user in the content rather than on its close
 * button.
 */
export const TabPanel = forwardRef(function TabPanel(
  { idBase, tabId, className = '', children, ...props }, ref,
) {
  const ids = tabIds(idBase, tabId);
  return (
    <div
      {...props}
      ref={ref}
      role="tabpanel"
      id={ids.panelId}
      aria-labelledby={ids.tabId}
      tabIndex={0}
      className={`ds-tab-panel ${className}`.trim()}
    >
      {children}
    </div>
  );
});
