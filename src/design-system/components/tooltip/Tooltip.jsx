import React, { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contractViolation } from '../../contract';
import './Tooltip.css';

const PLACEMENTS = new Set(['right']);

/** How long the label stays after the pointer leaves, so it can cross the gap onto the label. */
const HIDE_DELAY_MS = 120;

/** The label's place beside its control: 8px to its right, centred on it. */
function placeBeside(control) {
  const box = control.getBoundingClientRect();
  return { left: box.right + 8, top: box.top + box.height / 2 };
}

/** Whether focus came from the keyboard; where the browser cannot say, it did. */
function focusedByKeyboard(element) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Runs the control's own handler, then this one. */
const both = (own, added) => (event) => {
  own?.(event);
  added(event);
};

/** Sets the control's own ref (a function or an object) and this one. */
function sharedRef(own, added) {
  return (element) => {
    added.current = element;
    if (typeof own === 'function') own(element);
    else if (own) own.current = element;
  };
}

/**
 * A short label shown beside a control while the pointer is over it or it has
 * keyboard focus: the name of an icon-only control, such as a folded sidebar's
 * items.
 *
 * The label is drawn on `document.body` (`position: fixed`), so no scrolling or
 * clipped container around the control can cut it off, which is what an
 * absolutely placed label inside a scrolling menu suffers.
 *
 * Its child is one element that forwards its ref (a link, a `Button`); the
 * tooltip adds its handlers to that element and wraps nothing, so the control
 * keeps its place, and its parent's spacing, exactly.
 *
 * It only shows a name the control already has. The control names itself
 * (`aria-label`, or its own words) and the label is `aria-hidden`, so a screen
 * reader hears the name once. WCAG 1.4.13: it stays while the pointer moves onto
 * it, stays until hover or focus ends, and Escape dismisses it.
 *
 * `disabled` shows no label: a menu's open state, where the words are on
 * screen, needs none. Switching it never remounts the control.
 */
export function Tooltip({ label, placement = 'right', disabled = false, children }) {
  if (typeof label !== 'string' || label.trim() === '') {
    contractViolation('Tooltip requires a label: the name its control already carries.');
  }
  if (!PLACEMENTS.has(placement)) {
    contractViolation(`Unsupported Tooltip placement: ${placement}`);
  }
  if (!isValidElement(children)) {
    contractViolation('Tooltip wraps one element: the control it names.');
  }

  const controlRef = useRef(null);
  const hideTimer = useRef(null);
  const [position, setPosition] = useState(null);

  const cancelHide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const show = useCallback(() => {
    cancelHide();
    if (controlRef.current) setPosition(placeBeside(controlRef.current));
  }, []);

  const hide = useCallback(() => {
    cancelHide();
    setPosition(null);
  }, []);

  const hideSoon = () => {
    cancelHide();
    hideTimer.current = setTimeout(hide, HIDE_DELAY_MS);
  };

  // While shown: Escape dismisses it, and a scroll or resize moves it with its control.
  const shown = position !== null && !disabled;
  useEffect(() => {
    if (!shown) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') hide();
    };
    const follow = () => {
      if (controlRef.current) setPosition(placeBeside(controlRef.current));
    };
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [shown, hide]);

  // A label switched off while shown (the menu opened) goes with it.
  useLayoutEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  if (!isValidElement(children)) return children ?? null;

  const own = children.props;
  const control = cloneElement(children, {
    ref: sharedRef(own.ref, controlRef),
    ...(disabled ? {} : {
      onMouseEnter: both(own.onMouseEnter, show),
      onMouseLeave: both(own.onMouseLeave, hideSoon),
      // Only a keyboard focus shows it; a click's focus would leave it behind.
      onFocus: both(own.onFocus, (event) => {
        if (focusedByKeyboard(event.currentTarget)) show();
      }),
      onBlur: both(own.onBlur, hide),
    }),
  });

  return (
    <>
      {control}
      {shown && createPortal(
        <span
          className="ds-tooltip"
          data-placement={placement}
          aria-hidden="true"
          style={{ left: `${position.left}px`, top: `${position.top}px` }}
          // The pointer may cross onto the label: it stays while there.
          onMouseEnter={cancelHide}
          onMouseLeave={hideSoon}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  );
}

export default Tooltip;
