import React, { forwardRef, useCallback, useRef } from 'react';
import { Icon as DsIcon } from '../../icons';
import { contractViolation } from '../../contract';
import './Tabs.css';
// After `Tabs.css`, so the shared drawing wins a tie with the underlined tab.
import { phoneColumnsFor, reservedText, useTrayWraps } from './segmentedGroup';

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
    contractViolation('tabIds requires a non-empty idBase.');
  }
  return {
    tabId: `${idBase}-tab-${tabId}`,
    panelId: `${idBase}-panel-${tabId}`,
  };
}

const ORIENTATIONS = new Set(['horizontal', 'vertical']);

/** A badge worth drawing: a count of 0 is a count; nothing, false and '' are not. */
const hasBadge = (badge) => badge !== undefined && badge !== null && badge !== false && badge !== '';

/**
 * The strip shapes the product actually uses.
 *
 * `underline` is the page-level strip. `segmented` is the same choice drawn as
 * a tray of items with the chosen one dark — the look a list's segments have
 * (`ListToolbar`), for a page whose tabs sit beside or above a list. `pill` is
 * the secondary strip that sits *inside* a panel — the campaign audience
 * builder's import-method chooser is one — where an underline would compete
 * with the page strip above it for the same meaning. All are the same control:
 * same roving `tabIndex`, same keyboard model. Only the drawing differs; the
 * last two share `segmentedGroup.css` with `ListToolbar` and `TabNav`.
 *
 * This exists because the alternative was worse. Eleven hand-rolled strips
 * carried at least three treatments between them, and a primitive that could
 * express only one of them would have left the others hand-rolled — which is
 * how a primitive ends up with no consumers.
 */
const VARIANTS = new Set(['underline', 'segmented', 'pill']);

/** The shapes drawn by the shared segmented group rather than by `Tabs.css` alone. */
const GROUP_VARIANTS = new Set(['segmented', 'pill']);

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
 *   In `segmented`, `badge` is the count itself (`6`), drawn as a muted count.
 * @param {string} props.activeTab
 * @param {(id: string) => void} props.onChange
 * @param {'horizontal'|'vertical'} [props.orientation='horizontal']
 * @param {'underline'|'segmented'|'pill'} [props.variant='underline']
 * @param {boolean} [props.fitted] Tabs share the strip's width equally. For a
 *   strip that spans a narrow panel — a notification popover — where tabs
 *   hugging their labels leaves a ragged gap.
 * @param {boolean} [props.phoneIcons=true] `segmented` on a phone keeps each
 *   tab's glyph, as C2 draws it. `false` for labels too long to share a
 *   phone's half-row with one ("After-application forms").
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
  phoneIcons = true,
  className = '',
  ...props
}) {
  if (typeof ariaLabel !== 'string' || ariaLabel.trim() === '') {
    contractViolation('TabList requires an ariaLabel naming what the tabs switch between.');
  }
  if (!Array.isArray(tabs) || tabs.length === 0) {
    contractViolation('TabList requires at least one tab.');
    if (!Array.isArray(tabs)) tabs = [];
  }
  if (!ORIENTATIONS.has(orientation)) {
    contractViolation(`Unsupported TabList orientation: ${orientation}`);
    orientation = 'horizontal';
  }
  if (!VARIANTS.has(variant)) {
    contractViolation(`Unsupported TabList variant: ${variant}`);
    variant = 'underline';
  }
  if (GROUP_VARIANTS.has(variant) && orientation === 'vertical') {
    // Not a limitation worth designing around: nothing in the product wants it,
    // and a silently-ignored combination is how a component starts lying about
    // what it supports.
    contractViolation(`TabList does not support variant="${variant}" with orientation="vertical".`);
    variant = 'underline';
  }
  const grouped = GROUP_VARIANTS.has(variant);
  const segmented = variant === 'segmented';
  const [trayRef, trayWrapped] = useTrayWraps(segmented);

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
      ref={segmented ? trayRef : undefined}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
      onKeyDown={handleKeyDown}
      className={`ds-tab-list${grouped ? ' ds-segmented-group' : ''} ${className}`.trim()}
      data-orientation={orientation}
      data-variant={variant}
      data-fitted={fitted || undefined}
      data-phone-columns={segmented ? phoneColumnsFor(tabs.length) : undefined}
      data-phone-icons={segmented && !phoneIcons ? 'hidden' : undefined}
      data-wrapped={segmented && trayWrapped ? 'true' : undefined}
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
            className={grouped ? 'ds-tab ds-segmented-group__item' : 'ds-tab'}
            data-selected={isSelected || undefined}
          >
            {Icon && <DsIcon icon={Icon} size="md" />}
            <span
              className={grouped ? 'ds-tab__label ds-segmented-group__label' : 'ds-tab__label'}
              data-text={grouped ? reservedText(tab.label) : undefined}
            >
              {tab.label}
            </span>
            {/* The space is the name's: "Sent 6", not "Sent6". */}
            {hasBadge(tab.badge) && (
              <>
                {' '}
                <span className={variant === 'segmented' ? 'ds-tab__badge ds-segmented-group__count' : 'ds-tab__badge'}>
                  {tab.badge}
                </span>
              </>
            )}
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
export const TabPanel = /* @__PURE__ */ forwardRef(function TabPanel(
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
