import { useEffect, useState } from 'react';

/** The breakpoint `mobileCards.css` turns rows into cards at. */
const CARDS_QUERY = '(max-width: 767px)';

function cardsOnScreen() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(CARDS_QUERY).matches;
}

/**
 * Whether a `mobilePresentation="cards"` table is showing its cards right now.
 * At 768px and up it is a table again, one that can scroll sideways, so what the
 * table tells assistive technology about scrolling follows the layout on screen
 * rather than the prop. Tracks rotation and resizing.
 */
export function useCardsLayout(enabled) {
  const [onScreen, setOnScreen] = useState(cardsOnScreen);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(CARDS_QUERY);
    const update = () => setOnScreen(list.matches);
    update();
    // Safari before 14 knows only addListener.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    }
    list.addListener(update);
    return () => list.removeListener(update);
  }, [enabled]);

  return enabled && onScreen;
}
