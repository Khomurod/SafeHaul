import React, { useId } from 'react';
import { CheckCircle2, Circle, Icon as DsIcon } from '../../icons';
import './SectionNavigation.css';

const KEYBOARD_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);
const MOBILE_LAYOUTS = new Set(['stack', 'grid']);
const CURRENT_TYPES = new Set(['page', 'step']);
const FRAMES = new Set(['card', 'none']);

/*
 * The suffix is spoken, not shown, and it is deliberately part of the item's
 * accessible name rather than a `title` or a live region: a person tabbing the
 * rail hears "Audience (completed)" as one label, in the same breath as the
 * name. The LEADING SPACE is what keeps those two words apart.
 *
 * The glyphs differ in SHAPE — a filled check against an empty ring — so the
 * state survives forced-colours mode and a monochrome print, which is the same
 * rule `Chip`'s pressed state follows.
 */
const STATUSES = {
  complete: { icon: CheckCircle2, suffix: ' (completed)' },
  incomplete: { icon: Circle, suffix: ' (incomplete)' },
};

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
  currentType = 'page',
  frame = 'card',
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

  if (!CURRENT_TYPES.has(currentType)) {
    throw new TypeError(`Unsupported SectionNavigation currentType: ${currentType}`);
  }

  if (!FRAMES.has(frame)) {
    throw new TypeError(`Unsupported SectionNavigation frame: ${frame}`);
  }

  return (
    <nav
      aria-label={label}
      className={`ds-section-navigation ${className}`.trim()}
      data-mobile-layout={mobileLayout}
      data-frame={frame === 'card' ? undefined : frame}
    >
      <div className="ds-section-navigation__groups">
        {groups.map((group) => {
          const headingId = `section-navigation-${instanceId}-${group.id}`;
          /*
           * A plain `<div>` when there is no label, not a `<section>` with none.
           * An unnamed `<section>` is not exposed as a region, so it would be
           * harmless — but it would also be a landmark element standing there
           * claiming nothing, and a single-group rail (the wizard case) has no
           * heading to give it.
           */
          const Group = group.label === undefined ? 'div' : 'section';

          return (
            <Group
              key={group.id}
              className="ds-section-navigation__group"
              aria-labelledby={group.label === undefined ? undefined : headingId}
            >
              {group.label !== undefined && (
                <h2 id={headingId} className="ds-section-navigation__heading">
                  {group.label}
                </h2>
              )}
              <ul className="ds-section-navigation__list">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = item.id === currentId;
                  if (item.status !== undefined && !(item.status in STATUSES)) {
                    throw new TypeError(
                      `Unsupported SectionNavigation item status: ${item.status}`,
                    );
                  }
                  const status = item.status === undefined ? null : STATUSES[item.status];

                  return (
                    <li key={item.id} className="ds-section-navigation__list-item">
                      <button
                        type="button"
                        className="ds-section-navigation__item"
                        data-section-navigation-item
                        data-current={isCurrent || undefined}
                        data-status={item.status}
                        aria-current={isCurrent ? currentType : undefined}
                        aria-controls={controlsId}
                        disabled={item.disabled}
                        onClick={() => onSelect(item.id)}
                        onKeyDown={moveItemFocus}
                      >
                        {Icon && (
                          <DsIcon
                            icon={Icon}
                            size="xl"
                            className="ds-section-navigation__icon"
                          />
                        )}
                        <span className="ds-section-navigation__label">{item.label}</span>
                        {status && (
                          <>
                            <DsIcon
                              icon={status.icon}
                              size="md"
                              className="ds-section-navigation__status"
                            />
                            <span className="sr-only">{status.suffix}</span>
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Group>
          );
        })}
      </div>
    </nav>
  );
}
