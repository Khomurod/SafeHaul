import React, { useId } from 'react';
import './SectionNavigation.css';

const KEYBOARD_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);
const MOBILE_LAYOUTS = new Set(['stack', 'grid']);

function moveItemFocus(event) {
  if (!KEYBOARD_KEYS.has(event.key)) return;

  const navigation = event.currentTarget.closest('.ds-section-navigation');
  const items = Array.from(
    navigation?.querySelectorAll('[data-section-navigation-item]:not(:disabled)') || [],
  );
  const currentIndex = items.indexOf(event.currentTarget);
  if (currentIndex < 0 || items.length === 0) return;

  event.preventDefault();

  if (event.key === 'Home') {
    items[0].focus();
    return;
  }

  if (event.key === 'End') {
    items[items.length - 1].focus();
    return;
  }

  const direction = event.key === 'ArrowDown' ? 1 : -1;
  const nextIndex = (currentIndex + direction + items.length) % items.length;
  items[nextIndex].focus();
}

export function SectionNavigation({
  label = 'Section navigation',
  groups,
  currentId,
  onSelect,
  controlsId,
  mobileLayout = 'stack',
  className = '',
}) {
  const instanceId = useId().replace(/:/g, '');

  if (!Array.isArray(groups)) {
    throw new TypeError('SectionNavigation groups must be an array.');
  }

  if (!MOBILE_LAYOUTS.has(mobileLayout)) {
    throw new TypeError(`Unsupported SectionNavigation mobileLayout: ${mobileLayout}`);
  }

  return (
    <nav
      aria-label={label}
      className={`ds-section-navigation ${className}`.trim()}
      data-mobile-layout={mobileLayout}
    >
      <div className="ds-section-navigation__groups">
        {groups.map((group) => {
          const headingId = `section-navigation-${instanceId}-${group.id}`;

          return (
            <section
              key={group.id}
              className="ds-section-navigation__group"
              aria-labelledby={headingId}
            >
              <h2 id={headingId} className="ds-section-navigation__heading">
                {group.label}
              </h2>
              <ul className="ds-section-navigation__list">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = item.id === currentId;

                  return (
                    <li key={item.id} className="ds-section-navigation__list-item">
                      <button
                        type="button"
                        className="ds-section-navigation__item"
                        data-section-navigation-item
                        data-current={isCurrent || undefined}
                        aria-current={isCurrent ? 'page' : undefined}
                        aria-controls={controlsId}
                        disabled={item.disabled}
                        onClick={() => onSelect(item.id)}
                        onKeyDown={moveItemFocus}
                      >
                        {Icon && (
                          <Icon
                            className="ds-section-navigation__icon"
                            size={20}
                            aria-hidden="true"
                          />
                        )}
                        <span className="ds-section-navigation__label">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
