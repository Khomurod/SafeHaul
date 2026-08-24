import React from 'react';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';

/**
 * The full-screen loading state shown while the application boots.
 *
 * Deliberately **not** `LoadingState`: this is the one loading state that shows
 * the SafeHaul mark, because it is the first thing a user sees and the branded
 * loader is the point. What it takes from the design system is everything else —
 * the canvas, the type scale, the spacing — and, importantly, the announcement.
 *
 * It previously announced nothing at all: a `<div>` with a spinner and the word
 * "Loading...", which a screen reader passes over in silence while the user
 * waits. `role="status"` with a polite live region fixes that without changing
 * anything a sighted user sees.
 */
export function GlobalLoadingState() {
  return (
    <div
      role="status"
      className="flex min-h-screen flex-col items-center justify-center gap-ds-4 bg-ds-canvas text-ds-content-secondary"
    >
      <SafeHaulLoader size="h-16 w-16" />
      <p className="text-ds-heading-lg font-semibold">Loading…</p>
    </div>
  );
}

export default GlobalLoadingState;
