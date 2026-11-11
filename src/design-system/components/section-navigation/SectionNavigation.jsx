import React, { useId } from 'react';
import { CheckCircle2, Circle, Icon as DsIcon } from '../../icons';
import { contractViolation } from '../../contract';
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

/*
 * An item's second line (C2 settings rail: "Who recruits for you"). It must be
 * words — a blank one would draw an empty line and describe the item as nothing.
 */
function checkedDescription(item) {
  // `null` is absent too: `description={note || null}` is how React writes "none".
  if (item.description == null) return undefined;
  if (typeof item.description !== 'string' || item.description.trim() === '') {
    contractViolation(`SectionNavigation item description must be a non-empty string (${item.id}).`);
    return undefined;
  }
  return item.description;
}

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
    contractViolation('SectionNavigation groups must be an array.');
    groups = [];
  }

  if (!MOBILE_LAYOUTS.has(mobileLayout)) {
    contractViolation(`Unsupported SectionNavigation mobileLayout: ${mobileLayout}`);
  }

  if (!CURRENT_TYPES.has(currentType)) {
    contractViolation(`Unsupported SectionNavigation currentType: ${currentType}`);
  }

  if (!FRAMES.has(frame)) {
    contractViolation(`Unsupported SectionNavigation frame: ${frame}`);
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
                    contractViolation(
                      `Unsupported SectionNavigation item status: ${item.status}`,
                    );
                  }
                  const status = item.status === undefined ? null : STATUSES[item.status];
                  const description = checkedDescription(item);
                  /*
                   * A description is the item's second line, not part of its
                   * name: the item stays "Team" — what a speech-input user says
                   * and what every caller finds it by — and "Who recruits for
                   * you" is its description. So the name is the label (and the
                   * status suffix) by reference, and the line is described-by.
                   * Without a description nothing here changes.
                   */
                  const itemId = `section-navigation-${instanceId}-${group.id}-${item.id}`;
                  const labelId = description ? `${itemId}-label` : undefined;
                  const statusId = description && status ? `${itemId}-status` : undefined;
                  const descriptionId = description ? `${itemId}-description` : undefined;

                  return (
                    <li key={item.id} className="ds-section-navigation__list-item">
                      <button
                        type="button"
                        className="ds-section-navigation__item"
                        data-section-navigation-item
                        data-current={isCurrent || undefined}
                        data-status={item.status}
                        data-described={description ? true : undefined}
                        aria-current={isCurrent ? currentType : undefined}
                        aria-controls={controlsId}
                        aria-labelledby={description ? [labelId, statusId].filter(Boolean).join(' ') : undefined}
                        aria-describedby={descriptionId}
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
                        <span id={labelId} className="ds-section-navigation__label">{item.label}</span>
                        {status && (
                          <>
                            <DsIcon
                              icon={status.icon}
                              size="md"
                              className="ds-section-navigation__status"
                            />
                            <span id={statusId} className="sr-only">{status.suffix}</span>
                          </>
                        )}
                        {description && (
                          <span id={descriptionId} className="ds-section-navigation__description">
                            {description}
                          </span>
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
