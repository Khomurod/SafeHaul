import React from 'react';
import { contractViolation } from '../../contract';
import './Tabs.css';

/**
 * The tab strip's look, made of links: a page's views that are pages of their
 * own, each with its address.
 *
 * `TabList` is the WAI-ARIA tab pattern, for panels switched inside one page:
 * buttons, one Tab stop, arrow keys that move and select. A strip whose items
 * each open an address is navigation, not a tab widget, and announcing tabs
 * there would promise panels and arrow keys a page change does not keep. So
 * this is a named `<nav>` holding a list of links: each link is its own Tab
 * stop, Enter follows it, the browser offers "open in a new tab", and the page
 * shown is `aria-current="page"`. It reuses `Tabs.css`, so it looks exactly like
 * the underlined strip.
 *
 * Routing is the caller's: an item carries its `href` and, for an in-app move
 * without a reload, an `onClick` (a router's link click handler).
 *
 * @param {object} props
 * @param {string} props.ariaLabel Names the navigation. Required — "navigation" is not a name.
 * @param {Array<{id: string, label: string, href: string, onClick?: (event: object) => void}>} props.items
 * @param {string} [props.currentId] The item for the page shown.
 */
export function TabNav({ ariaLabel, items, currentId, className = '', ...props }) {
  if (typeof ariaLabel !== 'string' || ariaLabel.trim() === '') {
    contractViolation('TabNav requires an ariaLabel naming what its links move between.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    contractViolation('TabNav requires at least one item.');
    if (!Array.isArray(items)) items = [];
  }

  return (
    <nav {...props} aria-label={ariaLabel} className={`ds-tab-nav ${className}`.trim()}>
      <ul className="ds-tab-list" data-orientation="horizontal" data-variant="underline">
        {items.map((item) => {
          if (typeof item.href !== 'string' || item.href.trim() === '') {
            contractViolation(`TabNav item "${item.id}" requires an href. For a panel switched in place, use TabList.`);
          }
          const isCurrent = item.id === currentId;
          return (
            <li key={item.id} className="ds-tab-nav__item">
              <a
                href={item.href}
                onClick={item.onClick}
                className="ds-tab"
                data-selected={isCurrent || undefined}
                aria-current={isCurrent ? 'page' : undefined}
              >
                <span className="ds-tab__label">{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
