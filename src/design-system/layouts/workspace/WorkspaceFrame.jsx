import React, { useEffect, useRef } from 'react';
import './WorkspaceFrame.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function WorkspaceFrame({
  navigation,
  topbar,
  children,
  navigationOpen = true,
  navigationExpanded = true,
  onNavigationClose,
  navigationLabel = 'Primary navigation',
  navigationId = 'workspace-navigation',
  mainId = 'main-content',
  focusReturnRef,
}) {
  const navigationRef = useRef(null);
  const isModalNavigation = Boolean(onNavigationClose);

  useEffect(() => {
    if (!isModalNavigation || !navigationOpen) return undefined;

    const previousFocus = document.activeElement;
    const focusReturnTarget = focusReturnRef?.current || previousFocus;
    const navigationElement = navigationRef.current;
    const focusable = navigationElement?.querySelectorAll(FOCUSABLE_SELECTOR) || [];
    focusable[0]?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onNavigationClose();
        return;
      }

      if (event.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      focusReturnTarget?.focus?.();
    };
  }, [focusReturnRef, isModalNavigation, navigationOpen, onNavigationClose]);

  return (
    <div className="ds-workspace">
      <a className="ds-workspace__skip-link" href={`#${mainId}`}>Skip to main content</a>

      {isModalNavigation && navigationOpen && (
        <button
          type="button"
          className="ds-workspace__backdrop"
          aria-label="Close navigation"
          onClick={onNavigationClose}
        />
      )}

      <aside
        ref={navigationRef}
        id={navigationId}
        className="ds-workspace__navigation"
        data-open={navigationOpen}
        data-expanded={navigationExpanded}
        aria-label={navigationLabel}
        role={isModalNavigation ? 'dialog' : undefined}
        aria-modal={isModalNavigation ? 'true' : undefined}
        aria-hidden={!navigationOpen ? 'true' : undefined}
        inert={!navigationOpen ? true : undefined}
      >
        {navigation}
      </aside>

      <div className="ds-workspace__body">
        <div className="ds-workspace__topbar">{topbar}</div>
        <main id={mainId} className="ds-workspace__main" tabIndex="-1">
          {children}
        </main>
      </div>
    </div>
  );
}
